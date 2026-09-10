"use client";

// The queue on Shawn's card. Everything drawn on the map lands here and waits — his
// instruction, 2026-09-09: all of them reach him, and he takes them one at a time. Cards
// since that day, wires since 0010.
//
// There is no APPROVE button, deliberately. Approving is writing COYOTE, and COYOTE has
// exactly one author. What he does here is read the proposal, COPY the §35 block, and rule
// it in the brain in his own words; it then arrives back on the map through the ordinary
// sync — a card through the reconcile tray, a wire automatically, because an edge matches
// on node keys rather than on a label. The only action this list offers is REJECT, because
// that outcome has no COYOTE entry to wait for.

import { useEffect, useRef, useState } from "react";
import { useBrain } from "@/lib/brain";
import { rejectRulingAction, rejectRulingByIdAction } from "@/app/actions/rulings";
import { coyoteBlockForConnection, coyoteBlockForNode, connectionSummary } from "@/lib/pm/coyoteText";
import type { PmRuling } from "@/lib/types/pm";

function IntentLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="cap" style={{ marginTop: 4 }}>
      {label} · {value}
    </div>
  );
}

/**
 * The block itself is shown, not just copied. A copy button whose contents are invisible
 * asks him to paste something into canon sight-unseen, which is the one place in this app
 * where that would be unacceptable.
 */
function CoyoteBlock({ text }: { text: string }) {
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  function flash(message: string) {
    setNote(message);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(null), 1600);
  }

  function copy() {
    if (!navigator.clipboard) {
      flash("COPY UNAVAILABLE");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => flash("COPIED"),
      () => flash("COPY UNAVAILABLE"),
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <pre className="coyote-block">{text}</pre>
      <button className="act" style={{ padding: "6px 10px", fontSize: 9, marginTop: 6 }} onClick={copy}>
        {note ?? "COPY §35 BLOCK"}
      </button>
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
        <div className="cap">EVERY CARD AND WIRE DRAWN ON THE MAP ARRIVES HERE · NONE REACHES CANON WITHOUT A RULING</div>
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
    const priorLinks = model.links.slice();
    model.rulings = model.rulings.filter((r) => r.id !== ruling.id);

    if (ruling.kind === "link") {
      // A rejected wire is removed. Unlike a card it holds nothing but the assertion Shawn
      // just declined, and leaving it drawn would keep making that claim on the map.
      model.links = model.links.filter((l) => l.id !== ruling.linkId);
      bump();
      persist(
        () => rejectRulingByIdAction(ruling.id),
        () => {
          model.rulings = prior;
          model.links = priorLinks;
        },
      );
      return;
    }

    const card = ruling.nodeKey ? model.nodes[ruling.nodeKey] : undefined;
    // The card itself stays put — rejected means "not canon", not "gone". It keeps its
    // to-dos and files and simply reads OUT OF SCOPE from here on.
    if (card) {
      card.awaitingRuling = false;
      card.rulingRef = undefined;
      card.state = "OUT OF SCOPE";
    }
    bump();
    persist(
      () => rejectRulingAction(ruling.nodeKey as string),
      () => {
        model.rulings = prior;
        if (card) {
          card.awaitingRuling = true;
          card.rulingRef = ruling.rulingRef;
        }
      },
    );
  }

  function labelOf(key: string | null): string {
    if (!key) return "?";
    const node = model.nodes[key];
    if (!node) return key;
    // A blank ref+name must never render as a blank line in a ruling — that leaves
    // "§35 — " with nothing after the dash, unusable text to hand Shawn. Fall back to
    // something that names the gap instead of hiding it.
    return `${node.ref} ${node.name}`.trim() || "UNNAMED CARD";
  }

  return (
    <div className="sect">
      {rulings.map((r) => {
        const isLink = r.kind === "link";
        const onMap = !isLink && Boolean(r.nodeKey && model.nodes[r.nodeKey]);

        const headline = isLink && r.relation
          ? connectionSummary(labelOf(r.fromNodeKey), r.relation, labelOf(r.toNodeKey))
          : r.label;

        const block = isLink && r.relation
          ? coyoteBlockForConnection({
              fromLabel: labelOf(r.fromNodeKey),
              toLabel: labelOf(r.toNodeKey),
              relation: r.relation,
              rulingRef: r.rulingRef,
            })
          : coyoteBlockForNode(r);

        return (
          <div className="item" key={r.id} style={{ display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span className="mono">{r.rulingRef}</span>
              <span style={{ flex: 1 }}>{headline}</span>
              <span className="cap">{isLink ? "WIRE" : "CARD"}</span>
            </div>

            {!isLink ? (
              <>
                <IntentLine label="DOWNSTREAM" value={r.intent.downstream} />
                <IntentLine label="READS" value={r.intent.reads} />
                <IntentLine label="EMITS" value={r.intent.emits} />
                <IntentLine label="TRIGGER" value={r.intent.trigger} />
              </>
            ) : null}

            <CoyoteBlock text={block} />

            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {onMap ? (
                <button className="act" style={{ padding: "6px 10px", fontSize: 9 }} onClick={() => onOpenCard(r.nodeKey as string)}>
                  OPEN CARD
                </button>
              ) : null}
              <button
                className={"act" + (armed === r.id ? " armed" : "")}
                style={{ padding: "6px 10px", fontSize: 9 }}
                onClick={() => reject(r)}
              >
                {armed === r.id
                  ? isLink
                    ? "TAP AGAIN · REMOVES THE WIRE"
                    : "TAP AGAIN · MARKS IT OUT OF SCOPE"
                  : "REJECT"}
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
