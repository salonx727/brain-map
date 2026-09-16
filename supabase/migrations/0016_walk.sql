-- WALK — the step-through UX viewer under the mind map's UI tab. See the build kit,
-- SALONX_WALK_BUILDKIT v1.7 (2026-09-16), for the full spec; this adapts its proposed
-- build/schema.sql to this repo's own conventions rather than changing its shape.
--
-- Not canon, not a product, never ships (§EN_WALK_SPEC.md §1). Touch points are authored
-- project data — the UI carries an "authored" label so nobody reads one as a canon claim.
--
-- node_id is plain text, not a foreign key. No unified "nodes" table exists to reference:
-- canonical_nodes is keyed (snapshot_id, node_key) and republished per snapshot, so it is
-- not a stable single-row FK target, and every other per-node table in this schema
-- (pm_files.node_key, pm_items.node_key, ...) already points at node identity as plain
-- text for the same reason (0002_pm_layer.sql's own comment). walk_flow.node_id matches
-- BrainNode.id exactly: "engine:E03", "owner:shawn", or a PM node's key.
--
-- Images are links, never bytes (Founder ruling, spec §1.5 / BUILD_PROMPT hard constraint
-- 5). walk_image_version.image_link holds a stable Supabase Storage OBJECT PATH
-- (walk/{node_id}/{screen_id}/{version_id}.png in the existing pm-files bucket), not a
-- URL — a signed URL is minted per request by app/actions/walk.ts and never written back
-- here. figma_link stays a plain Figma URL, design reference only, never the image
-- source — the app never reads it to render a screen.

create table walk_flow (
  id            text primary key,
  node_id       text not null,
  title         text not null,
  start_screen  text,
  created_at    timestamptz not null default now()
);
comment on column walk_flow.node_id is
  'The owning node/module''s key, matching BrainNode.id exactly (e.g. engine:E03). Ownership only — WALK never renders nodes, engines, modules, or data transfer.';

create table walk_screen (
  id               text primary key,
  flow_id          text not null references walk_flow(id),
  title            text not null,
  current_version  text,
  created_at       timestamptz not null default now()
);

create index walk_flow_node_idx on walk_flow(node_id);

alter table walk_flow
  add constraint walk_flow_start_fk foreign key (start_screen) references walk_screen(id);

create table walk_image_version (
  id          text primary key,
  screen_id   text not null references walk_screen(id),
  image_link  text,  -- Storage object path, not a URL — see the file header
  figma_link  text,  -- Figma URL, design reference only
  created_at  timestamptz not null default now()
);

alter table walk_screen
  add constraint walk_screen_version_fk foreign key (current_version) references walk_image_version(id);

create table walk_touch_point (
  id          text primary key,
  screen_id   text not null references walk_screen(id),
  n           integer not null check (n >= 1),
  x           numeric not null check (x >= 0 and x <= 100),
  y           numeric not null check (y >= 0 and y <= 100),
  action      text not null,
  to_screen   text not null references walk_screen(id),
  placed_on   text references walk_image_version(id),
  created_at  timestamptz not null default now(),
  unique (screen_id, n)
);

-- Immutability of image versions (BUILD_PROMPT hard constraint 10) — a trigger, same
-- mechanism style as pm_node_links' endpoint trigger from 0002, not just app discipline.
create or replace function walk_image_version_immutable() returns trigger as $$
begin
  raise exception 'walk_image_version rows are immutable; insert a new version instead';
end; $$ language plpgsql;

create trigger walk_image_version_no_update
  before update or delete on walk_image_version
  for each row execute function walk_image_version_immutable();

-- Same RLS shape as every other table in this schema (0002_pm_layer.sql): anon reads
-- everything, writes nothing directly. The one write path (the seed script, phase 1) runs
-- with the service-role credential, same boundary as pmWriter.ts.
alter table walk_flow enable row level security;
alter table walk_screen enable row level security;
alter table walk_image_version enable row level security;
alter table walk_touch_point enable row level security;

create policy walk_flow_read on walk_flow for select using (true);
create policy walk_screen_read on walk_screen for select using (true);
create policy walk_image_version_read on walk_image_version for select using (true);
create policy walk_touch_point_read on walk_touch_point for select using (true);
