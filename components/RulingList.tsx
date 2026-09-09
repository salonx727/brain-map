"use client";

// The queue on Shawn's card. Every node drawn on the map lands here and waits — his
// instruction, 2026-09-09: all of them reach him, and he takes them one at a time.
//
// There is no APPROVE button, deliberately. Approving is writing COYOTE, and COYOTE has
// exactly one author. What he does here is read the proposal and, when he rules yes, rule
// it in the brain and write it himself; the card then arrives back on the map through the
// ordinary sync, and the reconcile tray clears the duplicate. The only action this list
// offers is REJECT, because that outcome has no COYOTE entry to wait for.

import { useEffect, useRef, useState } from "react";
import { useBrain } from "@/lib/brain";
import { rejectRulingAction } from "@/app/actions/rulings";
import type { PmRuling } from "@/lib/types/pm";

function IntentLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="cap" style={{ marginTop: 4 }}>
      {label} · {value}
    </div>
  );
}

export default function RulingList({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { model, bump, persist } = useBrain();
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const rulings = model.rulings;

  if (!rulings.length) {
    return (
      <div className="sect">
        <div className="none">Nothing waiting on a ruling.</div>
        <div className="cap">EVERY CARD DRAWN ON THE MAP ARRIVES HERE · NONE REACHES CANON WITHOUT A RULING</div>
      </div>
    );
  }

  function reject(ruling: PmRuling) {
    if (armed !== ruling.id) {
      setArmed(ruling.id);
      timer.current = window.setTimeout(() => setArmed(null), 5000);
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    setArmed(null);

    const prior = model.rulings.slice();
    model.rulings = model.rulings.filter((r) => r.id !== ruling.id);
    const card = model.nodes[ruling.nodeKey];
    // The card itself stays put — rejected means "not canon", not "gone". It keeps its
    // to-dos and files and simply reads OUT OF SCOPE from here on.
    if (card) {
      card.awaitingRuling = false;
      card.rulingRef = undefined;
      card.state = "OUT OF SCOPE";
    }
    bump();
    persist(
      () => rejectRulingAction(ruling.nodeKey),
      () => {
        model.rulings = prior;
        if (card) {
          card.awaitingRuling = true;
          card.rulingRef = ruling.rulingRef;
        }
      },
    );
  }

  return (
    <div className="sect">
      {rulings.map((r) => {
        const onMap = Boolean(model.nodes[r.nodeKey]);
        return (
          <div className="item" key={r.id} style={{ display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span className="mono">{r.rulingRef}</span>
              <span style={{ flex: 1 }}>{r.label}</span>
            </div>

            <IntentLine label="DOWNSTREAM" value={r.intent.downstream} />
            <IntentLine label="READS" value={r.intent.reads} />
            <IntentLine label="EMITS" value={r.intent.emits} />
            <IntentLine label="TRIGGER" value={r.intent.trigger} />

            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {onMap ? (
                <button className="act" style={{ padding: "6px 10px", fontSize: 9 }} onClick={() => onOpenCard(r.nodeKey)}>
                  OPEN CARD
                </button>
              ) : null}
              <button
                className={"act" + (armed === r.id ? " armed" : "")}
                style={{ padding: "6px 10px", fontSize: 9 }}
                onClick={() => reject(r)}
              >
                {armed === r.id ? "TAP AGAIN · MARKS IT OUT OF SCOPE" : "REJECT"}
              </button>
            </div>
          </div>
        );
      })}

      <div className="cap" style={{ marginTop: 12 }}>
        RULE THESE IN THE BRAIN · A YES IS WRITTEN INTO COYOTE, NOT TAPPED HERE
      </div>
    </div>
  );
}
