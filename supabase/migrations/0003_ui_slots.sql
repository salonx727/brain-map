-- The four fixed UI-tab image slots, matching Shawn's actual intake reference
-- (INTAKE_NOTES.md, SalonX_Brain_v5 package): "Each of the four slots is a `+` that
-- opens the picker... The UI chip counts filled slots only." One column, not a second
-- table — pm_files already carries everything a slot needs (storage_path, file_name,
-- content_type, size_bytes); a nullable slot_index discriminates an ordinary DROP-tab
-- file (null) from one of the four UI slots (0–3), the same one-table-with-
-- discriminator pattern already used for pm_items.kind and pm_notes.kind.
--
-- Explicit CODEMAN call per the v5 handoff's own §4.4a ("one table with slot_index, or
-- two row types — yours, invisible in use"): one table, discriminator column.

alter table pm_files add column if not exists slot_index integer check (slot_index is null or slot_index between 0 and 3);
comment on column pm_files.slot_index is
  'Null = an ordinary DROP-tab file. 0-3 = one of the four fixed UI-tab image slots. A slot holds exactly one file — see the unique index below.';

-- At most one file per (node_key, slot_index) when a slot is actually in use. The
-- writer (pmWriter.setUiSlot) deletes any existing row at that slot before inserting a
-- new one, so this index is a backstop against a race, not the primary mechanism —
-- same "trust the app, but don't only trust the app" posture as pm_node_links' trigger.
create unique index if not exists pm_files_one_per_slot on pm_files (node_key, slot_index) where slot_index is not null;
