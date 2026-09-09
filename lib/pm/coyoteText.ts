// The one artifact in this app that is written FOR COYOTE — as text, on a clipboard, for
// Shawn to paste and rule from. Nothing here writes canon, and nothing may: this module
// produces a string and has no database access at all.
//
// It still has to be exactly right, and the reason is direction. §35's four fields do not
// all run the same way (connections.ts's own header states this, and it is the rule this
// file mirrors):
//
//   DOWNSTREAM  written on the SOURCE's card    source → target
//   EMITS       written on the SOURCE's card    source → target
//   READS       written on the TARGET's card    source → target
//   TRIGGER     written on the TARGET's card    intake → engine
//
// So a proposal "E10 TAG → READS → E04 SIGNAL" is not a line for TAG's section at all —
// it belongs under SIGNAL, naming TAG. Write it under TAG and the parser reads the arrow
// back the other way on the next sync, and the one person who must never be handed a
// backwards edge is the one person who gets handed this text.

import type { ConnectionRelation, PmRuling } from "@/lib/types/pm";

/** Which end of the edge the §35 line is written on, per field. See this file's header. */
const WRITTEN_ON: Record<ConnectionRelation, "source" | "target"> = {
  downstream: "source",
  emits: "source",
  reads: "target",
  trigger: "target",
};

const FIELD_LABEL: Record<ConnectionRelation, string> = {
  downstream: "DOWNSTREAM",
  emits: "EMITS AT SESSION CLOSE",
  reads: "READS",
  trigger: "TRIGGER",
};

/** Card labels as the map shows them ("E10 — Tag"); §35 writes them plainly ("E10 TAG"). */
function canonName(label: string): string {
  return label.replace(/\s*[—–-]\s*/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

export interface ConnectionProposal {
  fromLabel: string;
  toLabel: string;
  relation: ConnectionRelation;
  rulingRef: string;
}

/**
 * The paste-ready §35 block for a connection proposal.
 *
 * Deliberately minimal: the section heading, the field, the value, and a provenance line.
 * It is not a draft of Shawn's ruling and must not read like one — he rules in his own
 * words. What this removes is only the mechanical part, getting the edge onto the right
 * engine's card in the right field pointing the right way.
 */
export function coyoteBlockForConnection(p: ConnectionProposal): string {
  const from = canonName(p.fromLabel);
  const to = canonName(p.toLabel);
  const on = WRITTEN_ON[p.relation] === "source" ? from : to;
  const names = WRITTEN_ON[p.relation] === "source" ? to : from;

  return [
    `§35 — ${on}`,
    `${FIELD_LABEL[p.relation]}: ${names}`,
    "",
    `# proposed from the map · ${p.rulingRef} · ${from} → ${FIELD_LABEL[p.relation]} → ${to}`,
  ].join("\n");
}

/**
 * The same for a node proposal, built from whichever intent fields were filled in. A card
 * with no intent yields the heading and the provenance line only — still useful, because
 * the thing it saves is finding where in §35 the new engine's subsection goes.
 */
export function coyoteBlockForNode(ruling: PmRuling): string {
  const name = canonName(ruling.label);
  const lines = [`§35 — ${name}`];

  const fields: [ConnectionRelation, string | null][] = [
    ["downstream", ruling.intent.downstream],
    ["reads", ruling.intent.reads],
    ["emits", ruling.intent.emits],
    ["trigger", ruling.intent.trigger],
  ];
  for (const [relation, value] of fields) {
    if (value && value.trim()) lines.push(`${FIELD_LABEL[relation]}: ${value.trim()}`);
  }

  lines.push("", `# proposed from the map · ${ruling.rulingRef}`);
  return lines.join("\n");
}

/** One line naming what a link ruling proposes, for the queue itself. */
export function connectionSummary(fromLabel: string, relation: ConnectionRelation, toLabel: string): string {
  return `${canonName(fromLabel)} → ${FIELD_LABEL[relation]} → ${canonName(toLabel)}`;
}

export { FIELD_LABEL, canonName };
