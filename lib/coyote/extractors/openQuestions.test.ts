// §00a is a running log of many small tables, not one register, and they do not agree on
// how to spell their own columns. A table whose columns don't resolve is skipped in
// silence — so every spelling this file has actually met in a COYOTE gets a case here,
// because the failure mode is questions quietly missing from the map rather than an error.

import { describe, expect, it } from "vitest";
import { extractOpenQuestions } from "@/lib/coyote/extractors/openQuestions";

function table(header: string, ...rows: string[]): string[] {
  const width = header.split("|").length - 2;
  return [header, `|${Array(width).fill("---").join("|")}|`, ...rows];
}

describe("extractOpenQuestions", () => {
  it("reads the plain |ID|Status|Item| shape", () => {
    const items = extractOpenQuestions(
      table("|ID|Status|Item|", "|Q-LADDER|OPEN|LADDER regen with additions|"),
    ).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qId: "Q-LADDER", status: "OPEN", text: "LADDER regen with additions" });
  });

  it("reads a table that heads its id column Q-ID", () => {
    // §39.7's shape. Before ID_COLUMN_NAMES this resolved to no id column at all, and the
    // whole table — every row in it — was skipped without a diagnostic.
    const items = extractOpenQuestions(table("|Q-ID|Question|", "|Q-CD-1|Claude Design eval scope|")).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qId: "Q-CD-1", text: "Claude Design eval scope" });
  });

  it("does not mistake another column ending in -id for the id column", () => {
    const items = extractOpenQuestions(table("|Node-ID|Item|", "|E03|something|")).items;
    expect(items).toEqual([]);
  });

  it("follows each table's own column order rather than assuming one", () => {
    const items = extractOpenQuestions(table("|ID|Question|Status|", "|Q-CLAIM|V1 Claim Mechanic|OPEN|")).items;
    expect(items[0]).toMatchObject({ qId: "Q-CLAIM", text: "V1 Claim Mechanic", status: "OPEN" });
  });

  it("keeps closed rows, because the card marks them done rather than hiding them", () => {
    const items = extractOpenQuestions(table("|ID|Status|Item|", "|Q-OLD|RESOLVED|settled last month|")).items;
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("RESOLVED");
  });

  it("reads a run of register rows that never declared a header", () => {
    // §00a's real shape at line 6566: 53 rows that simply start, having inherited the
    // table above them across an edit. Requiring a header dropped every one of them.
    const items = extractOpenQuestions([
      "|Q-CD-1|OPEN|Claude Design eval scope|",
      "|Q-CD-2|OPEN|Claude Design operator|",
      "|Q-LADDER|DEFERRED|LADDER regen with additions|",
    ]).items;
    expect(items.map((q) => q.qId)).toEqual(["Q-CD-1", "Q-CD-2", "Q-LADDER"]);
    expect(items[2].status).toBe("DEFERRED");
  });

  it("keeps the odd label-keyed rows that close such a run", () => {
    // §00a's run ends on two rows keyed by a label rather than an id. They are rows of
    // the same table and they carry work, so the majority rule keeps them — the ratio
    // here mirrors the real one (51 ids, 2 labels).
    const rows = [
      ...Array.from({ length: 8 }, (_, k) => `|Q-CD-${k + 1}|OPEN|Claude Design item ${k + 1}|`),
      "|WATCH/NEEDS-SOURCE|HELD|watch list|",
      "|TRILOGY + LADDER|DEFERRED|regen with additions|",
    ];
    const items = extractOpenQuestions(rows).items;
    expect(items).toHaveLength(10);
    expect(items.at(-1)).toMatchObject({ status: "DEFERRED", text: "regen with additions" });
  });

  it("declines a run where register ids are the exception rather than the rule", () => {
    const rows = [
      "|Q-CD-1|OPEN|the only id in here|",
      ...Array.from({ length: 8 }, (_, k) => `|ROW-${k}|OPEN|not a register row|`),
    ];
    expect(extractOpenQuestions(rows).items).toEqual([]);
  });

  it("will not read a headerless run whose second column is prose, not a status", () => {
    // The guard against reading some unrelated table as though it were the register.
    const { items, diagnostics } = extractOpenQuestions([
      "|Q-A|A long sentence that is plainly the item itself and not a status at all|§12|",
      "|Q-B|Another long sentence that is plainly the item and not a status either|§13|",
      "|Q-C|A third long sentence standing in the column a status would occupy|§14|",
    ]);
    expect(items).toEqual([]);
    expect(diagnostics[0].severity).toBe("warning");
  });

  it("says so when it declines a table, rather than skipping it in silence", () => {
    const { diagnostics } = extractOpenQuestions(["|Whatever|Else|", "|not a register|row|"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("not read");
  });

  it("reports the section being missing rather than returning an empty set quietly", () => {
    const { items, diagnostics } = extractOpenQuestions(undefined);
    expect(items).toEqual([]);
    expect(diagnostics[0].severity).toBe("error");
  });
});
