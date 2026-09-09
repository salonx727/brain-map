-- Connection rulings — a wire drawn on the map is a proposal, and reaches canon the same
-- way a card does: through Shawn, in his own words, and never from here.
--
-- 0009 gave map-drawn NODES a route to canon. Edges had none. A wire wrote a
-- pm_node_links row and stopped there: Shawn never saw it, nothing retired it once §35
-- declared the same edge, and an engine-to-engine wire could not be drawn at all.
--
-- Two things happen below, and the order of the sections is the order they depend on.
--
-- 1. canonical_connections learns to say HOW it knows an edge exists. The extractor has
--    always derived edges two ways and the difference was invisible: a DOWNSTREAM/EMITS/
--    TRIGGER edge is DECLARED by the source engine itself; a READS edge is INFERRED from
--    the target's own contract naming the source. Three live edges are inferred today
--    (TAG→SIGNAL, TAG→AFTERBURNER, AFTERBURNER→NEXUS) and the map drew them exactly like
--    the eighteen declared ones. §43.1: how it is stored is an implementation call; that
--    it must be checkable is not. Same posture as 0005's `backward` flag — derived data
--    about how the parser read canon, not a claim added to canon.
--
-- 2. pm_rulings learns a second kind. A link ruling carries an edge instead of a node,
--    and the trigger that has always refused canonical-to-canonical wires is NARROWED
--    rather than dropped: such a wire is now permitted, but only while an open ruling
--    covers it. The rule stops being "PM may not draw canon shapes" and becomes "nothing
--    reaches canon shape without a ruling" — which is the rule 0002 was reaching for. It
--    stays a trigger for the reason 0002 already recorded: a CHECK constraint cannot
--    subquery another table, so only a trigger can actually hold this line.
--
-- Nothing here writes COYOTE or any canonical_* row. retire_link_ruling only ever
-- REMOVES a PM duplicate after canon already carries the edge.

-- ---------------------------------------------------------------------------
-- 1 · evidence_class on canonical_connections
-- ---------------------------------------------------------------------------

alter table canonical_connections
  add column if not exists evidence_class text not null default 'declared'
  check (evidence_class in ('declared', 'inferred'));

comment on column canonical_connections.evidence_class is
  'How the extractor knows this edge exists. declared: the source engine''s own DOWNSTREAM/EMITS/TRIGGER names the target. inferred: the source declares nothing, but the TARGET''s READS names the source, so the edge is read backwards out of the reader''s contract. Assigned by connections.ts, never hand-set. Display only — it deliberately does NOT gate ruling retirement (Shawn''s operator, 2026-09-09: for "does canon already carry this connection", both classes do the same work).';

-- Same signature as 0007's version, so create-or-replace is enough and the revoke/grant
-- from 0007 continues to apply untouched. Only the connections INSERT changes.
create or replace function publish_canonical_snapshot(
  p_source_hash text,
  p_source_filename text,
  p_register_entry_count integer,
  p_nodes jsonb,       -- array of {node_key, kind, label, canon_refs, field_states}
  p_connections jsonb, -- array of {from_node_key, to_node_key, edge_type, directed, backward, evidence_class, declaring_citation}
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

  if not p_force and v_current_hash is not null and v_current_hash = p_source_hash then
    return v_active_id;
  end if;

  insert into canonical_snapshots (source_filename, source_hash, register_entry_count, diagnostics)
  values (p_source_filename, p_source_hash, p_register_entry_count, p_diagnostics)
  returning id into v_new_id;

  insert into canonical_nodes (snapshot_id, node_key, kind, label, canon_refs, field_states)
  select v_new_id, n->>'node_key', n->>'kind', n->>'label', n->'canon_refs', n->'field_states'
  from jsonb_array_elements(p_nodes) as n;

  -- coalesce on evidence_class, not a bare cast: a candidate produced by an older build
  -- of the extractor omits the key entirely, and 'declared' is the correct reading of
  -- every edge that parser could produce before this migration existed.
  insert into canonical_connections (snapshot_id, from_node_key, to_node_key, edge_type, directed, backward, evidence_class, declaring_citation)
  select v_new_id, c->>'from_node_key', c->>'to_node_key', coalesce(c->>'edge_type', 'data_flow'),
         coalesce((c->>'directed')::boolean, true), coalesce((c->>'backward')::boolean, false),
         coalesce(c->>'evidence_class', 'declared'), c->>'declaring_citation'
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

-- ---------------------------------------------------------------------------
-- 2 · pm_node_links.relation — which of §35's four fields this wire is asserting
-- ---------------------------------------------------------------------------

alter table pm_node_links
  add column if not exists relation text
  check (relation is null or relation in ('downstream', 'reads', 'emits', 'trigger'));

comment on column pm_node_links.relation is
  'Which §35 field this wire proposes: downstream/reads/emits/trigger. NULL means the wire is not a §35 assertion at all — the containment wire a card keeps to the parent it was created under ("ADD A CARD · WIRED TO THIS ONE"), which is drawing, not architecture. Only a wire WITH a relation opens a ruling, and only a wire with a relation may ever be canonical-to-canonical.';

-- ---------------------------------------------------------------------------
-- 3 · pm_rulings gains a second kind
-- ---------------------------------------------------------------------------

alter table pm_rulings add column if not exists kind text not null default 'node'
  check (kind in ('node', 'link'));
alter table pm_rulings add column if not exists from_node_key text;
alter table pm_rulings add column if not exists to_node_key text;
alter table pm_rulings add column if not exists relation text
  check (relation is null or relation in ('downstream', 'reads', 'emits', 'trigger'));
alter table pm_rulings add column if not exists link_id uuid;

-- A link ruling has no pm_nodes row behind it, so node_key stops being universal. Every
-- pre-existing row is a node ruling by definition and keeps its value; the default above
-- already backfilled kind for them.
alter table pm_rulings alter column node_key drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pm_rulings_shape_by_kind') then
    alter table pm_rulings add constraint pm_rulings_shape_by_kind check (
      (kind = 'node' and node_key is not null)
      or (kind = 'link' and from_node_key is not null and to_node_key is not null and relation is not null)
    );
  end if;
end
$$;

comment on column pm_rulings.kind is
  'node: a card someone drew, awaiting Shawn (0009). link: a wire someone drew, awaiting Shawn. One table and one queue deliberately — a ruling is one thing, a proposal awaiting him, and he works the list one at a time. Two tables would mean two queues and a UI that merges them back anyway.';
comment on column pm_rulings.link_id is
  'The pm_node_links row this ruling proposes. Nullable because the ruling outlives the wire: retire_link_ruling deletes the row and leaves the ruling behind as the record of what was proposed and that canon absorbed it.';

-- 0009's index assumed every ruling had a node_key. Scope it to node rulings so a card
-- can carry both its own pending ruling and any number of pending wire rulings.
drop index if exists pm_rulings_one_pending_per_node;
create unique index if not exists pm_rulings_one_pending_per_node
  on pm_rulings (node_key) where status = 'pending' and kind = 'node';

-- The same guarantee for edges: one live ruling per (from, to, relation). Drawing the
-- same wire twice must not queue it twice.
create unique index if not exists pm_rulings_one_pending_per_link
  on pm_rulings (from_node_key, to_node_key, relation) where status = 'pending' and kind = 'link';

create index if not exists pm_rulings_link_endpoints_idx on pm_rulings (from_node_key, to_node_key);

-- ---------------------------------------------------------------------------
-- 4 · The narrowed endpoint trigger
--
-- 0002 refused canonical-to-canonical outright, because §35 is the only author of
-- engine-to-engine data flow. That is still true. What changed is that there is now a
-- route by which a human can PROPOSE one and have Shawn rule on it, so the refusal moves
-- from "never" to "not without an open ruling".
--
-- Note the ordering this forces on any caller: the ruling must exist BEFORE the link row.
-- propose_connection below is the only supported way to create one, precisely so no
-- caller has to remember that.
-- ---------------------------------------------------------------------------

create or replace function pm_node_links_require_pm_endpoint() returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from canonical_nodes where node_key = new.from_node_key)
     and exists (select 1 from canonical_nodes where node_key = new.to_node_key) then

    if new.relation is null then
      raise exception 'pm_node_links: both endpoints (% , %) are canonical and no relation was given — a canonical-to-canonical wire must name which §35 field it proposes (downstream/reads/emits/trigger)', new.from_node_key, new.to_node_key;
    end if;

    if not exists (
      select 1 from pm_rulings
      where kind = 'link' and status = 'pending'
        and from_node_key = new.from_node_key
        and to_node_key = new.to_node_key
        and relation = new.relation
    ) then
      raise exception 'pm_node_links: both endpoints (% , %) are canonical and no open ruling covers this edge — a canonical-to-canonical connection is a proposal for Shawn, never a fact this table may assert on its own (use propose_connection)', new.from_node_key, new.to_node_key;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5 · propose_connection — the wire and its ruling, or neither
--
-- One transaction for the reason the trigger above creates: the ruling has to land first,
-- and a caller that inserted the ruling and then failed to insert the link would leave a
-- queue entry for a wire nobody can see. Returns both ids so the UI can update in place
-- without a second round trip.
-- ---------------------------------------------------------------------------

create or replace function propose_connection(
  p_from text,
  p_to text,
  p_relation text,
  p_label text,
  p_created_by uuid default null
) returns jsonb
language plpgsql
as $$
declare
  v_ruling pm_rulings%rowtype;
  v_link_id uuid;
begin
  if p_relation is null or p_relation not in ('downstream', 'reads', 'emits', 'trigger') then
    raise exception 'propose_connection: relation must be one of downstream/reads/emits/trigger, got %', p_relation;
  end if;
  if p_from = p_to then
    raise exception 'propose_connection: a node cannot connect to itself';
  end if;

  -- An identical open proposal already exists. Return it rather than raising: two people
  -- drawing the same wire is agreement, not an error, and the second one should simply
  -- find it already queued.
  select * into v_ruling from pm_rulings
  where kind = 'link' and status = 'pending'
    and from_node_key = p_from and to_node_key = p_to and relation = p_relation;

  if found then
    return jsonb_build_object('ruling_id', v_ruling.id, 'link_id', v_ruling.link_id, 'existing', true);
  end if;

  insert into pm_rulings (kind, node_key, label, from_node_key, to_node_key, relation, submitted_by)
  values ('link', null, p_label, p_from, p_to, p_relation, p_created_by)
  returning * into v_ruling;

  insert into pm_node_links (from_node_key, to_node_key, relation, created_by)
  values (p_from, p_to, p_relation, p_created_by)
  returning id into v_link_id;

  update pm_rulings set link_id = v_link_id where id = v_ruling.id;

  return jsonb_build_object('ruling_id', v_ruling.id, 'link_id', v_link_id, 'existing', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6 · retire_link_ruling — canon carries the edge now, so the proposal's wire goes
--
-- The exact counterpart to retire_pm_node_into_canonical, and far simpler because an edge
-- has no to-dos, files or position to carry across. Matching is exact (both endpoints are
-- node keys) rather than a label guess, which is why this fires automatically at sync
-- while a node retirement still waits for a confirming tap.
-- ---------------------------------------------------------------------------

create or replace function retire_link_ruling(p_ruling_id uuid, p_note text default null)
returns void
language plpgsql
as $$
declare
  v_link_id uuid;
  v_status text;
begin
  select link_id, status into v_link_id, v_status from pm_rulings where id = p_ruling_id and kind = 'link';
  if not found then
    raise exception 'retire_link_ruling: % is not a link ruling', p_ruling_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'retire_link_ruling: ruling % is already %', p_ruling_id, v_status;
  end if;

  -- The ruling is marked first and the wire removed second, both inside this one
  -- transaction. Marking it ruled is what releases the narrowed trigger's permission for
  -- this edge, so a re-drawn wire needs a fresh ruling rather than riding this one.
  update pm_rulings
  set status = 'ruled', resolved_at = now(), resolved_note = p_note
  where id = p_ruling_id;

  if v_link_id is not null then
    delete from pm_node_links where id = v_link_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7 · retire_pm_node_into_canonical — stop destroying typed wires
--
-- Step 1 of 0009's version DELETED every link that would become canonical-to-canonical,
-- because the old trigger would have rejected the re-point and aborted the whole
-- retirement. Under the narrowed trigger that deletion is no longer forced, and for a
-- wire someone typed a relation onto it was a quiet loss of real work: the card gets
-- promoted and the architecture assertion drawn on it disappears.
--
-- So the two cases separate. A wire carrying a relation is a §35 proposal and survives —
-- it opens its own link ruling under the canonical key and joins Shawn's queue. A wire
-- with no relation is the containment wire the card was born with; once the card is canon
-- that wire asserts nothing, and it is still deleted.
--
-- Everything else in this function is unchanged from 0009.
-- ---------------------------------------------------------------------------

create or replace function retire_pm_node_into_canonical(p_pm_key text, p_canonical_key text)
returns void
language plpgsql
as $$
declare
  v_active uuid;
  v_link record;
  v_other text;
  v_new_from text;
  v_new_to text;
begin
  if p_pm_key = p_canonical_key then
    raise exception 'retire_pm_node_into_canonical: source and target are the same key (%)', p_pm_key;
  end if;
  if not exists (select 1 from pm_nodes where node_key = p_pm_key) then
    raise exception 'retire_pm_node_into_canonical: % is not a PM-created node', p_pm_key;
  end if;

  select active_snapshot_id into v_active from canonical_sync_state where id;
  if v_active is null then
    raise exception 'retire_pm_node_into_canonical: no active canonical snapshot — nothing has been published yet';
  end if;

  if not exists (select 1 from canonical_nodes where snapshot_id = v_active and node_key = p_canonical_key) then
    raise exception 'retire_pm_node_into_canonical: % is not a node in the active canonical snapshot', p_canonical_key;
  end if;

  -- 1a. A link from this node to itself cannot survive the rename.
  delete from pm_node_links where from_node_key = p_pm_key and to_node_key = p_pm_key;

  -- 1b. Links that are about to become canonical-to-canonical. A typed one keeps its
  --     assertion and gains a ruling under the new key; an untyped one is drawing, and
  --     goes. The ruling must be inserted BEFORE the re-point, or the narrowed trigger
  --     refuses the UPDATE and aborts the retirement.
  for v_link in
    select l.id, l.from_node_key, l.to_node_key, l.relation, l.created_by
    from pm_node_links l
    where (l.from_node_key = p_pm_key and exists (select 1 from canonical_nodes where snapshot_id = v_active and node_key = l.to_node_key))
       or (l.to_node_key = p_pm_key and exists (select 1 from canonical_nodes where snapshot_id = v_active and node_key = l.from_node_key))
  loop
    if v_link.relation is null then
      delete from pm_node_links where id = v_link.id;
      continue;
    end if;

    v_new_from := case when v_link.from_node_key = p_pm_key then p_canonical_key else v_link.from_node_key end;
    v_new_to := case when v_link.to_node_key = p_pm_key then p_canonical_key else v_link.to_node_key end;
    v_other := case when v_link.from_node_key = p_pm_key then v_link.to_node_key else v_link.from_node_key end;

    -- The re-point can collapse a wire onto itself if the card was wired to the very node
    -- it turned out to be. That is not a proposal, it is a duplicate of the retirement.
    if v_new_from = v_new_to then
      delete from pm_node_links where id = v_link.id;
      continue;
    end if;

    if not exists (
      select 1 from pm_rulings
      where kind = 'link' and status = 'pending'
        and from_node_key = v_new_from and to_node_key = v_new_to and relation = v_link.relation
    ) then
      insert into pm_rulings (kind, node_key, label, from_node_key, to_node_key, relation, link_id, submitted_by)
      values ('link', null, v_new_from || ' → ' || upper(v_link.relation) || ' → ' || v_new_to, v_new_from, v_new_to, v_link.relation, v_link.id, v_link.created_by);
    end if;
  end loop;

  update pm_node_links set from_node_key = p_canonical_key where from_node_key = p_pm_key;
  update pm_node_links set to_node_key = p_canonical_key where to_node_key = p_pm_key;

  -- 2. Everything scoped by node_key follows the card to its new identity.
  update pm_items set node_key = p_canonical_key where node_key = p_pm_key;
  update pm_notes set node_key = p_canonical_key where node_key = p_pm_key;
  update pm_references set node_key = p_canonical_key where node_key = p_pm_key;

  update pm_files f set slot_index = null
  where f.node_key = p_pm_key
    and f.slot_index is not null
    and exists (select 1 from pm_files c where c.node_key = p_canonical_key and c.slot_index = f.slot_index);
  update pm_files set node_key = p_canonical_key where node_key = p_pm_key;

  update pm_layout_positions p set node_key = p_canonical_key
  where p.node_key = p_pm_key
    and not exists (select 1 from pm_layout_positions q where q.layout_id = p.layout_id and q.node_key = p_canonical_key);
  delete from pm_layout_positions where node_key = p_pm_key;

  update pm_node_state s set node_key = p_canonical_key
  where s.node_key = p_pm_key
    and not exists (select 1 from pm_node_state t where t.node_key = p_canonical_key);
  delete from pm_node_state where node_key = p_pm_key;

  -- 3. Children keep pointing at a key that is about to disappear; re-parent them onto
  --    the canonical node so the nesting the map already shows survives.
  update pm_nodes set parent_node_key = p_canonical_key where parent_node_key = p_pm_key;

  -- 4. The ruling records what became of the card, and the card itself goes.
  update pm_rulings
  set status = 'ruled', resolved_at = now(), ruled_into_node_key = p_canonical_key
  where node_key = p_pm_key and kind = 'node' and status = 'pending';

  delete from pm_nodes where node_key = p_pm_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8 · Grants — same posture as 0009 and 0001. These are SECURITY INVOKER functions, so
-- RLS still applies to the caller; the EXECUTE revoke is belt-and-braces against
-- Supabase's bootstrap grant, which hands every new public-schema function to anon.
-- ---------------------------------------------------------------------------

revoke execute on function propose_connection(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function propose_connection(text, text, text, text, uuid) to service_role;
revoke execute on function retire_link_ruling(uuid, text) from public, anon, authenticated;
grant execute on function retire_link_ruling(uuid, text) to service_role;
