import { describe, expect, it } from "vitest";
import { extractBlockers } from "./blockers";

describe("extractBlockers", () => {
  it("reads a plain bullet, which is all §15 carries today", () => {
    const { items } = extractBlockers(["- dropQueue uses Pool A connection — fix one line in drop_engine.js"]);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("dropQueue uses Pool A connection — fix one line in drop_engine.js");
    expect(items[0].qId).toBeUndefined();
  });

  it("lifts a BLK id off the bullet and leaves the text clean", () => {
    const { items } = extractBlockers(["- **BLK-001** · dropQueue uses Pool A connection"]);
    expect(items[0].qId).toBe("BLK-001");
    expect(items[0].text).toBe("dropQueue uses Pool A connection");
  });

  it("reads the same text either way, so amending canon does not move an item", () => {
    const before = extractBlockers(["- Ghost Notes S2 route: implement cache-first read"]).items[0];
    const after = extractBlockers(["- **BLK-011** · Ghost Notes S2 route: implement cache-first read"]).items[0];
    expect(after.text).toBe(before.text);
    expect(after.sourceSection).toBe(before.sourceSection);
    expect(after.qId).toBe("BLK-011");
  });

  it("accepts the separators canon might reasonably write", () => {
    for (const line of ["- **BLK-007** · a", "- **BLK-007**: a", "- **BLK-007** — a", "- **BLK-007** a"]) {
      expect(extractBlockers([line]).items[0]).toMatchObject({ qId: "BLK-007", text: "a" });
    }
  });

  it("does not mistake a LOCK reference or bold lead-in for an id", () => {
    const { items } = extractBlockers([
      "- **SKINZ_DEPLOY_ENABLED** env flag — set false pre-launch (LOCK-260604-019)",
    ]);
    expect(items[0].qId).toBeUndefined();
    expect(items[0].text).toContain("SKINZ_DEPLOY_ENABLED");
  });

  it("carries the subheading each bullet sits under", () => {
    const { items } = extractBlockers([
      "### Launch Blockers — Must resolve before any user onboards",
      "- **BLK-001** · first",
      "### V2 Open Items",
      "- **BLK-030** · second",
    ]);
    expect(items[0].sourceSection).toBe("§15 › Launch Blockers — Must resolve before any user onboards");
    expect(items[1].sourceSection).toBe("§15 › V2 Open Items");
  });

  it("still attributes to an engine when the text names exactly one", () => {
    const { items } = extractBlockers(["- **BLK-013** · skinz_cron.js: batched deployment — SKINZ rollback"]);
    expect(items[0].confidence).toBe("matched");
    expect(items[0].qId).toBe("BLK-013");
  });

  it("reports §15 being missing rather than returning silently empty", () => {
    const { items, diagnostics } = extractBlockers(undefined);
    expect(items).toHaveLength(0);
    expect(diagnostics[0].severity).toBe("error");
  });
});
