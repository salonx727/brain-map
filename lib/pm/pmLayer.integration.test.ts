// Live-project integration test for the PM layer — same shape as
// src/lib/canonical/liveSupabase.integration.test.ts: skipped entirely unless
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are all set, so `npm
// test` stays green with no live database. Run deliberately with real credentials
// exported to verify the actual PM tables, the RLS write boundary, and the
// pm_node_links trigger against the actual provisioned project.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import * as pmWriter from "@/lib/pm/pmWriter";
import { getMasterTodoView, getPmLayerForNodeKeys, getUnsortedFiles, listPeople } from "@/lib/pm/pmReader";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCreds = Boolean(supabaseUrl && anonKey && serviceKey);

describe.skipIf(!hasCreds)("live PM layer", () => {
  const serviceClient = createClient(supabaseUrl ?? "https://placeholder.supabase.co", serviceKey ?? "placeholder");
  const anonClient = createClient(supabaseUrl ?? "https://placeholder.supabase.co", anonKey ?? "placeholder");

  // A real canonical node key that exists in this project's live snapshot (published
  // earlier this session) — used to prove PM records reference canonical identity
  // correctly, without this test depending on canonical publish timing.
  const CANONICAL_NODE_KEY = "engine:E01";
  const TEST_MARKER = `pm-layer-live-test-${Date.now()}`;

  /* This suite writes to the real project, and for twelve runs it never cleaned up after
     itself: 268 rows accumulated, including to-dos and notes hanging off engine:E01 that
     showed on the deployed map as if a person had written them. Everything below undoes
     exactly what these tests create and nothing else.

     Two of the writes land on engine:E01 itself — a real canonical node whose rows carry
     no marker to recognise them by. Those are snapshotted before the suite and restored
     after, rather than deleted, so a position or state a person set is never destroyed by
     running the tests. */
  let priorPosition: Record<string, unknown> | null = null;
  let priorState: Record<string, unknown> | null = null;

  beforeAll(async () => {
    const { data: pos } = await serviceClient.from("pm_layout_positions").select("*").eq("node_key", CANONICAL_NODE_KEY).maybeSingle();
    priorPosition = pos ?? null;
    const { data: st } = await serviceClient.from("pm_node_state").select("*").eq("node_key", CANONICAL_NODE_KEY).maybeSingle();
    priorState = st ?? null;
  });

  afterAll(async () => {
    // PM nodes first: node_key is deliberately not a foreign key anywhere (it also holds
    // canonical keys, which live in another table), so nothing cascades and every
    // dependent table has to be cleared by hand or it survives as an invisible orphan.
    const { data: doomed } = await serviceClient.from("pm_nodes").select("node_key").like("label", `${TEST_MARKER}%`);
    const keys = (doomed ?? []).map((n) => n.node_key as string);
    if (keys.length > 0) {
      for (const table of ["pm_items", "pm_notes", "pm_references", "pm_files", "pm_layout_positions", "pm_node_state"]) {
        await serviceClient.from(table).delete().in("node_key", keys);
      }
      await serviceClient.from("pm_node_links").delete().or(`from_node_key.in.(${keys.join(",")}),to_node_key.in.(${keys.join(",")})`);
      // Since 0009 every createPmNode opens a ruling, and since 0010 a wire can open one
      // too. This cleanup deletes pm_nodes directly rather than going through
      // deletePmNode, so the withdrawal that lives there has to be repeated here — and it
      // is not a tidiness point: a ruling left behind is a row in the one queue Shawn
      // works through by hand, for a card that no longer exists. Fifteen of them
      // accumulated across three runs before this was caught.
      await serviceClient.from("pm_rulings").delete().in("node_key", keys);
      await serviceClient.from("pm_rulings").delete().or(`from_node_key.in.(${keys.join(",")}),to_node_key.in.(${keys.join(",")})`);
      await serviceClient.from("pm_nodes").delete().in("node_key", keys);
    }

    // Then everything scoped to engine:E01, found by the marker each test stamps on it.
    await serviceClient.from("pm_items").delete().like("title", `${TEST_MARKER}%`);
    await serviceClient.from("pm_notes").delete().like("body", `${TEST_MARKER}%`);
    await serviceClient.from("pm_references").delete().like("label", `${TEST_MARKER}%`);
    await serviceClient.from("pm_files").delete().like("file_name", `${TEST_MARKER}%`);
    // People last — created_by/updated_by on the tables above reference it.
    await serviceClient.from("pm_people").delete().like("name", `${TEST_MARKER}%`);

    // Finally put engine:E01 back exactly as it was found. Absence is meaningful here:
    // no pm_node_state row means UNTOUCHED, so if there was no row before, leave none.
    if (priorState) await serviceClient.from("pm_node_state").upsert(priorState);
    else await serviceClient.from("pm_node_state").delete().eq("node_key", CANONICAL_NODE_KEY);

    if (priorPosition) await serviceClient.from("pm_layout_positions").upsert(priorPosition);
    else await serviceClient.from("pm_layout_positions").delete().eq("node_key", CANONICAL_NODE_KEY);
  }, 60_000);

  it("creates a person, then a todo and a blocker scoped to a canonical node, then reads them back via the anon key", async () => {
    const person = await pmWriter.createPerson(serviceClient, TEST_MARKER);
    expect(person.name).toBe(TEST_MARKER);

    const todo = await pmWriter.createItem(serviceClient, { kind: "todo", title: `${TEST_MARKER}-todo`, nodeKey: CANONICAL_NODE_KEY, createdBy: person.id });
    const blocker = await pmWriter.createItem(serviceClient, { kind: "blocker", title: `${TEST_MARKER}-blocker`, nodeKey: CANONICAL_NODE_KEY, createdBy: person.id });
    expect(todo.status).toBe("inbox");

    const updated = await pmWriter.updateItemStatus(serviceClient, todo.id, "next_action", person.id);
    expect(updated.status).toBe("next_action");

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.items.some((i) => i.id === todo.id && i.status === "next_action")).toBe(true);
    expect(layer.items.some((i) => i.id === blocker.id && i.kind === "blocker")).toBe(true);
  }, 20_000);

  it("creates a note and a decision, readable via anon", async () => {
    const note = await pmWriter.createNote(serviceClient, { kind: "note", body: `${TEST_MARKER}-note`, nodeKey: CANONICAL_NODE_KEY });
    const decision = await pmWriter.createNote(serviceClient, { kind: "decision", body: `${TEST_MARKER}-decision`, nodeKey: CANONICAL_NODE_KEY });

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.notes.some((n) => n.id === note.id)).toBe(true);
    expect(layer.notes.some((n) => n.id === decision.id && n.kind === "decision")).toBe(true);
  }, 20_000);

  it("adds a reference link scoped to a canonical node", async () => {
    const ref = await pmWriter.addReference(serviceClient, { nodeKey: CANONICAL_NODE_KEY, url: "https://figma.com/example", refType: "figma", label: TEST_MARKER });
    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.references.some((r) => r.id === ref.id)).toBe(true);
  }, 20_000);

  it("creates a PM sub-node under a canonical parent, and it shows up scoped to that parent", async () => {
    const subnode = await pmWriter.createPmNode(serviceClient, { label: `${TEST_MARKER}-subnode`, parentNodeKey: CANONICAL_NODE_KEY });
    expect(subnode.nodeKey.startsWith("pm:")).toBe(true);

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.nodes.some((n) => n.nodeKey === subnode.nodeKey && n.parentNodeKey === CANONICAL_NODE_KEY)).toBe(true);
  }, 20_000);

  it("regression: a PM node's displayRef is never its uuid-bearing node_key — the confirmed v5.2 display leak", async () => {
    const subnode = await pmWriter.createPmNode(serviceClient, { label: `${TEST_MARKER}-refcheck`, kind: "subnode", parentNodeKey: CANONICAL_NODE_KEY });
    expect(subnode.displayRef).toMatch(/^SUB-\d+$/);
    expect(subnode.displayRef).not.toContain(subnode.nodeKey.slice(3)); // slice(3) strips "pm:" — the raw uuid must not appear in the ref
    expect(subnode.nodeKey).not.toBe(subnode.displayRef);

    const fn = await pmWriter.createPmNode(serviceClient, { label: `${TEST_MARKER}-fncheck`, kind: "function", parentNodeKey: CANONICAL_NODE_KEY });
    expect(fn.displayRef).toMatch(/^FN-\d+$/);

    const renamed = await pmWriter.renamePmNode(serviceClient, subnode.nodeKey, `${TEST_MARKER}-renamed`);
    expect(renamed.displayRef).toBe(subnode.displayRef); // renaming never touches the assigned ref

    // Confirms the anon read path (what the deployed UI actually reads) round-trips
    // displayRef correctly — the same field the card/panel use instead of the uuid.
    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.nodes.find((n) => n.nodeKey === subnode.nodeKey)?.displayRef).toBe(subnode.displayRef);
    expect(layer.nodes.find((n) => n.nodeKey === fn.nodeKey)?.displayRef).toBe(fn.displayRef);
  }, 20_000);

  it("allows a PM-created node link where one endpoint is PM-created", async () => {
    const subnode = await pmWriter.createPmNode(serviceClient, { label: `${TEST_MARKER}-link-target` });
    const link = await pmWriter.createNodeLink(serviceClient, { fromNodeKey: CANONICAL_NODE_KEY, toNodeKey: subnode.nodeKey, citation: "manual test link" });
    expect(link.fromNodeKey).toBe(CANONICAL_NODE_KEY);
    expect(link.toNodeKey).toBe(subnode.nodeKey);
  }, 20_000);

  it("regression: a link to a standalone PM node (no canonical parent) still loads that node, so the wire has both endpoints to render", async () => {
    const standalone = await pmWriter.createPmNode(serviceClient, { label: `${TEST_MARKER}-standalone` });
    expect(standalone.parentNodeKey).toBeNull();

    const link = await pmWriter.createNodeLink(serviceClient, { fromNodeKey: CANONICAL_NODE_KEY, toNodeKey: standalone.nodeKey, citation: "standalone endpoint regression" });

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.links.some((l) => l.id === link.id)).toBe(true);

    const matches = layer.nodes.filter((n) => n.nodeKey === standalone.nodeKey);
    expect(matches).toHaveLength(1); // present, and not duplicated against nodesA/nodesB
    expect(matches[0].parentNodeKey).toBeNull(); // no parent invented for it
  }, 20_000);

  it("rejects a node link where BOTH endpoints are canonical — the trigger, not app code, enforces this", async () => {
    await expect(pmWriter.createNodeLink(serviceClient, { fromNodeKey: "engine:E01", toNodeKey: "engine:E02" })).rejects.toThrow(/canonical/i);
  }, 20_000);

  it("sets work-state on a canonical node_key, reads back via anon, independent of any layout", async () => {
    const state = await pmWriter.setNodeState(serviceClient, { nodeKey: CANONICAL_NODE_KEY, state: "IN_BUILD" });
    expect(state.state).toBe("IN_BUILD");

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.states.find((s) => s.nodeKey === CANONICAL_NODE_KEY)?.state).toBe("IN_BUILD");

    // Same node_key, no layout_id anywhere in the call — the point of the table.
    const updated = await pmWriter.setNodeState(serviceClient, { nodeKey: CANONICAL_NODE_KEY, state: "BLOCKED" });
    expect(updated.state).toBe("BLOCKED"); // upsert, not a second row
  }, 20_000);

  it("regression: deletePmNode refuses a canonical node_key — the absence of a pm_nodes row IS the guard", async () => {
    await expect(pmWriter.deletePmNode(serviceClient, "engine:E01")).rejects.toThrow(/not a PM-created node/i);
  }, 20_000);

  it("deletePmNode cascades items/notes/references/files/links/state/position/ruling, then the node itself", async () => {
    const node = await pmWriter.createPmNode(serviceClient, { label: `${TEST_MARKER}-delete-me` });
    await pmWriter.createItem(serviceClient, { kind: "todo", title: `${TEST_MARKER}-todo`, nodeKey: node.nodeKey });
    await pmWriter.createNote(serviceClient, { kind: "note", body: `${TEST_MARKER}-note`, nodeKey: node.nodeKey });
    await pmWriter.addReference(serviceClient, { nodeKey: node.nodeKey, url: "https://example.com" });
    const file = await pmWriter.uploadFile(serviceClient, { fileName: `${TEST_MARKER}-file.txt`, contentType: "text/plain", bytes: Buffer.from("x"), nodeKey: node.nodeKey });
    const link = await pmWriter.createNodeLink(serviceClient, { fromNodeKey: CANONICAL_NODE_KEY, toNodeKey: node.nodeKey });
    await pmWriter.setNodeState(serviceClient, { nodeKey: node.nodeKey, state: "DONE" });
    const layout = await pmWriter.getOrCreateDefaultLayout(serviceClient);
    await pmWriter.upsertLayoutPosition(serviceClient, { layoutId: layout.id, nodeKey: node.nodeKey, x: 12, y: 34 });

    await pmWriter.deletePmNode(serviceClient, node.nodeKey);

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.nodes.some((n) => n.nodeKey === node.nodeKey)).toBe(false);
    expect(layer.items.some((i) => i.nodeKey === node.nodeKey)).toBe(false);
    expect(layer.links.some((l) => l.id === link.id)).toBe(false);
    expect(layer.states.some((s) => s.nodeKey === node.nodeKey)).toBe(false);
    await expect(pmWriter.getSignedFileUrl(serviceClient, file.storagePath)).rejects.toThrow(/not found/i);

    // Position and ruling are asserted straight against the tables, not through the read
    // layer: neither is exposed per-node by getPmLayerForNodeKeys, so a leak in either
    // would have stayed invisible to this test — which is exactly what happened to the
    // position row until 2026-09-09, leaving one orphan behind for every card ever
    // deleted, including the only trace left when a real card went missing.
    const { data: positions } = await serviceClient.from("pm_layout_positions").select("node_key").eq("node_key", node.nodeKey);
    expect(positions ?? []).toHaveLength(0);
    const { data: rulings } = await serviceClient.from("pm_rulings").select("id").eq("node_key", node.nodeKey);
    expect(rulings ?? []).toHaveLength(0);
  }, 20_000);

  it("upserts a layout position with position + colour, no lock field exists to set", async () => {
    const layout = await pmWriter.getOrCreateDefaultLayout(serviceClient);
    const position = await pmWriter.upsertLayoutPosition(serviceClient, { layoutId: layout.id, nodeKey: CANONICAL_NODE_KEY, x: 123, y: 456, color: "#3987e5" });
    expect(position).not.toHaveProperty("locked");
    expect(position.x).toBe(123);
    expect(position.color).toBe("#3987e5");

    // Upsert again with a new position — same (layout_id, node_key), must update not duplicate.
    const moved = await pmWriter.upsertLayoutPosition(serviceClient, { layoutId: layout.id, nodeKey: CANONICAL_NODE_KEY, x: 789, y: 10 });
    expect(moved.x).toBe(789);
  }, 20_000);

  it("Master TODO view returns todos across nodes via a filtered query, not a separate table", async () => {
    const view = await getMasterTodoView(anonClient);
    expect(Array.isArray(view)).toBe(true);
    expect(view.every((i) => i.kind === "todo")).toBe(true);
  }, 20_000);

  it("uploads a file as UNSORTED (no node), lists it in the UNSORTED view, then assigns it to a node", async () => {
    const bytes = Buffer.from(`${TEST_MARKER}-file-contents`, "utf-8");
    const file = await pmWriter.uploadFile(serviceClient, { fileName: `${TEST_MARKER}.txt`, contentType: "text/plain", bytes, nodeKey: null });
    expect(file.nodeKey).toBeNull();

    const unsorted = await getUnsortedFiles(anonClient);
    expect(unsorted.some((f) => f.id === file.id)).toBe(true);

    const signedUrl = await pmWriter.getSignedFileUrl(serviceClient, file.storagePath);
    expect(signedUrl).toMatch(/^https?:\/\//);

    const assigned = await pmWriter.assignFileToNode(serviceClient, file.id, CANONICAL_NODE_KEY);
    expect(assigned.nodeKey).toBe(CANONICAL_NODE_KEY);

    const stillUnsorted = await getUnsortedFiles(anonClient);
    expect(stillUnsorted.some((f) => f.id === file.id)).toBe(false);
  }, 20_000);

  it("fills a UI slot with a real Storage-backed upload (never a session-only data URL), and the UI chip counts filled slots only", async () => {
    const bytes = Buffer.from(`${TEST_MARKER}-slot-image`, "utf-8");
    const file = await pmWriter.setUiSlot(serviceClient, { nodeKey: CANONICAL_NODE_KEY, slotIndex: 2, fileName: `${TEST_MARKER}-slot2.jpg`, contentType: "image/jpeg", bytes });
    expect(file.slotIndex).toBe(2);
    expect(file.nodeKey).toBe(CANONICAL_NODE_KEY);

    const signedUrl = await pmWriter.getSignedFileUrl(serviceClient, file.storagePath);
    expect(signedUrl).toMatch(/^https?:\/\//);

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    const slotFiles = layer.files.filter((f) => f.slotIndex !== null);
    expect(slotFiles.some((f) => f.id === file.id)).toBe(true);
  }, 20_000);

  it("setting a slot that's already filled replaces the old file, never leaving two", async () => {
    const first = await pmWriter.setUiSlot(serviceClient, { nodeKey: CANONICAL_NODE_KEY, slotIndex: 3, fileName: `${TEST_MARKER}-first.jpg`, contentType: "image/jpeg", bytes: Buffer.from("a") });
    const second = await pmWriter.setUiSlot(serviceClient, { nodeKey: CANONICAL_NODE_KEY, slotIndex: 3, fileName: `${TEST_MARKER}-second.jpg`, contentType: "image/jpeg", bytes: Buffer.from("b") });
    expect(second.id).not.toBe(first.id);

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    const slot3 = layer.files.filter((f) => f.slotIndex === 3);
    expect(slot3).toHaveLength(1);
    expect(slot3[0].id).toBe(second.id);
  }, 20_000);

  it("clears a UI slot, removing both the row and the Storage object", async () => {
    const file = await pmWriter.setUiSlot(serviceClient, { nodeKey: CANONICAL_NODE_KEY, slotIndex: 1, fileName: `${TEST_MARKER}-clearme.jpg`, contentType: "image/jpeg", bytes: Buffer.from("x") });
    await pmWriter.clearUiSlot(serviceClient, { nodeKey: CANONICAL_NODE_KEY, slotIndex: 1 });

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.files.some((f) => f.id === file.id)).toBe(false);

    // Storage object is gone too — Supabase validates existence at sign time, so even
    // requesting a signed URL for it now fails, not just the eventual download.
    await expect(pmWriter.getSignedFileUrl(serviceClient, file.storagePath)).rejects.toThrow(/not found/i);
  }, 20_000);

  it("clearing an already-empty slot is a safe no-op", async () => {
    await expect(pmWriter.clearUiSlot(serviceClient, { nodeKey: CANONICAL_NODE_KEY, slotIndex: 0 })).resolves.toBeUndefined();
  }, 20_000);

  it("DROP intake: a file uploaded with a nodeKey attaches directly to that node — no UNSORTED detour needed for a targeted drop", async () => {
    const bytes = Buffer.from(`${TEST_MARKER}-targeted-drop`, "utf-8");
    const file = await pmWriter.uploadFile(serviceClient, { fileName: `${TEST_MARKER}-targeted.txt`, contentType: "text/plain", bytes, nodeKey: CANONICAL_NODE_KEY });
    expect(file.nodeKey).toBe(CANONICAL_NODE_KEY);
    expect(file.slotIndex).toBeNull();

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.files.some((f) => f.id === file.id)).toBe(true);
  }, 20_000);

  it("DROP intake: multiple files uploaded in one batch (PHOTOS/FILES multi-select) all land as separate pm_files rows on the same node", async () => {
    const uploads = await Promise.all(
      [0, 1, 2].map((i) => pmWriter.uploadFile(serviceClient, { fileName: `${TEST_MARKER}-batch-${i}.txt`, contentType: "text/plain", bytes: Buffer.from(`${i}`), nodeKey: CANONICAL_NODE_KEY })),
    );
    expect(new Set(uploads.map((u) => u.id)).size).toBe(3);

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    for (const u of uploads) expect(layer.files.some((f) => f.id === u.id)).toBe(true);
  }, 20_000);

  it("DROP intake: removing a file deletes both the pm_files row and the Storage object", async () => {
    const file = await pmWriter.uploadFile(serviceClient, { fileName: `${TEST_MARKER}-removeme.txt`, contentType: "text/plain", bytes: Buffer.from("x"), nodeKey: CANONICAL_NODE_KEY });
    await pmWriter.deleteFile(serviceClient, file.id);

    const layer = await getPmLayerForNodeKeys(anonClient, [CANONICAL_NODE_KEY]);
    expect(layer.files.some((f) => f.id === file.id)).toBe(false);
    await expect(pmWriter.getSignedFileUrl(serviceClient, file.storagePath)).rejects.toThrow(/not found/i);
  }, 20_000);

  it("DROP intake: upload failure behavior — deleting a file id that doesn't exist rejects clearly rather than silently succeeding", async () => {
    await expect(pmWriter.deleteFile(serviceClient, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  }, 20_000);

  it("RLS: anon can read pm_people but cannot insert one directly", async () => {
    const people = await listPeople(anonClient);
    expect(Array.isArray(people)).toBe(true);

    const { error } = await anonClient.from("pm_people").insert({ name: "should-be-denied" });
    expect(error).not.toBeNull();
  }, 20_000);

  it("RLS: anon cannot write pm_items directly", async () => {
    const { error } = await anonClient.from("pm_items").insert({ kind: "todo", title: "should-be-denied" });
    expect(error).not.toBeNull();
  }, 20_000);
});
