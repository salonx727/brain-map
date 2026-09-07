-- §35.8's own text: "THE ONLY BACKWARD EDGE IN THE ARCHITECTURE" (LOCK-260809-051) —
-- `badge_awarded`, written by AFTERBURNER, lands on GHOST NOTES' client record. Stored
-- until now as an ordinary directed row, indistinguishable from the other data-flow
-- edges — the claim could not be checked. §43.1: how this is stored is an implementation
-- call; that it must be distinguishable is canon, not preference.
--
-- At most one row per snapshot may carry backward = true — same "one flagged row per
-- generation" shape already used by pm_layouts_one_default in 0002_pm_layer.sql. This is
-- a ceiling, not a floor: it stops a second backward edge from ever being added silently,
-- but "at least one" is a parser/validator-time concern (validateCanonicalGraph), not a
-- DB-level one, matching this schema's existing split between what the database enforces
-- structurally and what the publish-time validator enforces before anything reaches here.

alter table canonical_connections add column if not exists backward boolean not null default false;
comment on column canonical_connections.backward is
  'True for the one edge §35.8 names as the architecture''s sole exception (AFTERBURNER -> GHOST NOTES). Assigned by the connection extractor (src/lib/coyote/extractors/connections.ts), never inferred generically from WRITES prose.';

create unique index if not exists canonical_connections_one_backward_per_snapshot
  on canonical_connections (snapshot_id)
  where backward;

-- publish_canonical_snapshot: identical shape to 0001's version, extended to accept and
-- store p_connections[].backward. create or replace, not a new function — this stays the
-- one write path onto canonical_connections; the revoke/grant from 0001 already covers
-- this same function name+signature and does not need repeating.
create or replace function publish_canonical_snapshot(
  p_source_hash text,
  p_source_filename text,
  p_register_entry_count integer,
  p_nodes jsonb,       -- array of {node_key, kind, label, canon_refs, field_states}
  p_connections jsonb, -- array of {from_node_key, to_node_key, edge_type, directed, backward, declaring_citation}
  p_diagnostics jsonb default '[]'::jsonb
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

  if v_current_hash is not null and v_current_hash = p_source_hash then
    return v_active_id;
  end if;

  insert into canonical_snapshots (source_filename, source_hash, register_entry_count, diagnostics)
  values (p_source_filename, p_source_hash, p_register_entry_count, p_diagnostics)
  returning id into v_new_id;

  insert into canonical_nodes (snapshot_id, node_key, kind, label, canon_refs, field_states)
  select v_new_id, n->>'node_key', n->>'kind', n->>'label', n->'canon_refs', n->'field_states'
  from jsonb_array_elements(p_nodes) as n;

  insert into canonical_connections (snapshot_id, from_node_key, to_node_key, edge_type, directed, backward, declaring_citation)
  select v_new_id, c->>'from_node_key', c->>'to_node_key', coalesce(c->>'edge_type', 'data_flow'),
         coalesce((c->>'directed')::boolean, true), coalesce((c->>'backward')::boolean, false), c->>'declaring_citation'
  from jsonb_array_elements(p_connections) as c;

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
