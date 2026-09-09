"use client";

// After a sync, some canonical arrivals look like cards someone drew. This asks about
// each one and does nothing until a human answers.
//
// The tap is the whole safety mechanism. Shawn rules in his own language, so COYOTE
// carries no map-generated identifier and a label match is the only available signal —
// and a label match is not proof. Retiring the wrong card would delete real work
// (to-dos, screenshots, wires it collected while it waited), so this suggests and stops.

import { useState } from "react";
import { retireRulingAction } from "@/app/actions/rulings";
import type { ReconcileCandidate } from "@/lib/pm/rulingReader";

export default function ReconcileTray({ candidates }: { candidates: ReconcileCandidate[] }) {
  // Dismissal is per session on purpose — not persisted. A "no" today usually means "not
  // this one, not yet", and burning it into the database would hide the match forever.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const open = candidates.filter((c) => !dismissed.includes(c.ruling.id));
  if (!open.length) return null;

  return (
    <div id="reconcile" className="open" role="dialog" aria-label="Canonical arrivals to reconcile">
      <div className="cap">CANON HAS ARRIVED · IS THIS YOUR CARD?</div>
      {open.map(({ ruling, matches }) => (
        <div className="item" key={ruling.id} style={{ display: "block" }}>
          <div className="mono" style={{ marginBottom: 6 }}>
            {ruling.rulingRef} · {ruling.label}
          </div>
          {matches.map((m) => (
            <button
              key={m.nodeKey}
              className="act"
              style={{ width: "100%", marginBottom: 6 }}
              disabled={busy === ruling.id}
              onClick={async () => {
                setBusy(ruling.id);
                try {
                  await retireRulingAction(ruling.nodeKey, m.nodeKey);
                  setDismissed((d) => [...d, ruling.id]);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === ruling.id ? "RETIRING…" : `YES · IT IS ${m.label}`}
            </button>
          ))}
          <button className="act" style={{ width: "100%" }} onClick={() => setDismissed((d) => [...d, ruling.id])}>
            NOT THIS ONE
          </button>
        </div>
      ))}
      <div className="cap">YES FOLDS THE CARD IN · ITS TO-DOS, FILES AND WIRES MOVE ACROSS</div>
    </div>
  );
}
