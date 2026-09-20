"use client";

import { useEffect, useState } from "react";

/**
 * Confirmed live 2026-09-18 (Salman): a tab left open across a redeploy can end up holding
 * two JS chunks from different builds that don't agree on shape — "e[o] is not a function,"
 * not a real bug, just version skew. This app got redeployed many times in one session, so
 * the failure mode is real, not theoretical.
 *
 * Deliberately not a blind catch-all for "is not a function" — that pattern is far too
 * broad and would swallow real regressions behind an auto-reload instead of surfacing them.
 * Compares this tab's own build id (baked into the page at build time, in __NEXT_DATA__)
 * against whatever the server is serving right now. A mismatch means a newer build exists;
 * that is the actual, unambiguous signal, not a guess from an error message's wording.
 *
 * A banner, not a forced reload — a hold on a touch point or an open modal is real, unsaved
 * (to the extent "unsaved" exists here) intent for a few seconds, and interrupting it to fix
 * a problem that has not happened yet is worse than the problem.
 */
const CHECK_INTERVAL_MS = 90_000;

function currentBuildId(): string | null {
  const el = document.getElementById("__NEXT_DATA__");
  if (!el?.textContent) return null;
  try {
    return (JSON.parse(el.textContent) as { buildId?: string }).buildId ?? null;
  } catch {
    return null;
  }
}

export default function DeployWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = currentBuildId();
    if (!mine) return;

    async function check() {
      try {
        const res = await fetch("/", { cache: "no-store" });
        const html = await res.text();
        const match = /"buildId":"([^"]+)"/.exec(html);
        if (match && match[1] !== mine) setStale(true);
      } catch {
        // A network blip here is not news — the next interval tries again.
      }
    }

    const onFocus = () => void check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!stale) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "rgba(8,8,8,0.92)",
        border: "1px solid var(--baton, #FF8A14)",
        borderRadius: 14,
        padding: "12px 16px",
        fontFamily: "var(--font-space-mono, monospace)",
        fontSize: 11,
        letterSpacing: "0.06em",
        color: "#fff",
      }}
    >
      A newer version is live — this tab is running an older one.
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "var(--baton, #FF8A14)",
          color: "#0A0A0A",
          border: "none",
          borderRadius: 10,
          padding: "8px 12px",
          fontFamily: "inherit",
          fontSize: 11,
          letterSpacing: "0.06em",
          cursor: "pointer",
        }}
      >
        RELOAD
      </button>
    </div>
  );
}
