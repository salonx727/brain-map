-- Hide a screen from WALK — Shawn, 2026-09-17: "we always have to see it, that doesn't
-- make sense." walk_image_version staying immutable forever is deliberate (BUILD_PROMPT
-- hard constraint 10 — the audit trail of what an image used to be); a screen being stuck
-- in view forever just because it once got an image was never the intent. This is a
-- visibility flag on the screen, not a way around the version trigger — the image rows
-- underneath a hidden screen are exactly as permanent as before.

alter table walk_screen add column hidden boolean not null default false;

alter table walk_change_log drop constraint walk_change_log_kind_check;
alter table walk_change_log add constraint walk_change_log_kind_check
  check (kind in ('replaced', 'new_screen', 'inserted', 'branched', 'hidden'));
