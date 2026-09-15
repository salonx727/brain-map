"use client";

import { useBrain } from "@/lib/brain";
import { uiStateToDb } from "@/lib/adapter";
import { setNodeStateAction } from "@/app/actions/pm";
import { STATES } from "@/lib/seed";
import type { BrainNode } from "@/lib/types";
import AiPanel from "./AiPanel";
import IntakePanel from "./IntakePanel";

export type RosterMode =
  | { kind: "state"; id: string }
  /** AI above, INTAKE below — one door, two tabs */
  | { kind: "hub"; tab: 0 | 1; draft?: string };

export default function Roster({
  mode,
  onClose,
  onHubTab,
}: {
  mode: RosterMode;
  onClose: () => void;
  onHubTab: (tab: 0 | 1) => void;
}) {
  const { model, bump, persist } = useBrain();

  const d: BrainNode | null = mode.kind === "state" ? model.nodes[mode.id] ?? null : null;

  return (
    <div
      id="roster"
      className="open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="rosterCard"
        // The hub gets a fixed frame; the state picker is four buttons and should stay
        // the size of four buttons.
        className={mode.kind === "hub" ? "hub" : undefined}
        role="dialog"
        aria-label={mode.kind === "state" ? "Node state roster" : "Intake and AI"}
      >
        <div className="head">
          <div>
            <div className="eyebrow">
              {mode.kind === "state" ? "STATE" : "HUB"}
            </div>
            <div className="title">
              {mode.kind === "state"
                ? d
                  ? d.name || d.ref
                  : ""
                : mode.tab === 0
                  ? "Intake"
                  : "AI"}
            </div>
          </div>
          <button className="dismiss" aria-label="Dismiss" onClick={onClose}>
            <span />
          </button>
        </div>

        {mode.kind === "state" ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {STATES.map((st) => (
                <button
                  key={st}
                  className={"act" + (d && d.state === st ? " armed" : "")}
                  style={{ padding: "13px 15px", fontSize: 10 }}
                  onClick={() => {
                    if (!d) return;
                    const was = d.state;
                    d.state = st;
                    bump();
                    // Work state is global per node_key and independent of any layout, so
                    // it attaches to a canonical engine exactly as it does to a PM card.
                    persist(
                      () => setNodeStateAction(d.id, uiStateToDb(st)),
                      () => {
                        d.state = was;
                      },
                    );
                  }}
                >
                  {st}
                </button>
              ))}
            </div>
            <div className="foot" style={{ marginTop: 18 }}>
              STATE IS THE SAME FIVE WORDS EVERYWHERE ON THE MAP
            </div>
          </>
        ) : (
          <>
            <div className="seg">
              {(["INTAKE", "AI"] as const).map((label, i) => (
                <button
                  key={label}
                  className={mode.tab === i ? "on" : undefined}
                  onClick={() => onHubTab(i as 0 | 1)}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode.tab === 0 ? <IntakePanel /> : <AiPanel draft={mode.draft} />}
          </>
        )}
      </div>
    </div>
  );
}
