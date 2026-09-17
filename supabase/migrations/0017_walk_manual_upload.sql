-- WALK manual upload — Shawn's ruling, 2026-09-17: plain manual upload (no Figma
-- frame-picker), with a staging tray, "move to…" placement, and a change log that
-- notifies him. Supersedes Phase 2 task C's Figma-picker flow; everything else in that
-- task list stands (see the vault brief filed the same day).
--
-- Two tables:
--
-- walk_staged_image — an uploaded file that hasn't been placed into a flow yet. Not a
-- walk_image_version: it has no screen, no ID, nothing WALK's derivation logic can see —
-- exactly "unassigned" per spec. Once placed (replace/new-screen/insert), the matching row
-- here is deleted; the file itself is copied to its real walk/{node}/{screen}/{version}.png
-- path first, so the staging object and the canonical object are never the same object —
-- a stale tray reference can never point at something the flow is now using.
--
-- walk_change_log — one row per placement (replace / new screen / insert), written before
-- the CommandOS watcher notifies Shawn. `notified` is the watcher's own dedup marker (same
-- shape as coyote_watch_state.json's "have I already announced this" job, just table-backed
-- since multiple change kinds need independent tracking here, not one file's mtime).
-- Never a canon write — matches the Founder decision that nothing writes COYOTE
-- automatically.

create table walk_staged_image (
  id            uuid primary key default gen_random_uuid(),
  node_id       text not null,
  file_name     text not null,
  storage_path  text not null,
  content_type  text,
  uploaded_at   timestamptz not null default now()
);
create index walk_staged_image_node_idx on walk_staged_image(node_id);

create table walk_change_log (
  id              uuid primary key default gen_random_uuid(),
  node_id         text not null,
  screen_id       text,
  kind            text not null check (kind in ('replaced', 'new_screen', 'inserted')),
  old_version_id  text,
  new_version_id  text,
  file_name       text,
  detail          text,
  notified        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index walk_change_log_node_idx on walk_change_log(node_id);
create index walk_change_log_unnotified_idx on walk_change_log(created_at) where not notified;

-- Same RLS shape as 0016_walk.sql: anon reads, writes only via the service-role credential.
alter table walk_staged_image enable row level security;
alter table walk_change_log enable row level security;

create policy walk_staged_image_read on walk_staged_image for select using (true);
create policy walk_change_log_read on walk_change_log for select using (true);
