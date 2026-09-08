"use client";

// The hub's AI tab, and the choice of which engine answers.
//
// BRAIN is the agent Telegram talks to — a Claude Agent SDK session running on Shawn's
// machine with the workspace, the vault and Bash in reach. It can do everything the
// Telegram surface can, because it is the Telegram surface's agent; the only cost is that
// CommandOS has to be running.
//
// MAP is the serverless one. It reads the graph this app draws and proposes writes onto
// it, and it works when nothing is running at home. It cannot see the vault or a file's
// contents and never will — it lives in a Vercel function with no filesystem.
//
// Two engines rather than one because they fail in opposite directions, and hiding that
// behind a single button would mean the hub silently answered a vault question from a
// model that has never seen the vault.

import { useState } from "react";
import BrainChat from "./BrainChat";
import MapAsk from "./MapAsk";

type Engine = "BRAIN" | "MAP";

export default function AiPanel() {
  const [engine, setEngine] = useState<Engine>("BRAIN");

  return (
    <div className="panelCol">
      {/* A segmented control, not two buttons. What each engine can reach used to be
          spelled out in a paragraph under it, which put three lines of explanation
          between the title and the conversation every single time the panel opened —
          read once, then noise forever. Each engine says what it is in its own empty
          state instead, which is exactly when someone needs to be told and never after. */}
      <div className="seg" style={{ marginBottom: 14 }}>
        {(["BRAIN", "MAP"] as const).map((e) => (
          <button key={e} className={engine === e ? "on" : undefined} onClick={() => setEngine(e)}>
            {e}
          </button>
        ))}
      </div>

      {engine === "BRAIN" ? <BrainChat /> : <MapAsk />}
    </div>
  );
}
