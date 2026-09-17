-- WALK branch from an existing screen — Shawn, 2026-09-17: "Insert after…" only ever
-- extends the main sequence (screen 3 keeps pointing at the new screen instead of screen
-- 4). A genuine branch is different: screen 3 keeps its existing next screen AND gains a
-- second touch point going somewhere new — that's a lane, not a longer main path. Nothing
-- in 0016/0017 could record that distinctly in the change log.

alter table walk_change_log drop constraint walk_change_log_kind_check;
alter table walk_change_log add constraint walk_change_log_kind_check
  check (kind in ('replaced', 'new_screen', 'inserted', 'branched'));
