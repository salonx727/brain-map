-- Adds `p_force` to publish_canonical_snapshot.
--
-- WHY: the function no-ops when the incoming source hash matches what is already live,
-- and the hash covers the COYOTE text only. That makes a snapshot's identity a statement
-- about the input and never about the parser that read it. So when an extractor learns to
-- read a field it previously skipped, the source is byte-identical, the publish no-ops,
-- and the sync job reports success while production keeps serving the older, thinner
-- graph. Found exactly that way: connections.ts was taught to read EMITS/READS/TRIGGER,
-- went from 10 edges to 22, and `npm run sync:coyote` returned no_op — canonical_connections
-- stayed empty and nothing anywhere said so.
--
-- The hash check itself is right and stays the default. This only gives the operator an
-- explicit way to say "the source did not change, the parser did". Validation is untouched
-- and still runs in TypeScript before this function is ever called; force never bypasses
-- it, only the "nothing changed" shortcut.
--
-- Signature note: a new parameter makes a NEW function to Postgres even with a default, so
-- the six-argument version is dropped first rather than left behind as an overload that
-- would make every existing six-argument call ambiguous. Dropping also discards the 0001
-- revoke/grant, so both are restated at the bottom against the new signature — without
-- them Supabase's bootstrap re-grants EXECUTE to anon and authenticated, which is the
-- exact hole 0001's own comment describes.

drop function if exists publish_canonical_snapshot(text, text, integer, jsonb, jsonb, jsonb);

create or replace function publish_canonical_snapshot(
  p_source_hash text,
  p_source_filename text,
  p_register_entry_count integer,
  p_nodes jsonb,       -- array of {node_key, kind, label, canon_refs, field_states}
  p_connections jsonb, -- array of {from_node_key, to_node_key, edge_type, directed, backward, declaring_citation}
  p_diagnostics jsonb default '[]'::jsonb,
  p_force boolean default false
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
  -- a no-op is not a new sync event. Skipped when the caller forces a republish because
  -- the parser, not the source, is what changed.
  if not p_force and v_current_hash is not null and v_current_hash = p_source_hash then
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
  'The only write path onto the three canonical_* tables. Called exclusively by the local sync job''s dedicated service role — never by the Next.js app. Validation (validator.ts) and the stale-parent check (§43.4) both run in TypeScript BEFORE this is ever called; this function assumes its input already passed both and only enforces atomicity + hash idempotency, which cannot be safely enforced outside the database. p_force skips the hash idempotency check only — for republishing an unchanged COYOTE after a parser change — and never skips validation, which has already happened by this point.';

revoke execute on function publish_canonical_snapshot(text, text, integer, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function publish_canonical_snapshot(text, text, integer, jsonb, jsonb, jsonb, boolean) to service_role;
