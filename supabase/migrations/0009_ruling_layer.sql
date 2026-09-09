-- The ruling layer — the only route a map-drawn card has to canon, and the mechanism
-- that retires it once canon carries the same node.
--
-- Nothing here writes canon. COYOTE is written only by Shawn (CLAUDE.md); this layer
-- gives him a queue to rule FROM and gives the map a way to fold a PM card into the
-- canonical node it became, so the same idea never shows as two cards. Both directions
-- of that discipline are enforced below, not just described: retire_pm_node_into_canonical
-- touches no canonical_* table at all, and the pm_node_links endpoint trigger from 0002
-- stays intact through the whole re-point (see step 3 of the function).
--
-- Shawn's ruling, 2026-09-09: every node created on the map goes to his card's ruling
-- list automatically — no send button, no chance of a card never reaching him — and he
-- rules them one at a time. COYOTE will carry no map-generated identifier, so matching a
-- canonical arrival back to its ruling is a confirmed tap, never an automatic delete.

-- ---------------------------------------------------------------------------
-- pm_rulings — one row per map-created node. Its own table, not a column on pm_nodes,
-- because a ruling outlives the node it describes: retirement DELETEs the pm_nodes row
-- and the ruling must survive that to record what became of it. Same reasoning that put
-- pm_node_state in its own table in 0006.
-- ---------------------------------------------------------------------------

create sequence if not exists pm_ruling_ref_seq;

create table if not exists pm_rulings (
  id uuid primary key default gen_random_uuid(),
  ruling_ref text not null unique default ('RUL-' || lpad(nextval('pm_ruling_ref_seq')::text, 3, '0')),
  node_key text not null,
  label text not null,
  parent_node_key text,
  status text not null default 'pending' check (status in ('pending', 'ruled', 'rejected')),

  -- Connection intent, in COYOTE's own §35 vocabulary. connections.ts already reads these
  -- four fields and knows the direction each implies (DOWNSTREAM/EMITS run outward, READS
  -- and TRIGGER run inward), so a ruling phrased this way is one Shawn can transcribe into
  -- COYOTE without translation and one the parser reads back correctly afterwards. Free
  -- text, never a foreign key: this is what a human is PROPOSING, not a resolved edge.
  intent_downstream text,
  intent_reads text,
  intent_emits text,
  intent_trigger text,

  submitted_by uuid references pm_people(id),
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text,
  ruled_into_node_key text
);
comment on table pm_rulings is
  'One pending ruling per map-created node — the queue Shawn rules from. node_key points at a pm_nodes row while pending and is deliberately plain text, not a foreign key, because retirement deletes that row while this one stays. label is snapshotted at submission so the ruling still reads correctly after the PM node is gone. Nothing in this table is canon or becomes canon on its own: Shawn writes COYOTE himself, and ruled_into_node_key is filled only after a human confirms the canonical arrival is this card.';
comment on column pm_rulings.ruling_ref is
  'Human handle (RUL-001) shown on Shawn''s card. Not currently written into COYOTE — he rules in his own language — but held here so an exact-match reconcile becomes possible without a migration if that ever changes.';
comment on column pm_rulings.ruled_into_node_key is
  'The canonical node_key this card became, set only by retire_pm_node_into_canonical. Null for pending and rejected rulings.';

create index if not exists pm_rulings_status_idx on pm_rulings (status);
create index if not exists pm_rulings_node_key_idx on pm_rulings (node_key);

-- One live ruling per node. A rejected or ruled row stays as history; only one may be
-- pending at a time, so the queue can never show the same card twice.
create unique index if not exists pm_rulings_one_pending_per_node
  on pm_rulings (node_key) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Backfill — every PM node that existed before this migration joins the queue. Leaving
-- them outside it would strand real cards in a state the UI has no way to represent.
-- ---------------------------------------------------------------------------

insert into pm_rulings (node_key, label, parent_node_key, submitted_by, submitted_at)
select n.node_key, n.label, n.parent_node_key, n.created_by, n.created_at
from pm_nodes n
where not exists (select 1 from pm_rulings r where r.node_key = n.node_key);

-- ---------------------------------------------------------------------------
-- retire_pm_node_into_canonical — Shawn ruled, COYOTE carries it, the sync published it,
-- and a human confirmed the arrival is this card. Fold the PM row into the canonical one.
--
-- One function, one transaction, because re-pointing touches seven tables and a partial
-- failure would leave a card with its to-dos on one key and its files on another —
-- unrecoverable without hand-written SQL. Application-level steps cannot hold that line.
--
-- Reads canonical_nodes to verify the target exists. Writes nothing canonical, ever.
-- ---------------------------------------------------------------------------

create or replace function retire_pm_node_into_canonical(p_pm_key text, p_canonical_key text)
returns void
language plpgsql
as $$
declare
  v_active uuid;
begin
  if not exists (select 1 from pm_nodes where node_key = p_pm_key) then
    raise exception 'retire_pm_node_into_canonical: no pm_nodes row for %', p_pm_key;
  end if;

  select active_snapshot_id into v_active from canonical_sync_state where id;
  if v_active is null then
    raise exception 'retire_pm_node_into_canonical: no active canonical snapshot — nothing has been published yet';
  end if;

  -- The target must be canon in the CURRENT snapshot, not merely a plausible key. A
  -- retirement aimed at a node the active publish does not contain would delete a real
  -- card and re-point its work onto a key the map cannot draw.
  if not exists (select 1 from canonical_nodes where snapshot_id = v_active and node_key = p_canonical_key) then
    raise exception 'retire_pm_node_into_canonical: % is not a node in the active canonical snapshot', p_canonical_key;
  end if;

  -- 1. Links that would become canonical-to-canonical are DELETED, not re-pointed. This
  --    is the correct outcome rather than an obstacle: once both endpoints are canon the
  --    edge is COYOTE's to declare, and canonical_connections will carry it as soon as
  --    §35 names it. Re-pointing instead would raise on 0002's endpoint trigger and abort
  --    the whole retirement.
  delete from pm_node_links
  where (from_node_key = p_pm_key and exists (select 1 from canonical_nodes where snapshot_id = v_active and node_key = to_node_key))
     or (to_node_key = p_pm_key and exists (select 1 from canonical_nodes where snapshot_id = v_active and node_key = from_node_key));

  -- A link from this node to itself cannot survive the rename either.
  delete from pm_node_links where from_node_key = p_pm_key and to_node_key = p_pm_key;

  update pm_node_links set from_node_key = p_canonical_key where from_node_key = p_pm_key;
  update pm_node_links set to_node_key = p_canonical_key where to_node_key = p_pm_key;

  -- 2. Everything scoped by node_key follows the card to its new identity. This is the
  --    whole point of retiring rather than deleting: a card accrues real work between
  --    being drawn and being ruled, and losing it at the moment of success would teach
  --    the team not to use the map.
  update pm_items set node_key = p_canonical_key where node_key = p_pm_key;
  update pm_notes set node_key = p_canonical_key where node_key = p_pm_key;
  update pm_references set node_key = p_canonical_key where node_key = p_pm_key;

  -- pm_files carries a unique index on (node_key, slot_index) for the four UI slots. If
  -- the canonical card already fills a slot, its own file wins and the PM one falls back
  -- to being an ordinary DROP-tab file rather than being destroyed.
  update pm_files f set slot_index = null
  where f.node_key = p_pm_key
    and f.slot_index is not null
    and exists (select 1 from pm_files c where c.node_key = p_canonical_key and c.slot_index = f.slot_index);
  update pm_files set node_key = p_canonical_key where node_key = p_pm_key;

  -- 3. Position and state are keyed on the canonical node too. Where it already has one,
  --    the canonical value wins — it was there first and is what the map is already
  --    drawing — and the orphaned PM row is dropped.
  insert into pm_layout_positions (layout_id, node_key, x, y, color, updated_by, updated_at)
  select layout_id, p_canonical_key, x, y, color, updated_by, updated_at
  from pm_layout_positions where node_key = p_pm_key
  on conflict (layout_id, node_key) do nothing;
  delete from pm_layout_positions where node_key = p_pm_key;

  insert into pm_node_state (node_key, state, updated_by, updated_at)
  select p_canonical_key, state, updated_by, updated_at
  from pm_node_state where node_key = p_pm_key
  on conflict (node_key) do nothing;
  delete from pm_node_state where node_key = p_pm_key;

  -- 4. Children stay attached to what their parent became.
  update pm_nodes set parent_node_key = p_canonical_key where parent_node_key = p_pm_key;

  -- 5. The PM row is gone; canon now holds this node. No duplicate.
  delete from pm_nodes where node_key = p_pm_key;

  update pm_rulings
  set status = 'ruled',
      ruled_into_node_key = p_canonical_key,
      resolved_at = now()
  where node_key = p_pm_key and status = 'pending';
end;
$$;

comment on function retire_pm_node_into_canonical(text, text) is
  'Folds a PM node into the canonical node it became after Shawn''s ruling reached COYOTE and synced. Re-points items/notes/references/files/positions/state/children, drops links that would become canonical-to-canonical (COYOTE declares those), deletes the pm_nodes row, and marks the ruling ruled. Reads canonical_nodes to validate the target; writes no canonical table.';

-- ---------------------------------------------------------------------------
-- RLS — same posture as every other PM table (0002): anon may SELECT, and nothing else.
-- All writes go through Server Actions holding the service-role credential.
-- ---------------------------------------------------------------------------

alter table pm_rulings enable row level security;
create policy pm_rulings_read on pm_rulings for select using (true);
