"use client";

import { useEffect, useState } from "react";
import { getEnginePrototypesAction, type SignedPrototypeVersion } from "@/app/actions/prototypes";

/**
 * Opens a real rendered preview in a new tab, not just the raw bytes. Confirmed live
 * 2026-09-15 (Salman): Supabase's signed-download URL serves every prototype as
 * `Content-Type: text/plain` under a `sandbox` CSP, regardless of what content type it
 * was uploaded with — a deliberate anti-XSS posture for arbitrary Storage objects, not
 * a bug in the upload path, and not something a request header can turn off. Fetching
 * the bytes ourselves and writing them into a same-origin tab sidesteps it: the browser
 * renders whatever we hand it, the same way it would render a page from any other JS
 * string. `window.open` has to fire before the first `await` or Safari and most
 * popup blockers treat the tab as unrequested and kill it.
 */
async function openPreview(url: string) {
  const win = window.open("", "_blank");
  const res = await fetch(url);
  const html = await res.text();
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

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
      <div className="lab">
        LATEST · V{state.latest.version}
        {state.latest.title ? " · " + state.latest.title : ""}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className="act armed" style={{ flex: 1, padding: 13, fontSize: 10 }} onClick={() => openPreview(state.latest!.htmlUrl)}>
          VIEW HTML
        </button>
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
              <span>
                V{v.version}
                {v.title ? " · " + v.title : ""}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="act" style={{ padding: "6px 10px", fontSize: 9 }} onClick={() => openPreview(v.htmlUrl)}>
                  HTML
                </button>
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
