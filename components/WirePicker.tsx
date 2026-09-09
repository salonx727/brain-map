"use client";

import { useMemo, useState } from "react";
import type { BrainNode } from "@/lib/types";

export type WireOption = {
  id: string;
  label: string;
  disabled: boolean;
  reason: string;
};

/** COYOTE's own engines/screens — not owner cards, not PM cards. */
function isCanonicalGraphNode(node: BrainNode): boolean {
  return node.origin === "canon" && !node.id.startsWith("owner:");
}

/**
 * Every other card on the map, labelled the way the card itself is labelled.
 *
 * `allowCanonPairs` is the 0010 change. Engine-to-engine used to be unpickable outright,
 * because §35 is the only author of engine-to-engine data flow and the database refused
 * the row. It still is the only author — but there is now a route by which a human can
 * propose one and have Shawn rule on it, so on the propose path the pair is offered and
 * marked RULING rather than hidden. The retarget path leaves it off: moving an existing
 * wire onto a canonical pair would need a ruling of its own, and silently offering an
 * option the database will reject is worse than not offering it.
 */
export function optionsFromModel(
  nodes: Record<string, BrainNode>,
  order: string[],
  fromId: string,
  isWired: (id: string) => boolean,
  allowCanonPairs = false,
): WireOption[] {
  const from = nodes[fromId];
  const fromCanon = !!from && isCanonicalGraphNode(from);
  const ids = [...new Set([...order, ...Object.keys(nodes)])].filter((id) => id !== fromId && nodes[id]);
  return ids.map((oid) => {
    const other = nodes[oid];
    const label = (other.ref + "  " + (other.name || "")).trim();
    if (isWired(oid)) return { id: oid, label, disabled: true, reason: "WIRED" };
    if (fromCanon && isCanonicalGraphNode(other)) {
      if (!allowCanonPairs) return { id: oid, label, disabled: true, reason: "COYOTE" };
      return { id: oid, label, disabled: false, reason: "RULING" };
    }
    return { id: oid, label, disabled: false, reason: "" };
  });
}

/**
 * A scrollable roster of every card, not a native <select>.
 *
 * A phone's native picker hides disabled options and truncates a long list into a
 * wheel that looks empty. This is the same list, searchable, with every card still
 * visible — wired and COYOTE pairs stay in view so the roster is complete even when
 * they are not pickable.
 */
export default function WirePicker({
  options,
  onPick,
  placeholder = "Find a card…",
}: {
  options: WireOption[];
  onPick: (id: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle) || o.id.toLowerCase().includes(needle));
  }, [options, q]);

  return (
    <div className="wirepick">
      <input className="f" value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} />
      <div className="wirepick-list" role="listbox" aria-label="Cards to wire to">
        {!shown.length ? (
          <div className="none" style={{ padding: "12px 4px" }}>
            No card matches.
          </div>
        ) : (
          shown.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-disabled={o.disabled}
              className={"wirepick-row" + (o.disabled ? " off" : "")}
              disabled={o.disabled}
              onClick={() => {
                if (!o.disabled) onPick(o.id);
              }}
            >
              <span>{o.label}</span>
              {o.reason ? <span className="cap">{o.reason}</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
