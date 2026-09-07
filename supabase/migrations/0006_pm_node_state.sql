-- Work-state (UNTOUCHED / IN_BUILD / BLOCKED / DONE / OUT_OF_SCOPE) is a fact about a
-- node, not about how it's arranged on screen — it must read the same across every named
-- layout (pm_layouts already supports more than one). pm_layout_positions is scoped to
-- exactly one layout_id on purpose (position and colour ARE presentation, and are allowed
-- to differ per named arrangement); state has no such scoping, so it does not belong
-- there. A dedicated, single-purpose table, keyed by node_key exactly like
-- pm_layout_positions and pm_node_links already are — same "plain text, never a
-- cross-schema FK" rationale, since node_key may point at a canonical_nodes row (an
-- engine, say) or a pm_nodes row, and this table must never gain a write dependency on
-- which one it is.

create table if not exists pm_node_state (
  node_key text primary key,
  state text not null default 'UNTOUCHED' check (state in ('UNTOUCHED', 'IN_BUILD', 'BLOCKED', 'DONE', 'OUT_OF_SCOPE')),
  updated_by uuid references pm_people(id),
  updated_at timestamptz not null default now()
);
comment on table pm_node_state is
  'One global work-state per node_key, independent of any layout. A canonical node (e.g. an engine) may carry a real state here even though it has no pm_nodes row of its own — same node_key-as-plain-text pattern as pm_layout_positions/pm_node_links, not a foreign key, so this table stays independently grantable from both the canonical and PM tables it can reference.';

alter table pm_node_state enable row level security;
create policy pm_node_state_read on pm_node_state for select using (true);
-- No insert/update/delete policy for anon — same deny-by-default posture as every other
-- table in this app; all real writes go through the service-role credential via a Server
-- Action (see src/app/actions/pm.ts / setNodeStateAction).
