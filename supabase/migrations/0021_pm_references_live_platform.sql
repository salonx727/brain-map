-- Live-platform reference — Codeman, 2026-09-18: the Brain and salonx.com are two separate
-- platforms. A module's prototype (Storage HTML) and its real live route on salonx.com are
-- two different links that can both exist on the same node. pm_references already models
-- exactly "a URL + label on a node"; this just adds the one new ref_type needed to tell a
-- live-platform link apart from a plain reference link.

alter table pm_references drop constraint if exists pm_references_ref_type_check;
alter table pm_references add constraint pm_references_ref_type_check
  check (ref_type in ('figma', 'wireframe', 'ui_slot', 'link', 'live_platform'));
