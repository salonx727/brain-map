"use client";

import { useEffect, useState } from "react";
import { getEnginePrototypesAction, type SignedPrototypeVersion } from "@/app/actions/prototypes";

/**
 * An engine's UI prototype history — Latest up top with its two links, everything
 * earlier listed below. Read-only: there is no "make this the latest" control anywhere
 * here on purpose. The version that renders as latest is always whichever one has the
 * highest number in Storage, computed server-side every time this opens — never a
 * value this component could disagree with by holding a stale one.
 */
export default function PrototypePanel({ engineKey }: { engineKey: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; latest: SignedPrototypeVersion | null; previous: SignedPrototypeVersion[] }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getEnginePrototypesAction(engineKey)
      .then(({ latest, previous }) => {
        if (!cancelled) setState({ status: "ready", latest, previous });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [engineKey]);

  if (state.status === "loading") return <div className="none">Checking Storage…</div>;
  if (state.status === "error") return <div className="none">{state.message}</div>;
  if (!state.latest) {
    return <div className="none">No prototype uploaded yet for this engine.</div>;
  }

  return (
    <div className="sect">
      <div className="lab">LATEST · V{state.latest.version}</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <a className="act armed" style={{ flex: 1, padding: 13, fontSize: 10, textAlign: "center" }} href={state.latest.htmlUrl} target="_blank" rel="noreferrer">
          VIEW HTML
        </a>
        {state.latest.figmaUrl ? (
          <a className="act" style={{ flex: 1, padding: 13, fontSize: 10, textAlign: "center" }} href={state.latest.figmaUrl} target="_blank" rel="noreferrer">
            OPEN FIGMA
          </a>
        ) : null}
      </div>

      {state.previous.length ? (
        <>
          <div className="cap" style={{ marginBottom: 8 }}>
            PREVIOUS
          </div>
          {state.previous.map((v) => (
            <div className="item" key={v.version} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span>V{v.version}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <a className="act" style={{ padding: "6px 10px", fontSize: 9 }} href={v.htmlUrl} target="_blank" rel="noreferrer">
                  HTML
                </a>
                {v.figmaUrl ? (
                  <a className="act" style={{ padding: "6px 10px", fontSize: 9 }} href={v.figmaUrl} target="_blank" rel="noreferrer">
                    FIGMA
                  </a>
                ) : null}
              </span>
            </div>
          ))}
        </>
      ) : null}

      <div className="foot" style={{ marginTop: 14 }}>
        UPLOADED VIA TELEGRAM · THIS PANEL NEVER PICKS THE VERSION — STORAGE DOES
      </div>
    </div>
  );
}
