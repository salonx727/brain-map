-- Item assignment — pushing an existing blocker/to-do between Shawn and Codeman without
-- retyping it.
--
-- pm_items already carried owner_id (0002) and pm_people already carried the directory it
-- points at — both sat unused: no component read owner_id, no action ever wrote it after
-- creation, and pm_people had zero rows. This migration finishes what 0002 started rather
-- than inventing a second ownership concept: reassignment is just an owner_id update, so
-- title/detail/kind/status/node_key/references never move.
--
-- Two things below:
-- 1. pm_people gets a uniqueness guarantee on name and its two V1 rows (Shawn, Codeman) —
--    without this, "assign to Codeman" has no stable id to resolve the name to, and a
--    second createPerson("Codeman") call would silently fork the directory.
-- 2. pm_item_assignments — an append-only log, one row per reassignment. Optional by the
--    task's own instruction ("keep history if the schema supports it") — reassignItem
--    writes the owner_id change first and this log second, and a failure writing this
--    table never blocks or rolls back the actual reassignment.

alter table pm_people
  add constraint pm_people_name_key unique (name);

insert into pm_people (name)
values ('Shawn'), ('Codeman')
on conflict (name) do nothing;

create table if not exists pm_item_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references pm_items(id) on delete cascade,
  from_owner_id uuid references pm_people(id),
  to_owner_id uuid references pm_people(id),
  changed_by uuid references pm_people(id),
  changed_at timestamptz not null default now()
);
comment on table pm_item_assignments is
  'Append-only. One row per owner_id change on pm_items — never updated, never the source of truth for current ownership (pm_items.owner_id is). from_owner_id is null for an item that had never been assigned before.';

alter table pm_item_assignments enable row level security;
create policy pm_item_assignments_read on pm_item_assignments for select using (true);
-- No insert/update/delete policy for anon, matching every other table in this layer —
-- reassignItem writes through the service-role credential from a Server Action.
