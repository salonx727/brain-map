-- Canonical layer — the read-only mirror of parsed COYOTE. Written ONLY by the sync
-- publisher (via publish_canonical_snapshot below, called with the dedicated sync
-- service role). Never by the Next.js app, never by a human, never by AI directly —
-- per Gaelan/Salman's explicit rule, 2026-09-03.
--
-- No PM tables in this migration. This is deliberately the minimum canonical layer only
-- (registry fix -> validator -> canonical layer, per the approved implementation order);
-- the writable PM layer is a separate migration, not built this pass.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists canonical_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  source_hash text not null,
  register_entry_count integer not null,
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
comment on table canonical_snapshots is
  'One row per published snapshot generation. Never updated after insert — a full-replace publish always inserts a new row here plus new canonical_nodes/canonical_connections rows tagged with its id, then flips canonical_sync_state.active_snapshot_id in the same transaction. diagnostics carries the full Diagnostic[] the parser produced for this candidate (including the unattributed-blocker/open-question conversions getCanonicalGraph.ts applies) — added so the Supabase-backed production read path renders the same Global Diagnostics Tray content as the local dev path, instead of silently going quiet the moment a snapshot ships.';

create table if not exists canonical_nodes (
  snapshot_id uuid not null references canonical_snapshots(id) on delete cascade,
  node_key text not null,
  kind text not null,
  label text not null,
  canon_refs jsonb not null default '[]'::jsonb,
  field_states jsonb not null default '{}'::jsonb,
  primary key (snapshot_id, node_key)
);
comment on table canonical_nodes is
  'Parsed nodes for one snapshot generation. field_states carries the present/empty/disconnected/unknown FieldValue set per node — never flattened to a bare string, matching apps/brain-map''s own type.';

create table if not exists canonical_connections (
  snapshot_id uuid not null references canonical_snapshots(id) on delete cascade,
  from_node_key text not null,
  to_node_key text not null,
  edge_type text not null default 'data_flow',
  directed boolean not null default true,
  declaring_citation text not null,
  primary key (snapshot_id, from_node_key, to_node_key)
);
comment on table canonical_connections is
  'Parsed edges for one snapshot generation. Every row is validated (endpoints resolve within the same snapshot, citation non-empty) before publish — see validator.ts. Empty today: no connection extractor exists yet (see parser.ts''s ParseResult.connections comment) — this table is real plumbing waiting on real data, not a placeholder.';

create table if not exists canonical_sync_state (
  id boolean primary key default true,
  active_snapshot_id uuid references canonical_snapshots(id),
  source_hash text,
  source_filename text,
  register_entry_count integer,
  synced_at timestamptz,
  sync_status text not null default 'never_run' check (sync_status in ('ok', 'failed', 'never_run')),
  last_error text,
  attempted_at timestamptz,
  constraint canonical_sync_state_singleton check (id)
);
comment on table canonical_sync_state is
  'Exactly one row (id is always true, enforced by the PK + check). active_snapshot_id is the only thing a reader needs to follow. source_hash here is the last SUCCESSFULLY published hash, used for the idempotent no-op check — a failed attempt updates last_error/attempted_at only, never source_hash.';

insert into canonical_sync_state (id) values (true) on conflict (id) do nothing;

create index if not exists canonical_nodes_snapshot_idx on canonical_nodes (snapshot_id);
create index if not exists canonical_connections_snapshot_idx on canonical_connections (snapshot_id);

-- ---------------------------------------------------------------------------
-- Atomic, idempotent publish
-- ---------------------------------------------------------------------------
--
-- One function, one transaction (implicit — a plpgsql function body is transactional by
-- default). The idempotency check lives HERE, not only in the calling TypeScript, because
-- this is the one place that's race-free against two near-simultaneous publish attempts —
-- the exact duplicate-upload failure mode already observed twice in one week (COYOTE_368,
-- X_09-03_Coyote.md arriving twice). A duplicate call is a no-op that returns the
-- already-active snapshot id, not an error and not a second snapshot.
create or replace function publish_canonical_snapshot(
  p_source_hash text,
  p_source_filename text,
  p_register_entry_count integer,
  p_nodes jsonb,      -- array of {node_key, kind, label, canon_refs, field_states}
  p_connections jsonb, -- array of {from_node_key, to_node_key, edge_type, directed, declaring_citation}
  p_diagnostics jsonb default '[]'::jsonb  -- full Diagnostic[] for this candidate
) returns uuid
language plpgsql
security definer
as $$
declare
  v_current_hash text;
  v_active_id uuid;
  v_new_id uuid;
begin
  select source_hash, active_snapshot_id into v_current_hash, v_active_id
  from canonical_sync_state where id = true;

  -- Idempotent no-op: identical to what's already live. Do not touch synced_at again —
  -- a no-op is not a new sync event.
  if v_current_hash is not null and v_current_hash = p_source_hash then
    return v_active_id;
  end if;

  insert into canonical_snapshots (source_filename, source_hash, register_entry_count, diagnostics)
  values (p_source_filename, p_source_hash, p_register_entry_count, p_diagnostics)
  returning id into v_new_id;

  insert into canonical_nodes (snapshot_id, node_key, kind, label, canon_refs, field_states)
  select v_new_id, n->>'node_key', n->>'kind', n->>'label', n->'canon_refs', n->'field_states'
  from jsonb_array_elements(p_nodes) as n;

  insert into canonical_connections (snapshot_id, from_node_key, to_node_key, edge_type, directed, declaring_citation)
  select v_new_id, c->>'from_node_key', c->>'to_node_key', coalesce(c->>'edge_type', 'data_flow'),
         coalesce((c->>'directed')::boolean, true), c->>'declaring_citation'
  from jsonb_array_elements(p_connections) as c;

  -- The pointer flip. Nothing above this line is visible to a reader until this commits —
  -- readers only ever follow active_snapshot_id, never scan canonical_snapshots directly.
  update canonical_sync_state
  set active_snapshot_id = v_new_id,
      source_hash = p_source_hash,
      source_filename = p_source_filename,
      register_entry_count = p_register_entry_count,
      synced_at = now(),
      sync_status = 'ok',
      last_error = null,
      attempted_at = now()
  where id = true;

  return v_new_id;
end;
$$;

comment on function publish_canonical_snapshot is
  'The only write path onto the three canonical_* tables. Called exclusively by the local sync job''s dedicated service role — never by the Next.js app. Validation (validator.ts) and the stale-parent check (§43.4) both run in TypeScript BEFORE this is ever called; this function assumes its input already passed both and only enforces atomicity + hash idempotency, which cannot be safely enforced outside the database.';

-- Records a failed attempt without touching the active snapshot or the last-good hash.
create or replace function record_sync_failure(p_error text) returns void
language sql
as $$
  update canonical_sync_state
  set sync_status = 'failed', last_error = p_error, attempted_at = now()
  where id = true;
$$;

-- ---------------------------------------------------------------------------
-- RLS — read-only for anon/authenticated, write only via the functions above under a
-- dedicated role. No table grant for INSERT/UPDATE/DELETE to anon or to the PM-write
-- role used elsewhere in this app (kept in a separate migration) — a distinct
-- credential for the sync job is a deployment/ops concern (which role runs the job),
-- not expressed in SQL here beyond denying the app-facing roles.
-- ---------------------------------------------------------------------------

alter table canonical_snapshots enable row level security;
alter table canonical_nodes enable row level security;
alter table canonical_connections enable row level security;
alter table canonical_sync_state enable row level security;

create policy canonical_snapshots_read on canonical_snapshots for select using (true);
create policy canonical_nodes_read on canonical_nodes for select using (true);
create policy canonical_connections_read on canonical_connections for select using (true);
create policy canonical_sync_state_read on canonical_sync_state for select using (true);

-- Deliberately no insert/update/delete policy for any table above: with RLS enabled and
-- no permissive write policy, every role except the table owner / a role with BYPASSRLS
-- is denied by default. The sync job must run as a role that either owns these tables or
-- has been granted BYPASSRLS — provisioning that role is an infra step, not a SQL step,
-- and is listed as a remaining blocker in this phase's report.

-- RLS on the tables doesn't touch function EXECUTE privilege. Confirmed live on the
-- provisioned project (not assumed): Supabase's own bootstrap grants EXECUTE on every
-- new public-schema function DIRECTLY to anon and authenticated (not merely via
-- PUBLIC) — `revoke ... from public` alone left both roles able to call this RPC.
-- Both functions are SECURITY DEFINER/owned by postgres (BYPASSRLS on a hosted
-- project), so left ungated they let anon write canonical_* through the RPC despite
-- every insert/update/delete policy above being absent. Revoke from every role that
-- could hold it, not just PUBLIC.
revoke execute on function publish_canonical_snapshot(text, text, integer, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function record_sync_failure(text) from public, anon, authenticated;
grant execute on function publish_canonical_snapshot(text, text, integer, jsonb, jsonb, jsonb) to service_role;
grant execute on function record_sync_failure(text) to service_role;
