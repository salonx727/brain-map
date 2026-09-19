-- Soft-delete for pm_files — Shawn, 2026-09-17: "anything deleted will be held in a
-- deleted photo file" rather than gone outright. Same posture as 0019's walk_screen.hidden:
-- a visibility flag, not a data-destroying delete. The Storage object moves under a
-- deleted/ prefix in the same bucket rather than being removed, so the row and its bytes
-- stay together and recoverable.

alter table pm_files add column deleted_at timestamptz;
