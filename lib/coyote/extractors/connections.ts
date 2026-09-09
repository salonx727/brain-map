// Extracts data-flow edges from already-parsed §35 EngineNode fields — never re-parses raw
// text of its own.
//
// This read four fields' worth of canon and used one. DOWNSTREAM alone yielded ten edges
// where §35 declares twenty-one, and the missing eleven were not obscure: E01 GHOST NOTES,
// which every session passes through, has no DOWNSTREAM label at all and parsed to zero
// outgoing edges. Its fan-out lives in the EMITS AT SESSION CLOSE table instead.
//
// Four sources now, and the direction is not the same for all of them:
//   DOWNSTREAM  this engine → the named engine
//   EMITS       this engine → each engine in the table's second column (§35.2 only)
//   READS       the named engine → this engine, because data moves toward the reader
//   TRIGGER     the named intake object → this engine
//
// The earlier refusal to read the last two was not caution for its own sake — TRIGGER
// carries a real false positive ("booking off a Cube share" in §35.8, a common noun, not
// INT BOOKING). matchesAsObject() is what makes them safe: canon capitalizes an object
// reference and lowercases the ordinary word, without exception in this document.

import type { CanonicalConnection, Diagnostic, EngineNode, EvidenceClass } from "@/lib/types/canonicalNode";
import { NODE_REGISTRY } from "@/lib/coyote/nodeRegistry";

// A DOWNSTREAM line names another engine (§35.0: "every engine writes data another engine
// reads") — never a screen or intake object. Restricting the match set to engines only
// means a stray alias inside a DOWNSTREAM value's parenthetical can't produce a false edge
// to a node kind this field was never describing.
const ENGINE_ALIASES = NODE_REGISTRY.filter((e) => e.kind === "engine" && e.implemented);

// TRIGGER is the one field that names an intake object rather than an engine ("Booking
// created" in §35.2). Kept as its own match set so an intake alias can never satisfy a
// DOWNSTREAM/EMITS/READS target, which canon writes only as engines.
const INTAKE_ALIASES = NODE_REGISTRY.filter((e) => e.kind === "intake" && e.implemented);

/**
 * The rule that makes TRIGGER safe to parse at all, and the reason this file previously
 * refused to.
 *
 * §35.8 E07 AFTERBURNER's TRIGGER reads "booking off a Cube share" — a lowercase common
 * noun, not the INT BOOKING object. §35.2 E01's reads "Booking created" — the object.
 * Canon capitalizes an object reference and lowercases the ordinary word, consistently,
 * so requiring the matched text to begin with a capital separates the two exactly. A
 * case-insensitive match creates a false edge here; a fully case-sensitive one misses
 * "Booking" because the registry alias is "BOOKING".
 */
function matchesAsObject(haystack: string, alias: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    if (/^[A-Z]/.test(m[0])) return true;
  }
  return false;
}

/**
 * §35.8's own text: "THE ONLY BACKWARD EDGE IN THE ARCHITECTURE" (LOCK-260809-051) —
 * `badge_awarded`, written by AFTERBURNER (E07), lands on GHOST NOTES' (E01) client
 * record. Hard-recognized rather than generically parsed from WRITES prose: WRITES
 * describes many things an engine persists to its own records, and this is the only case
 * canon itself asserts is an edge to another engine. Generalizing "scan WRITES for another
 * engine's name" would reintroduce the exact false-positive risk DOWNSTREAM-only parsing
 * exists to avoid.
 */
const BACKWARD_EDGE = {
  from: "engine:E07",
  to: "engine:E01",
  citation: '§35.8 E07 AFTERBURNER — WRITES "badge_awarded → GHOST NOTES client record"; "THE ONLY BACKWARD EDGE IN THE ARCHITECTURE" (LOCK-260809-051)',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * DOWNSTREAM values are "·"-separated engine names, sometimes carrying a trailing
 * parenthetical annotation ("TAG (subscribes to ramp-copy)") that must never be matched as
 * part of the name itself.
 *
 * A confirmed, separate defect in extractEngines.ts's own field-boundary parser: when no
 * recognized terminator label (CONTROL TARGETS, RECEIVES, etc.) immediately follows
 * DOWNSTREAM in an engine's §35 subsection, the captured field value runs on into
 * unrelated trailing prose — full KPI tables, code blocks, cross-references to other
 * engines named in passing — all the way to the next engine's heading. Confirmed directly
 * against E03/E06/E09/E10's real captured values. Every clean, uncorrupted DOWNSTREAM
 * value in this document (E02, E05, E08) ends at the first blank line — the real
 * assertion is always confined to one line/paragraph — so truncating there recovers the
 * intended value without touching extractEngines.ts itself and risking its other three
 * fields, which don't show this failure mode today.
 */
function splitDownstreamTargets(value: string): string[] {
  const firstParagraph = value.split(/\n\s*\n/)[0];
  return splitSegments(firstParagraph);
}

/** "·"-separated names with any trailing parenthetical annotation removed. */
function splitSegments(value: string): string[] {
  return value
    .split("·")
    .map((s) => s.replace(/\([^)]*\)/g, "").trim())
    .filter(Boolean);
}

/**
 * §35.2's EMITS AT SESSION CLOSE is a two-column markdown table: payload on the left,
 * "·"-separated destination engines on the right. Only rows below the header separator
 * are read, so the column heading itself is never mistaken for a destination.
 */
function splitEmitsTargets(value: string): string[] {
  const rows = value.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  const separator = rows.findIndex((r) => /^\|[\s:|-]+\|?$/.test(r));
  const body = separator === -1 ? rows : rows.slice(separator + 1);

  const out: string[] = [];
  for (const row of body) {
    const cells = row.split("|");
    // cells[0] is the empty string before the leading pipe; the destination is cells[2].
    if (cells.length < 3) continue;
    out.push(...splitSegments(cells[2]));
  }
  return out;
}

export function extractConnections(engineNodes: EngineNode[]): { connections: CanonicalConnection[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const connections: CanonicalConnection[] = [];
  // `${from}->${to}` — collapses a multi-field repeat into one edge, matching
  // canonical_connections' real (snapshot_id, from_node_key, to_node_key) primary key,
  // which carries no field discriminator.
  const seen = new Set<string>();
  const byNodeKey = new Map(engineNodes.map((n) => [n.nodeKey, n]));

  /**
   * `evidence` records which of the two ways above produced this edge, and the distinction
   * is not cosmetic. DOWNSTREAM/EMITS/TRIGGER are `declared`: the source engine's own
   * contract names the target. READS is `inferred`: the source names nothing and the edge
   * is read backwards out of the TARGET's contract. Three of the twenty-two edges in the
   * 2026-09-09 snapshot are inferred, and until 0010 the map drew them exactly like the
   * declared ones — an inference presented as a declaration, which is the same
   * unfalsifiable-claim problem §43.1 raises and the reason `backward` was split out.
   *
   * First writer wins on a duplicate, so the declared fields are read in a full pass of
   * their own before READS is read at all. Interleaving them per-engine would let E01's
   * READS reach E05 before E05's own DOWNSTREAM was ever looked at, and the edge would be
   * recorded as inferred when canon declares it outright.
   */
  function addEdge(from: string, to: string, citation: string, backward: boolean, evidence: EvidenceClass): void {
    if (from === to) return; // never a self-edge
    const key = `${from}->${to}`;
    if (seen.has(key)) return; // first writer wins — the backward edge is added before the loop below, so it can never be silently overwritten by a plain duplicate
    seen.add(key);
    connections.push({ fromNodeKey: from, toNodeKey: to, type: "data_flow", directed: true, backward, evidenceClass: evidence, declaringCitation: citation });
  }

  // Declared, not inferred: §35.8 asserts this edge in AFTERBURNER's own section, in its
  // own WRITES field. It is unusual in direction, not in evidence.
  if (byNodeKey.has(BACKWARD_EDGE.from) && byNodeKey.has(BACKWARD_EDGE.to)) {
    addEdge(BACKWARD_EDGE.from, BACKWARD_EDGE.to, BACKWARD_EDGE.citation, true, "declared");
  }

  /**
   * Resolves one "·"-separated segment to exactly one engine, or explains in a diagnostic
   * why it produced no edge. Silence is never an option here: a target canon names that
   * this parser cannot place is the single most important thing for a human to see.
   */
  function resolveEngineTarget(field: string, engine: EngineNode, target: string): string | null {
    const matches = ENGINE_ALIASES.filter((e) => e.aliases.some((alias) => matchesAsObject(target, alias)));
    if (matches.length === 0) {
      diagnostics.push({
        severity: "warning",
        nodeKey: engine.nodeKey,
        message: `${field} target "${target}" on ${engine.nodeKey} does not resolve to any known engine — no edge created.`,
      });
      return null;
    }
    if (matches.length > 1) {
      diagnostics.push({
        severity: "warning",
        nodeKey: engine.nodeKey,
        message: `${field} target "${target}" on ${engine.nodeKey} matches more than one engine (${matches.map((m) => m.nodeKey).join(", ")}) — ambiguous, no edge created.`,
      });
      return null;
    }
    return matches[0].nodeKey;
  }

  // Pass one — everything canon declares in the source's own section.
  for (const engine of engineNodes) {
    // DOWNSTREAM: this engine writes, the named engine reads. Edge runs outward.
    if (engine.downstream.state === "present") {
      const declared = engine.downstream.value.split(/\n\s*\n/)[0];
      for (const target of splitDownstreamTargets(engine.downstream.value)) {
        const to = resolveEngineTarget("DOWNSTREAM", engine, target);
        if (to) addEdge(engine.nodeKey, to, `§35 ${engine.label} — DOWNSTREAM: "${declared}"`, false, "declared");
      }
    }

    // EMITS AT SESSION CLOSE: same outward direction as DOWNSTREAM, different shape —
    // a table rather than a line. §35.2 is the only section carrying one, and it holds
    // E01's entire fan-out, which has no DOWNSTREAM label to live in.
    if (engine.emits.state === "present") {
      for (const target of splitEmitsTargets(engine.emits.value)) {
        const to = resolveEngineTarget("EMITS", engine, target);
        if (to) addEdge(engine.nodeKey, to, `§35 ${engine.label} — EMITS AT SESSION CLOSE → ${target}`, false, "declared");
      }
    }

    // TRIGGER names an intake object, never an engine — the one place INT BOOKING and
    // INT GATE can originate an edge. Guarded by matchesAsObject: see its comment for the
    // real lowercase "booking" that made this field unparseable before.
    //
    // Declared, even though the target's section is where it is written: an intake object
    // has no §35 subsection of its own to declare anything from, so the engine's TRIGGER
    // line is canon's only and intended place to assert it.
    if (engine.trigger.state === "present") {
      const declared = engine.trigger.value.split(/\n\s*\n/)[0];
      for (const segment of splitSegments(declared)) {
        const matches = INTAKE_ALIASES.filter((e) => e.aliases.some((alias) => matchesAsObject(segment, alias)));
        if (matches.length === 1) {
          addEdge(matches[0].nodeKey, engine.nodeKey, `§35 ${engine.label} — TRIGGER: "${segment}"`, false, "declared");
        }
      }
    }
  }

  // Pass two — edges no engine declares, recovered from the reader's own contract. Runs
  // after every declared edge is already recorded so first-writer-wins can never label a
  // declaration as an inference.
  for (const engine of engineNodes) {
    // READS runs the other way. "E07 AFTERBURNER READS TAG attribution chain" means data
    // moves TAG → AFTERBURNER, so the edge is inbound. Reading this field in the same
    // direction as DOWNSTREAM would draw every one of these arrows backwards.
    if (engine.reads.state === "present") {
      const declared = engine.reads.value.split(/\n\s*\n/)[0];
      for (const target of splitSegments(declared)) {
        const matches = ENGINE_ALIASES.filter((e) => e.aliases.some((alias) => matchesAsObject(target, alias)));
        // Unresolved segments are the normal case here — READS is mostly column and
        // record names ("`session_date`", "client record") — so no diagnostic is raised
        // for a miss, unlike DOWNSTREAM where every segment is meant to be an engine.
        if (matches.length === 1 && matches[0].nodeKey !== engine.nodeKey) {
          addEdge(matches[0].nodeKey, engine.nodeKey, `§35 ${engine.label} — READS: "${target}"`, false, "inferred");
        }
      }
    }
  }

  return { connections, diagnostics };
}
