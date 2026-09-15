-- Canon blocker assignment — pushing a COYOTE-declared line between Shawn and
-- Codeman without writing it into COYOTE or minting a pm_items row.
--
-- 0011's pm_item_assignments keys on pm_items.id. A §15 / §00a line has none:
-- it is parsed from COYOTE each publish and shown as read-only BLK. Reassignment
-- therefore needs its own identity, which is a fingerprint of section + qId +
-- text — the same three fields the adapter already uses to build the line.
--
-- assigned_to is an owner card key (owner:shawn / owner:codeman), not a
-- pm_people uuid: the map places work on those cards, and those keys already
-- exist in owners.ts. Deleting a row (or assigning back to the default owner)
-- returns the line to its default: a blocker to Codeman, a question to Shawn.
--
-- Nothing here is written to COYOTE. TO DO stays typed pm_items only.

create table if not exists pm_canon_assignments (
  fingerprint text primary key,
  assigned_to text not null check (assigned_to in ('owner:shawn', 'owner:codeman')),
  text text not null,
  source_section text not null,
  kind text not null check (kind in ('blocker', 'open question')),
  updated_at timestamptz not null default now()
);
comment on table pm_canon_assignments is
  'Current owner of a COYOTE-declared line after a person-to-person move. Fingerprint is the identity; assigned_to is the source of truth. Never written to COYOTE.';

alter table pm_canon_assignments enable row level security;
create policy pm_canon_assignments_read on pm_canon_assignments for select using (true);
-- No insert/update/delete policy for anon — assignCanonBlocker writes through
-- the service-role credential from a Server Action, matching every other PM write.
