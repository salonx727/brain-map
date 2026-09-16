-- 0003_ui_slots.sql capped slot_index at 0-3 for the four fixed UI-tab picker slots.
-- Salman, 2026-09-15: any number of screenshots may be added, none evicted by adding
-- more — the first 4 render on the card face, the rest reachable through VIEW ALL.
-- slot_index is still the append-order position (see pmWriter.addUiScreenshot), just no
-- longer bounded to four.

alter table pm_files drop constraint if exists pm_files_slot_index_check;
alter table pm_files add constraint pm_files_slot_index_check check (slot_index is null or slot_index >= 0);

comment on column pm_files.slot_index is
  'Null = an ordinary DROP-tab file. 0+ = a UI-tab screenshot''s append-order position, unbounded since 2026-09-15 — see addUiScreenshot. The one-per-(node_key, slot_index) unique index from 0003 is unchanged and still correct.';
