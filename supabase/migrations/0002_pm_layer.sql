-- The writable PM/work-state layer — physically separate from the canonical layer in
-- 0001_canonical_layer.sql. No table here is ever written by publisher.ts/sync-coyote.ts,
-- and no canonical table is ever written by the code that writes these. Contrarian pass
-- against Brain v5, the current 379-entry COYOTE, and the existing canonical layer found
-- no conflicts requiring a stop — see the implementation report for the full pass. One
-- real supersession applied deliberately: the original (2026-09-01) Phase 4 design's
-- `pm_layout_positions.locked` column is NOT included here — Shawn's actual ruling is
-- that layout lock is session-only and must never survive reload, so it has no home in
-- this schema at all; it lives in client-side component state only.

-- ---------------------------------------------------------------------------
-- pm_people — lightweight, unauthenticated owner/creator directory. Not real auth: V1
-- has no per-user login (Brain access is a single shared password, per Shawn's ruling
-- 2026-09-03) — this just gives every write a "who," self-reported, ready for real auth
-- to attach to later without a schema change.
-- ---------------------------------------------------------------------------

create table if not exists pm_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
comment on table pm_people is
  'Self-reported owner/creator directory — not authentication. A name picked in the UI, not a verified identity. Referenced by every writable table below so ownership/audit data exists structurally before real auth does.';

-- ---------------------------------------------------------------------------
-- pm_nodes — PM-created custom nodes/sub-nodes/functions. NEVER canonical. Referenced
-- by node_key exactly like a canonical node is, but from a completely separate table —
-- per the 2026-09-03 sync-architecture review's stricter split (supersedes the original
-- Phase 4 design's unified `map_nodes` with an `is_canonical` flag): only a whole-table
-- GRANT boundary is honest about "humans/UI/AI must never write a canonical row," a
-- row-level flag is not.
-- ---------------------------------------------------------------------------

create table if not exists pm_nodes (
  node_key text primary key default ('pm:' || gen_random_uuid()::text),
  parent_node_key text,
  label text not null,
  kind text not null default 'subnode' check (kind in ('subnode', 'function')),
  created_by uuid references pm_people(id),
  created_at timestamptz not null default now(),
  updated_by uuid references pm_people(id),
  updated_at timestamptz
);
comment on table pm_nodes is
  'PM-created custom nodes and sub-nodes. node_key is a real, permanent, non-positional identity (never n0/n1-style), matching the naming-grammar lesson already applied to canonical nodes. parent_node_key may point at a canonical_nodes.node_key OR another pm_nodes.node_key — deliberately a plain text column, never a DB foreign key across that boundary, so canonical and PM tables stay independently grantable.';

-- ---------------------------------------------------------------------------
-- pm_items — todos + blockers, one table with a kind discriminator. Status vocabulary
-- is GTD's own (gtd/*.md), not a generic ticket lifecycle, so this speaks the same
-- language as the rest of the workspace rather than inventing a second one.
-- ---------------------------------------------------------------------------

create table if not exists pm_items (
  id uuid primary key default gen_random_uuid(),
  node_key text,
  kind text not null check (kind in ('todo', 'blocker')),
  title text not null,
  detail text,
  status text not null default 'inbox' check (status in ('inbox', 'next_action', 'waiting_for', 'someday_maybe', 'done')),
  waiting_on text,
  owner_id uuid references pm_people(id),
  created_by uuid references pm_people(id),
  created_at timestamptz not null default now(),
  updated_by uuid references pm_people(id),
  updated_at timestamptz
);
comment on table pm_items is
  'PM-tracked todos and blockers, kept deliberately distinct from a COYOTE section 15 blocker: a human may type "see section 15" into detail, but there is no hard link — conflating the two would recreate a second source of truth for the exact thing canon already states. node_key nullable so a todo can exist before it is scoped to any node (Master TODO reads across all rows regardless).';

-- ---------------------------------------------------------------------------
-- pm_notes — notes + decisions, one table with a kind discriminator.
-- ---------------------------------------------------------------------------

create table if not exists pm_notes (
  id uuid primary key default gen_random_uuid(),
  node_key text,
  kind text not null check (kind in ('note', 'decision')),
  body text not null,
  created_by uuid references pm_people(id),
  created_at timestamptz not null default now(),
  updated_by uuid references pm_people(id),
  updated_at timestamptz
);
comment on table pm_notes is
  'PM notes and decisions attached to a node (nullable node_key kept for parity with pm_items, though notes are expected to usually be scoped). Never a COYOTE decision record — this is team/PM-side commentary, not canon.';

-- ---------------------------------------------------------------------------
-- pm_references — Figma/wireframe/UI-slot links. Always node-scoped: an unscoped
-- reference link has no useful meaning the way an UNSORTED file drop does.
-- ---------------------------------------------------------------------------

create table if not exists pm_references (
  id uuid primary key default gen_random_uuid(),
  node_key text not null,
  ref_type text not null default 'link' check (ref_type in ('figma', 'wireframe', 'ui_slot', 'link')),
  label text,
  url text not null,
  created_by uuid references pm_people(id),
  created_at timestamptz not null default now()
);
comment on table pm_references is
  'Figma/wireframe/UI-slot links per node. Pure metadata — no file bytes here, see pm_files for uploads.';

-- ---------------------------------------------------------------------------
-- pm_files — uploaded file METADATA only. Bytes live in Supabase Storage (private
-- bucket, provisioned below); node_key nullable = UNSORTED (dropped, not yet routed to
-- a node), matching this workspace's own proven capture-then-route pattern
-- (gtd/inbox.md, vault _raw/unrouted/).
-- ---------------------------------------------------------------------------

create table if not exists pm_files (
  id uuid primary key default gen_random_uuid(),
  node_key text,
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  created_by uuid references pm_people(id),
  created_at timestamptz not null default now()
);
comment on table pm_files is
  'File metadata only — storage_path points into the private pm-files Storage bucket. node_key IS NULL means UNSORTED: dropped with no node assignment yet. Routing later is a single UPDATE setting node_key, never a Storage move — sorting is instant and reversible.';

-- ---------------------------------------------------------------------------
-- pm_layouts / pm_layout_positions — named layout sets. Position and per-node colour
-- persist; lock state deliberately does NOT — see the file header comment.
-- ---------------------------------------------------------------------------

create table if not exists pm_layouts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default boolean not null default false,
  created_by uuid references pm_people(id),
  created_at timestamptz not null default now()
);
comment on table pm_layouts is
  'Named layout/seed sets. At most one row may have is_default = true (enforced below) — the canvas renders that one unless a viewer explicitly switches to a named layout for viewing only.';

create unique index if not exists pm_layouts_one_default on pm_layouts ((is_default)) where is_default;

create table if not exists pm_layout_positions (
  layout_id uuid not null references pm_layouts(id) on delete cascade,
  node_key text not null,
  x double precision not null,
  y double precision not null,
  color text,
  updated_by uuid references pm_people(id),
  updated_at timestamptz not null default now(),
  primary key (layout_id, node_key)
);
comment on table pm_layout_positions is
  'Per-node position and colour within a named layout. Deliberately carries NO lock column — Shawn ruled layout lock is session-only and must never survive reload, so it is client-side component/session state only, never written here. node_key may reference either a canonical_nodes.node_key or a pm_nodes.node_key, unenforced, same rationale as pm_nodes.parent_node_key.';

-- ---------------------------------------------------------------------------
-- pm_node_links — connections touching at least one PM-created node. Canonical-to-
-- canonical connections continue to come ONLY from the canonical parser/sync pipeline
-- (canonical_connections in 0001) — enforced here by trigger, not just app-layer
-- discipline, per the 2026-09-01 contrarian pass's own finding that a CHECK constraint
-- can't subquery another table, so only a trigger can actually hold this line.
-- ---------------------------------------------------------------------------

create table if not exists pm_node_links (
  id uuid primary key default gen_random_uuid(),
  from_node_key text not null,
  to_node_key text not null,
  citation text,
  created_by uuid references pm_people(id),
  created_at timestamptz not null default now()
);
comment on table pm_node_links is
  'Connections where at least one endpoint is a PM-created node. citation is nullable (unlike canonical_connections.declaring_citation, which is mandatory) — a PM-only link may have no COYOTE citation at all. Enforcement of "at least one PM endpoint" is the trigger below, not this comment.';

create or replace function pm_node_links_require_pm_endpoint() returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from canonical_nodes where node_key = new.from_node_key)
     and exists (select 1 from canonical_nodes where node_key = new.to_node_key) then
    raise exception 'pm_node_links: both endpoints (% , %) are canonical — canonical-to-canonical connections must come only from the canonical sync pipeline (canonical_connections), not this table', new.from_node_key, new.to_node_key;
  end if;
  return new;
end;
$$;

drop trigger if exists pm_node_links_require_pm_endpoint_trg on pm_node_links;
create trigger pm_node_links_require_pm_endpoint_trg
  before insert or update on pm_node_links
  for each row execute function pm_node_links_require_pm_endpoint();

create index if not exists pm_items_node_key_idx on pm_items (node_key);
create index if not exists pm_notes_node_key_idx on pm_notes (node_key);
create index if not exists pm_references_node_key_idx on pm_references (node_key);
create index if not exists pm_files_node_key_idx on pm_files (node_key);
create index if not exists pm_layout_positions_node_key_idx on pm_layout_positions (node_key);

-- ---------------------------------------------------------------------------
-- RLS — identical shape to the canonical layer (0001): anon may SELECT everything
-- (the Brain's own access is already gated by a single shared password at the app
-- layer, per Shawn's ruling 2026-09-03; RLS here exists to stop a direct, unmediated
-- write, not to hide PM content from a viewer who's already inside the app). No
-- INSERT/UPDATE/DELETE policy for anon on anything below — deny by default. All real
-- writes happen server-side (Next.js Server Actions only) using the service-role
-- credential, which bypasses RLS — the same credential already used by the sync job,
-- reused here rather than provisioning a fourth Supabase role for a still-3-person
-- internal tool; flagged as a deliberate scope call, not an oversight, in the report.
-- ---------------------------------------------------------------------------

alter table pm_people enable row level security;
alter table pm_nodes enable row level security;
alter table pm_items enable row level security;
alter table pm_notes enable row level security;
alter table pm_references enable row level security;
alter table pm_files enable row level security;
alter table pm_layouts enable row level security;
alter table pm_layout_positions enable row level security;
alter table pm_node_links enable row level security;

create policy pm_people_read on pm_people for select using (true);
create policy pm_nodes_read on pm_nodes for select using (true);
create policy pm_items_read on pm_items for select using (true);
create policy pm_notes_read on pm_notes for select using (true);
create policy pm_references_read on pm_references for select using (true);
create policy pm_files_read on pm_files for select using (true);
create policy pm_layouts_read on pm_layouts for select using (true);
create policy pm_layout_positions_read on pm_layout_positions for select using (true);
create policy pm_node_links_read on pm_node_links for select using (true);

-- ---------------------------------------------------------------------------
-- Storage — one private bucket for all file drops (targeted + UNSORTED). No object
-- policy for anon: every read and write goes through a signed URL or a direct
-- service-role call issued by a Server Action, exactly mirroring the table RLS
-- posture above. A private bucket with zero anon policies denies by default, same as
-- every table in this migration.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('pm-files', 'pm-files', false)
on conflict (id) do nothing;
