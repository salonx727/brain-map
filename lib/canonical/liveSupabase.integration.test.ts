// Live-project integration test. Skipped entirely unless SUPABASE_URL,
// SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are all set — so `npm test` stays
// green with no live database, exactly like every other test file in this repo. Run
// deliberately, with real credentials exported, to verify the actual pipeline against
// the actual provisioned project — this is the one file in the suite that ships real
// writes to a real Supabase instance, on purpose.

import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resolveCoyoteSource } from "@/lib/coyote/resolver";
import { parseCanonicalNodes } from "@/lib/coyote/parser";
import { publishSnapshot } from "@/lib/canonical/publisher";
import { fetchCanonicalGraphFromSupabase } from "@/lib/canonical/supabaseReader";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCreds = Boolean(supabaseUrl && anonKey && serviceKey);

// Register-entry count is a known fact restated by both Gaelan and Salman this
// session (379, X_09-03_1200_Coyote.md) — not derived here. A real sync job should
// parse this from COYOTE's own banner rather than hardcode it; noted as a follow-up,
// not solved by this verification pass.
const REGISTER_ENTRY_COUNT = 379;

describe.skipIf(!hasCreds)("live Supabase canonical pipeline", () => {
  // describe's factory body runs at collection time even when skipIf skips the tests
  // inside it — so these must not throw when creds are absent. Placeholders are never
  // actually used: every it() below is skipped whenever hasCreds is false.
  const serviceClient = createClient(supabaseUrl ?? "https://placeholder.supabase.co", serviceKey ?? "placeholder");
  const anonClient = createClient(supabaseUrl ?? "https://placeholder.supabase.co", anonKey ?? "placeholder");

  it("publishes the real, current COYOTE and the anon read path sees it", async () => {
    const resolved = await resolveCoyoteSource();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const parsed = parseCanonicalNodes(resolved.source);

    const result = await publishSnapshot(serviceClient, resolved.source.text, resolved.source.fileName, REGISTER_ENTRY_COUNT, parsed);
    expect(["published", "no_op"]).toContain(result.kind);

    const graph = await fetchCanonicalGraphFromSupabase(anonClient);
    expect(graph.sourceError).toBeUndefined();
    expect(graph.nodes.length).toBe(parsed.nodes.length);
    expect(graph.nodes.find((n) => n.nodeKey === "intake:GATE")?.kind).toBe("intake");
    expect(graph.nodes.find((n) => n.nodeKey === "intake:BOOKING")?.kind).toBe("intake");
    expect(graph.nodes.filter((n) => n.kind === "engine")).toHaveLength(11);
  }, 20_000);

  it("is a no-op on the exact same source text — the duplicate-delivery case", async () => {
    const resolved = await resolveCoyoteSource();
    if (!resolved.ok) throw new Error("resolve failed");
    const parsed = parseCanonicalNodes(resolved.source);

    const before = await serviceClient.from("canonical_sync_state").select("active_snapshot_id").eq("id", true).limit(1);
    const result = await publishSnapshot(serviceClient, resolved.source.text, resolved.source.fileName, REGISTER_ENTRY_COUNT, parsed);
    expect(result.kind).toBe("no_op");
    const after = await serviceClient.from("canonical_sync_state").select("active_snapshot_id").eq("id", true).limit(1);
    expect(after.data?.[0]?.active_snapshot_id).toBe(before.data?.[0]?.active_snapshot_id);
  }, 20_000);

  it("rejects an invalid candidate and leaves the active snapshot untouched", async () => {
    const before = await serviceClient
      .from("canonical_sync_state")
      .select("source_hash, active_snapshot_id, sync_status, last_error")
      .eq("id", true)
      .limit(1);

    const invalidNodes = [
      {
        nodeKey: "not-a-valid-key",
        kind: "intake",
        label: "deliberately malformed for this test",
        canonRefs: [],
        sourceMeta: { fileName: "fixture", resolvedAt: new Date(0).toISOString() },
        definition: { state: "present", value: "x" },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;

    const result = await publishSnapshot(serviceClient, "deliberately-invalid-candidate-fixture-text", "invalid-fixture.md", 1, {
      nodes: invalidNodes,
      connections: [],
      diagnostics: [],
      blockers: [],
      openQuestions: [],
    });
    expect(result.kind).toBe("rejected");

    const after = await serviceClient
      .from("canonical_sync_state")
      .select("source_hash, active_snapshot_id, sync_status")
      .eq("id", true)
      .limit(1);
    expect(after.data?.[0]?.active_snapshot_id).toBe(before.data?.[0]?.active_snapshot_id);
    expect(after.data?.[0]?.source_hash).toBe(before.data?.[0]?.source_hash);
    expect(after.data?.[0]?.sync_status).toBe("failed");

    // Put the row back the way it was found. There is one of these rows and it is the
    // live one — `sync_status` is what anybody asking "is the map under the current
    // COYOTE?" reads, and this test left it saying `failed` long after a perfectly good
    // publish. It stayed that way for a day before an audit caught it (2026-09-13),
    // because nothing else clears it: the no-op path does, but a successful publish that
    // precedes a test run cannot un-fail itself afterwards.
    await serviceClient
      .from("canonical_sync_state")
      .update({ sync_status: before.data?.[0]?.sync_status ?? "ok", last_error: before.data?.[0]?.last_error ?? null })
      .eq("id", true);
  }, 20_000);

  it("RLS: the anon key can read canonical_nodes", async () => {
    const { error } = await anonClient.from("canonical_nodes").select("node_key").limit(1);
    expect(error).toBeNull();
  });

  it("RLS: the anon key cannot write to canonical_nodes directly", async () => {
    const { error } = await anonClient
      .from("canonical_nodes")
      .insert({ snapshot_id: "00000000-0000-0000-0000-000000000000", node_key: "x", kind: "intake", label: "x" });
    expect(error).not.toBeNull();
  });

  it("RLS/GRANT boundary: the anon key cannot call publish_canonical_snapshot", async () => {
    // A SECURITY DEFINER function bypasses RLS on the tables it touches (it runs as
    // its owner, which has BYPASSRLS on a hosted project) — so the real gate here is
    // the EXECUTE grant, not the table policies. Confirms the explicit
    // revoke/grant added to 0001_canonical_layer.sql actually took effect live.
    const { error } = await anonClient.rpc("publish_canonical_snapshot", {
      p_source_hash: "x",
      p_source_filename: "x",
      p_register_entry_count: 1,
      p_nodes: [],
      p_connections: [],
      p_diagnostics: [],
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/permission denied/i);
  });
});
