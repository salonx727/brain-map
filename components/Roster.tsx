"use client";

import { useBrain } from "@/lib/brain";
import { useIntake } from "@/lib/intake";
import { uiStateToDb } from "@/lib/adapter";
import { deleteFileAction, setNodeStateAction } from "@/app/actions/pm";
import { STATES } from "@/lib/seed";
import type { BrainNode } from "@/lib/types";

export type RosterMode =
  | { kind: "state"; id: string }
  /** AI above, INTAKE below — one door, two tabs */
  | { kind: "hub"; tab: 0 | 1 };

export default function Roster({
  mode,
  onClose,
  onHubTab,
  provider,
  setProvider,
}: {
  mode: RosterMode;
  onClose: () => void;
  onHubTab: (tab: 0 | 1) => void;
  provider: string | null;
  setProvider: (p: string | null) => void;
}) {
  const { model, bump, persist } = useBrain();
  const intake = useIntake();

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
        role="dialog"
        aria-label={mode.kind === "state" ? "Node state roster" : "Intake and AI"}
      >
        <div className="head">
          <div>
            <div className="eyebrow">
              {mode.kind === "state" ? "STATE" : "CC · CLAUDE COMM · HELD §367"}
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
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {(["INTAKE", "AI"] as const).map((label, i) => (
                <button
                  key={label}
                  className={"act" + (mode.tab === i ? " armed" : "")}
                  style={{ flex: 1, padding: 13, fontSize: 10 }}
                  onClick={() => onHubTab(i as 0 | 1)}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode.tab === 0 ? (
              <>
                <div className="intake">
                  <button onClick={() => intake.pickPhotos("unrouted")}>
                    <span className="plus">+</span>
                    <span>PHOTOS</span>
                  </button>
                  <button onClick={() => intake.pickCamera("unrouted")}>
                    <span className="plus">+</span>
                    <span>CAMERA</span>
                  </button>
                  <button onClick={() => intake.pickFiles("unrouted")}>
                    <span className="plus">+</span>
                    <span>FILES</span>
                  </button>
                </div>

                {!model.unrouted.length ? (
                  <div className="none">
                    Nothing waiting. Anything dropped here sits until it has a home.
                  </div>
                ) : (
                  model.unrouted.map((f, i) => (
                    <div className="item" key={f.id ?? i}>
                      <span>{f.name}</span>
                      <button
                        className="minus"
                        aria-label="Remove"
                        onClick={() => {
                          const prior = model.unrouted.slice();
                          model.unrouted.splice(i, 1);
                          bump();
                          if (!f.id) return;
                          persist(
                            () => deleteFileAction(f.id as string),
                            () => {
                              model.unrouted = prior;
                            },
                          );
                        }}
                      >
                        <span />
                      </button>
                    </div>
                  ))
                )}

                <div className="foot" style={{ marginTop: 16 }}>
                  UNROUTED IS A STATE, NOT AN ERROR
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {["CLAUDE", "GPT", "OTHER"].map((pv) => (
                    <button
                      key={pv}
                      className={"act" + (provider === pv ? " armed" : "")}
                      style={{ padding: "13px 15px", fontSize: 10 }}
                      onClick={() => setProvider(provider === pv ? null : pv)}
                    >
                      {pv}
                    </button>
                  ))}
                </div>
                <div className="foot" style={{ marginTop: 18 }}>
                  READ ONLY · THE AI READS THE MAP AND ANSWERS AGAINST IT · IT DOES NOT
                  WRITE · BRING YOUR OWN KEY · NO KEY IS STORED HERE
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
