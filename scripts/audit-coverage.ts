// Read-only: everything the map reads out of COYOTE, and everything it doesn't.
//
// Answers three questions in one pass, because they are only useful together:
//   1. which § the parser actually opens, and what it takes from each
//   2. what it found there — node by node, field by field, item by item
//   3. whether the snapshot Supabase is serving still matches the COYOTE on disk
//
// Writes nothing, anywhere. COYOTE is Shawn's to write and the snapshot is sync-coyote's.
//
//   npx tsx --env-file=.env scripts/audit-coverage.ts          # readable
//   npx tsx --env-file=.env scripts/audit-coverage.ts --json    # machine-readable

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import { NODE_REGISTRY } from "../lib/coyote/nodeRegistry";
import type { EngineNode, FieldValue, ScreenNode, IntakeNode } from "../lib/types/canonicalNode";

/** The § the parser opens by name. Everything else in COYOTE is read by nothing. */
const SECTIONS_READ = [
  { id: "03", what: "Screen definitions table", extractor: "screens.ts" },
  { id: "35", what: "Engine contracts (TRIGGER / READS / WRITES / DOWNSTREAM / EMITS)", extractor: "engines.ts" },
  { id: "15", what: "Open build items, as bullets", extractor: "blockers.ts" },
  { id: "00a", what: "Active PLP Queue — the Q-ID registers", extractor: "openQuestions.ts" },
  { id: "39\\.7", what: "A second open-questions register", extractor: "openQuestions.ts" },
  { id: "39", what: "INT BOOKING — heading presence only", extractor: "intake.ts" },
  { id: "40", what: "INT GATE — heading presence only", extractor: "intake.ts" },
];

function state(f: FieldValue | undefined): string {
  return f?.state ?? "absent";
}

async function main() {
  const json = process.argv.includes("--json");

  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const text = await readFile(resolved.source.filePath, "utf8");
  const lines = text.split(/\r?\n/);

  // Every § heading COYOTE carries, by the same rule the parser itself uses.
  const headings: { level: number; title: string; index: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*§.*)$/.exec(lines[i].trim());
    if (m) headings.push({ level: m[1].length, title: m[2].trim(), index: i });
  }
  const topLevel = headings.filter((h) => h.level <= 2);

  const parsed = parseCanonicalNodes(resolved.source);

  const sections = SECTIONS_READ.map((s) => {
    const re = new RegExp(`§${s.id}\\b`);
    const idx = headings.findIndex((h) => re.test(h.title));
    let lineCount = 0;
    if (idx !== -1) {
      const start = headings[idx];
      const next = headings.slice(idx + 1).find((h) => h.level <= start.level);
      lineCount = (next ? next.index : lines.length) - start.index;
    }
    return { section: `§${s.id.replace("\\", "")}`, what: s.what, extractor: s.extractor, found: idx !== -1, lines: lineCount };
  });

  const screens = parsed.nodes.filter((n): n is ScreenNode => n.kind === "screen");
  const engines = parsed.nodes.filter((n): n is EngineNode => n.kind === "engine");
  const intake = parsed.nodes.filter((n): n is IntakeNode => n.kind === "intake");

  const engineFields = engines.map((e) => ({
    node: e.label,
    trigger: state(e.trigger),
    reads: state(e.reads),
    writes: state(e.writes),
    downstream: state(e.downstream),
    emits: state(e.emits),
    blockers: e.blockers.length,
    questions: e.openQuestions.length,
  }));

  const fieldTally: Record<string, number> = {};
  for (const row of engineFields) {
    for (const k of ["trigger", "reads", "writes", "downstream", "emits"] as const) {
      fieldTally[row[k]] = (fieldTally[row[k]] ?? 0) + 1;
    }
  }

  const diagnostics = parsed.diagnostics.reduce<Record<string, number>>((a, d) => {
    const key = d.message.startsWith("Unattributed")
      ? `unattributed item (${d.severity})`
      : `${d.severity}: ${d.message.slice(0, 60)}`;
    a[key] = (a[key] ?? 0) + 1;
    return a;
  }, {});

  // Is the map serving this COYOTE, or an older one?
  let published: Record<string, unknown> = { status: "not checked" };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    const { data, error } = await createClient(url, key)
      .from("canonical_sync_state")
      .select("source_filename, register_entry_count, sync_status, synced_at")
      .eq("id", true)
      .single();
    published = error
      ? { status: `unreadable: ${error.message}` }
      : { ...data, matchesDisk: data.source_filename === resolved.source.fileName };
  }

  const report = {
    source: {
      fileName: resolved.source.fileName,
      sizeKb: Math.round(resolved.source.sizeBytes / 1024),
      modifiedAt: resolved.source.modifiedAt,
      totalLines: lines.length,
      sectionHeadings: headings.length,
      topLevelSections: topLevel.length,
    },
    published,
    sectionsRead: sections,
    coverage: {
      sectionsTheParserOpens: sections.filter((s) => s.found).length,
      topLevelSectionsInCoyote: topLevel.length,
      linesInsideReadSections: sections.reduce((a, s) => a + s.lines, 0),
    },
    nodes: {
      registryTotal: NODE_REGISTRY.length,
      registryImplemented: NODE_REGISTRY.filter((e) => e.implemented).length,
      parsed: parsed.nodes.length,
      screens: screens.length,
      engines: engines.length,
      intake: intake.length,
      onTheMap: engines.length + intake.length + 2,
      note: "Screens parse but are not drawn — Shawn's ruling, 2026-09-07. The two owner cards are added by the adapter, not by COYOTE.",
    },
    engineFields,
    fieldTally,
    items: {
      blockers: parsed.blockers.length,
      blockersAttached: parsed.blockers.filter((b) => b.placed).length,
      questions: parsed.openQuestions.length,
      questionsAttached: parsed.openQuestions.filter((q) => q.placed).length,
      totalOnCards: parsed.blockers.length + parsed.openQuestions.length,
    },
    connections: {
      total: parsed.connections.length,
      declared: parsed.connections.filter((c) => c.evidenceClass !== "inferred").length,
      inferred: parsed.connections.filter((c) => c.evidenceClass === "inferred").length,
    },
    diagnostics,
    notRead: topLevel
      .filter((h) => !SECTIONS_READ.some((s) => new RegExp(`§${s.id}\\b`).test(h.title)))
      .map((h) => h.title.slice(0, 70)),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`SOURCE      ${report.source.fileName}  ${report.source.sizeKb} KB  ${report.source.totalLines} lines`);
  console.log(`PUBLISHED   ${JSON.stringify(report.published)}`);
  console.log(`\nSECTIONS THE PARSER OPENS`);
  for (const s of report.sectionsRead) {
    console.log(`  ${s.found ? "ok  " : "MISS"} ${s.section.padEnd(7)} ${String(s.lines).padStart(5)} lines  ${s.extractor.padEnd(18)} ${s.what}`);
  }
  console.log(`\n  ${report.coverage.sectionsTheParserOpens} of COYOTE's ${report.coverage.topLevelSectionsInCoyote} top-level sections are opened at all.`);
  console.log(`\nENGINE FIELDS`);
  for (const e of report.engineFields) {
    console.log(`  ${e.node.padEnd(22)} trig=${e.trigger.padEnd(12)} reads=${e.reads.padEnd(12)} writes=${e.writes.padEnd(12)} down=${e.downstream.padEnd(12)} emits=${e.emits.padEnd(12)} blk=${e.blockers} q=${e.questions}`);
  }
  console.log(`\n  field states: ${JSON.stringify(report.fieldTally)}`);
  console.log(`\nITEMS       ${JSON.stringify(report.items)}`);
  console.log(`CONNECTIONS ${JSON.stringify(report.connections)}`);
  console.log(`NODES       ${JSON.stringify(report.nodes)}`);
  console.log(`\nDIAGNOSTICS`);
  for (const [k, n] of Object.entries(report.diagnostics).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\nTOP-LEVEL SECTIONS NOTHING READS (${report.notRead.length})`);
  for (const t of report.notRead) console.log(`  ${t}`);
}

main();
