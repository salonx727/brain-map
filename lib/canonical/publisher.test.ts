// Tests the pure decision logic only (computeSourceHash, decideSyncAction) — no live
// Supabase project exists yet, so publishSnapshot()'s actual RPC call is not exercised
// here. See the implementation report's remaining-blockers section.

import { describe, expect, it } from "vitest";
import { computeSourceHash, decideSyncAction } from "@/lib/canonical/publisher";

describe("computeSourceHash", () => {
  it("is deterministic for the same text", () => {
    expect(computeSourceHash("hello")).toBe(computeSourceHash("hello"));
  });

  it("matches a known SHA-256 test vector", () => {
    // sha256("hello") — verifiable independently, not asserting against itself.
    expect(computeSourceHash("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("differs for different text, including a single-character change", () => {
    expect(computeSourceHash("hello")).not.toBe(computeSourceHash("hellp"));
  });
});

describe("decideSyncAction — forced republish", () => {
  it("publishes an identical hash when forced, so an extractor change can reach production", () => {
    const action = decideSyncAction("same", "same", { ok: true }, true);
    expect(action.kind).toBe("publish");
  });

  it("still rejects an invalid graph when forced — force skips the no-op check, never validation", () => {
    const action = decideSyncAction("same", "same", { ok: false, reason: "bad", details: ["d"] }, true);
    expect(action.kind).toBe("reject");
  });

  it("no-ops on an identical hash when not forced", () => {
    const action = decideSyncAction("same", "same", { ok: true });
    expect(action.kind).toBe("no_op");
  });
});

describe("decideSyncAction", () => {
  it("rejects regardless of hash when validation failed", () => {
    const action = decideSyncAction("abc", null, { ok: false, reason: "bad graph", details: ["x"] });
    expect(action.kind).toBe("reject");
  });

  it("publishes when nothing has ever been published (currentHash is null)", () => {
    const action = decideSyncAction("abc", null, { ok: true });
    expect(action.kind).toBe("publish");
  });

  it("is a no-op — not an error, not a republish — when the candidate hash matches what's already active", () => {
    const action = decideSyncAction("abc", "abc", { ok: true });
    expect(action.kind).toBe("no_op");
  });

  it("publishes when the candidate hash differs from what's active", () => {
    const action = decideSyncAction("abc", "def", { ok: true });
    expect(action.kind).toBe("publish");
  });

  it("is idempotent under the exact duplicate-upload failure mode observed this week: same file submitted twice yields no_op the second time, never a second snapshot", () => {
    const first = decideSyncAction("same-hash", null, { ok: true });
    expect(first.kind).toBe("publish");
    // Simulate the state after the first publish succeeded and updated source_hash.
    const second = decideSyncAction("same-hash", "same-hash", { ok: true });
    expect(second.kind).toBe("no_op");
  });
});
