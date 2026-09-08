"use client";

// Asking about the map, without leaving Vercel.
//
// This is the narrower of the hub's two engines and stays because it is the one that
// works when nothing is running on Shawn's machine. It reads the graph the map draws and
// can propose project-management writes onto it; it cannot see the vault, the workspace
// or a file's contents, because it runs in a serverless function that has none of them.
// BrainChat is the other engine and has all of that — at the cost of needing CommandOS up.
//
// The two buttons on a proposal are the design, not decoration. `askAiHubAction` returns
// proposals and writes nothing; `applyAiProposalAction` takes exactly one already-approved
// proposal and writes exactly one row. There is deliberately no "approve all" — a single
// control that applies a list is the autonomous-write path that shape exists to prevent.

import { useState } from "react";
import { applyAiProposalAction, askAiHubAction } from "@/app/actions/ai";
import type { AiProposal } from "@/lib/ai/types";

/** What a proposal actually does, in the words the map itself uses. */
function describe(p: AiProposal): string {
  switch (p.kind) {
    case "add_item":
      return `Add ${p.itemKind === "blocker" ? "a blocker" : "a to-do"} to ${p.nodeKey ?? "no card"} — "${p.title}"`;
    case "add_note":
      return `Add a ${p.noteKind} to ${p.nodeKey ?? "no card"} — "${p.body}"`;
    case "set_node_state":
      return `Set ${p.nodeKey} to ${p.state.replace(/_/g, " ")}`;
    case "route_file":
      return `File that upload onto ${p.nodeKey}`;
    case "create_link":
      return `Wire ${p.fromNodeKey} to ${p.toNodeKey}`;
  }
}

type Verdict = "applying" | "applied" | { error: string };

/**
 * The hub's errors are written to be read by a person — "no API key", "the map could not
 * be read" — but they arrive carrying the function name that threw them. Worth stripping:
 * the sentence after it is the whole message, and "askAiHub:" in front of it only makes a
 * clear explanation look like a crash.
 */
function readable(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const stripped = raw.replace(/^(askAiHub|Error):\s*/, "");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export default function MapAsk() {
  const [question, setQuestion] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});

  const ready = question.trim() !== "" && !asking;

  async function ask() {
    if (!ready) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    setProposals([]);
    setVerdicts({});
    try {
      const reply = await askAiHubAction({
        provider: "claude",
        // Empty is legitimate: the server falls back to ANTHROPIC_API_KEY, which is what
        // makes the deployed map usable without typing a credential into a phone.
        apiKey: apiKey.trim(),
        items: [{ kind: "text", text: question.trim() }],
      });
      setAnswer(reply.answer);
      setProposals(reply.proposals);
    } catch (e) {
      setError(readable(e));
    } finally {
      setAsking(false);
    }
  }

  async function approve(index: number) {
    setVerdicts((v) => ({ ...v, [index]: "applying" }));
    try {
      await applyAiProposalAction(proposals[index]);
      setVerdicts((v) => ({ ...v, [index]: "applied" }));
      // The client model is held in a ref and does not re-read on a server revalidate, so
      // a full reload is what actually shows the new row. Blunt, and honest: a write that
      // only updated React state would look identical to one that reached the database.
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setVerdicts((v) => ({ ...v, [index]: { error: readable(e) } }));
    }
  }

  return (
    <>
      <textarea
        className="f"
        style={{ width: "100%", minHeight: 76, resize: "vertical", fontFamily: "inherit" }}
        placeholder="Ask about the map — what's blocked, what's waiting on Shawn…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
        }}
      />

      <input
        className="f"
        style={{ width: "100%", marginTop: 8 }}
        type="password"
        placeholder="Your own API key — optional, not stored"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />

      <button className="act" style={{ width: "100%", marginTop: 10, padding: 14 }} disabled={!ready} onClick={ask}>
        {asking ? "READING THE MAP…" : "ASK"}
      </button>

      {error ? (
        <div className="none" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}

      {answer ? <div style={{ marginTop: 16, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{answer}</div> : null}

      {proposals.length ? (
        <div style={{ marginTop: 18 }}>
          <div className="eyebrow">{proposals.length} PROPOSED · NOTHING IS WRITTEN UNTIL YOU APPROVE</div>
          {proposals.map((p, i) => {
            const verdict = verdicts[i];
            return (
              <div className="item" key={i} style={{ display: "block", padding: "14px 0" }}>
                <div>{describe(p)}</div>
                <div className="sub" style={{ marginTop: 4 }}>
                  {p.reason}
                </div>
                {verdict === "applied" ? (
                  <div className="sub" style={{ marginTop: 8 }}>
                    APPLIED · RELOADING TO SHOW IT
                  </div>
                ) : typeof verdict === "object" ? (
                  <div className="sub" style={{ marginTop: 8 }}>
                    COULD NOT APPLY — {verdict.error}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      className="act armed"
                      style={{ flex: 1, padding: 11, fontSize: 10 }}
                      disabled={verdict === "applying"}
                      onClick={() => approve(i)}
                    >
                      {verdict === "applying" ? "WRITING…" : "APPROVE"}
                    </button>
                    <button
                      className="act"
                      style={{ flex: 1, padding: 11, fontSize: 10 }}
                      onClick={() => setProposals((list) => list.filter((_, k) => k !== i))}
                    >
                      DISCARD
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="foot" style={{ marginTop: 18 }}>
        READS THE MAP AND PROPOSES · NEVER WRITES UNAPPROVED · NO VAULT, NO FILES · WORKS
        WITH NOTHING RUNNING AT HOME
      </div>
    </>
  );
}
