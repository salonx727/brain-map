-- Fixes a real, confirmed defect: a PM-created node's `node_key` is `pm:<uuid>` — the
-- uuid is the permanent identity and was never meant to be shown, but the UI derived its
-- on-screen ref by slicing the key after its class prefix, which for a PM node IS the
-- raw uuid. v5.2's own CODEMAN notes flag this exact leak against the deployed build
-- ("47A12B1-8755-4290-A15A-..." with label "NEW SUB-NODE").
--
-- Fix: a separate, human-readable display_ref, assigned once at creation, never the
-- key. The uuid-bearing node_key is unchanged and remains the only real identity —
-- display_ref is presentation only and can be safely regenerated without touching any
-- reference to this node (pm_layout_positions, pm_items, pm_node_links, etc. all key on
-- node_key, never on display_ref).

alter table pm_nodes add column if not exists display_ref text;
comment on column pm_nodes.display_ref is
  'Human-readable display handle (e.g. SUB-1, FN-1), assigned once at creation — never the node_key/uuid. Presentation only; every other table keys on node_key.';

-- Backfill any PM nodes created before this column existed, sequentially per kind,
-- ordered by creation time — so the one real production node observed with a leaking
-- uuid gets a real ref instead of staying null.
with numbered as (
  select node_key, kind, row_number() over (partition by kind order by created_at) as n
  from pm_nodes
  where display_ref is null
)
update pm_nodes p
set display_ref = case when numbered.kind = 'function' then 'FN-' || numbered.n else 'SUB-' || numbered.n end
from numbered
where p.node_key = numbered.node_key;
