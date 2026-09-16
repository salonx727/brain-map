// Every write to the PM layer. `client` must be constructed with the service-role
// credential (never anon) — every pm_* table denies INSERT/UPDATE/DELETE to anon by RLS
// (see 0002_pm_layer.sql), so this module is the only place those writes can land.
// Called only from Next.js Server Actions (server-side), never from a Client Component —
// the browser never holds this credential, matching the canonical layer's own boundary.
//
// Deliberate scope note (see the implementation report): this reuses the same
// service-role credential as the canonical sync job (publisher.ts) rather than
// provisioning a fourth Supabase role for a still-three-person internal tool. The
// mitigation is that this module never calls publish_canonical_snapshot or writes any
// canonical_* table — only publisher.ts does that, and this file doesn't import it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionIntent, ConnectionRelation, PmCanonAssignment, PmFile, PmItem, PmLayout, PmLayoutPosition, PmNode, PmNodeLink, PmNodeState, PmNote, PmPerson, PmReference } from "@/lib/types/pm";
import { createRuling } from "@/lib/pm/rulingWriter";
import { defaultOwnerKey, isOwnerKey, type OwnerKey } from "@/lib/owners";

const BUCKET = "pm-files";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${label}: insert/update returned no row`);
  return result.data;
}

export async function createPerson(client: SupabaseClient, name: string): Promise<PmPerson> {
  const { data, error } = await client.from("pm_people").insert({ name }).select().single();
  const row = unwrap({ data, error }, "createPerson");
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function pmNodeFromRow(row: {
  node_key: string;
  display_ref: string;
  parent_node_key: string | null;
  label: string;
  kind: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}): PmNode {
  return {
    nodeKey: row.node_key,
    displayRef: row.display_ref,
    parentNodeKey: row.parent_node_key,
    label: row.label,
    kind: row.kind as PmNode["kind"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/**
 * The next human-readable ref for a new PM node — `SUB-<n>`/`FN-<n>`, per kind. Never the
 * uuid: confirmed live 2026-09-05, a raw `pm:<uuid>` node_key was leaking onto a card face
 * as its displayed ref (v5.2's own CODEMAN notes).
 *
 * One past the highest number in use, not one past the row count. Counting rows repeats a
 * ref as soon as anything has been deleted — observed live with two SUB-9 cards on the
 * board at once — and now that a card can be created and removed from the surface itself,
 * that is the ordinary case rather than an edge one. Numbers are not reused after a
 * delete, deliberately: a new card wearing a removed card's ref is worse than a gap.
 *
 * Still presentation only. A race between two simultaneous creates could repeat a number,
 * which stays an acceptable, disclosed tradeoff at this tool's actual scale (2-3
 * concurrent users, "last write wins" already the ruled concurrency policy) rather than a
 * sequence object for a value nothing else keys on.
 */
async function nextDisplayRef(client: SupabaseClient, kind: "subnode" | "function"): Promise<string> {
  const prefix = kind === "function" ? "FN" : "SUB";
  const { data, error } = await client.from("pm_nodes").select("display_ref").eq("kind", kind);
  if (error) throw new Error(`nextDisplayRef: ${error.message}`);

  let highest = 0;
  for (const row of data ?? []) {
    const match = /^[A-Z]+-(\d+)$/.exec(row.display_ref as string);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}-${highest + 1}`;
}

/**
 * A custom sub-node/function. parentNodeKey may be a canonical_nodes.node_key or another
 * pm_nodes.node_key — never validated against canonical_nodes here (that would create a
 * cross-table FK-shaped coupling this architecture deliberately avoids); an orphaned
 * parent just means the UI has nothing to nest under, not a data-integrity failure.
 *
 * Every node created here also opens a ruling. Shawn's instruction, 2026-09-09: a card
 * drawn on the map reaches canon only through his queue, and every one of them lands
 * there without anyone having to remember to send it. The ruling is not a promotion — it
 * is a request for one, and he rules from it in his own words.
 */
export async function createPmNode(client: SupabaseClient, input: { label: string; parentNodeKey?: string | null; kind?: "subnode" | "function"; createdBy?: string | null; intent?: Partial<ConnectionIntent> }): Promise<PmNode> {
  const kind = input.kind ?? "subnode";
  const displayRef = await nextDisplayRef(client, kind);
  const { data, error } = await client
    .from("pm_nodes")
    .insert({ label: input.label, parent_node_key: input.parentNodeKey ?? null, kind, display_ref: displayRef, created_by: input.createdBy ?? null })
    .select()
    .single();
  const row = unwrap({ data, error }, "createPmNode");
  const node = pmNodeFromRow(row);

  await createRuling(client, {
    nodeKey: node.nodeKey,
    label: node.label,
    parentNodeKey: node.parentNodeKey,
    intent: input.intent,
    submittedBy: input.createdBy ?? null,
  });

  return node;
}

/** Renames a PM-created node's label only — never touches node_key (permanent identity) or display_ref (assigned once at creation) — and has no equivalent for canonical nodes, which have no write path in this module at all. This is what makes "editable node name" safe: it only exists for rows this table itself created. */
export async function renamePmNode(client: SupabaseClient, nodeKey: string, label: string, updatedBy?: string | null): Promise<PmNode> {
  const { data, error } = await client
    .from("pm_nodes")
    .update({ label, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() })
    .eq("node_key", nodeKey)
    .select()
    .single();
  const row = unwrap({ data, error }, "renamePmNode");
  return pmNodeFromRow(row);
}

/**
 * Nests an existing PM node under a new parent — the "attach an existing card as a sub"
 * path, as opposed to createPmNode's "type a label, get a brand-new card" path. Only ever
 * targets a row in this table: a canonical node has no pm_nodes row to update, so
 * re-parenting one is refused by the same "no row, no update" mechanism as renamePmNode,
 * not a duplicated kind-check here. parentNodeKey is not validated against either table
 * for the same reason createPmNode doesn't — see that function's own comment.
 */
export async function setPmNodeParent(client: SupabaseClient, nodeKey: string, parentNodeKey: string | null, updatedBy?: string | null): Promise<PmNode> {
  const { data, error } = await client
    .from("pm_nodes")
    .update({ parent_node_key: parentNodeKey, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() })
    .eq("node_key", nodeKey)
    .select()
    .single();
  const row = unwrap({ data, error }, "setPmNodeParent");
  return pmNodeFromRow(row);
}

export async function createItem(client: SupabaseClient, input: { kind: "todo" | "blocker"; title: string; nodeKey?: string | null; detail?: string; ownerId?: string | null; createdBy?: string | null }): Promise<PmItem> {
  const { data, error } = await client
    .from("pm_items")
    .insert({ kind: input.kind, title: input.title, node_key: input.nodeKey ?? null, detail: input.detail ?? null, owner_id: input.ownerId ?? null, created_by: input.createdBy ?? null })
    .select()
    .single();
  const row = unwrap({ data, error }, "createItem");
  return itemFromRow(row);
}

export async function updateItemStatus(client: SupabaseClient, id: string, status: PmItem["status"], updatedBy?: string | null, waitingOn?: string | null): Promise<PmItem> {
  const { data, error } = await client
    .from("pm_items")
    .update({ status, waiting_on: waitingOn ?? null, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  const row = unwrap({ data, error }, "updateItemStatus");
  return itemFromRow(row);
}

/** Retitles a to-do or blocker. Separate from updateItemStatus because the two are edited independently — a line gets reworded far more often than it changes GTD status, and folding them into one call would make every keystroke also restate a status it has no opinion about. */
export async function updateItemTitle(client: SupabaseClient, id: string, title: string, updatedBy?: string | null): Promise<PmItem> {
  const { data, error } = await client
    .from("pm_items")
    .update({ title, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  const row = unwrap({ data, error }, "updateItemTitle");
  return itemFromRow(row);
}

/**
 * Removes a to-do or blocker outright.
 *
 * PmItemStatus is GTD's own vocabulary — inbox · next_action · waiting_for ·
 * someday_maybe · done — and none of those means "this line should not exist". Marking a
 * mistyped item `done` would be a lie the dashboard then counts as completed work, so a
 * removal is a removal.
 */
export async function deleteItem(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("pm_items").delete().eq("id", id);
  if (error) throw new Error(`deleteItem: ${error.message}`);
}

/** Resolves a fixed assignee name ("Shawn"/"Codeman") to its pm_people.id — never invented, never created on the fly here (0011 seeds both rows; a missing name is a real error, not a reason to mint one). */
async function getPersonByName(client: SupabaseClient, name: string): Promise<PmPerson> {
  const { data, error } = await client.from("pm_people").select("*").eq("name", name).single();
  if (error) throw new Error(`getPersonByName("${name}"): ${error.message}`);
  return { id: data.id, name: data.name, createdAt: data.created_at };
}

/**
 * Pushes an existing to-do or blocker from one person's list to the other's — the
 * reassignment feature. Never retypes the item: title, detail, kind, status, node_key,
 * and every other field are untouched. This is exactly what pm_items.owner_id already
 * exists for (0002); it sat unwritten after creation until this function.
 *
 * The history row (pm_item_assignments, 0011) is best-effort and deliberately separate
 * from the ownership update: the reassignment itself must succeed or fail on its own, and
 * a failure logging history a moment later must never look like "the reassignment did not
 * happen" when it did.
 */
export async function reassignItem(client: SupabaseClient, input: { itemId: string; toOwnerName: string; changedBy?: string | null }): Promise<PmItem> {
  const toOwner = await getPersonByName(client, input.toOwnerName);

  const { data: before, error: beforeError } = await client
    .from("pm_items")
    .select("owner_id")
    .eq("id", input.itemId)
    .single();
  if (beforeError) throw new Error(`reassignItem: ${beforeError.message}`);
  const fromOwnerId: string | null = before.owner_id;

  const { data, error } = await client
    .from("pm_items")
    .update({ owner_id: toOwner.id, updated_by: input.changedBy ?? null, updated_at: new Date().toISOString() })
    .eq("id", input.itemId)
    .select()
    .single();
  const row = unwrap({ data, error }, "reassignItem");

  if (fromOwnerId !== toOwner.id) {
    const { error: logError } = await client.from("pm_item_assignments").insert({
      item_id: input.itemId,
      from_owner_id: fromOwnerId,
      to_owner_id: toOwner.id,
      changed_by: input.changedBy ?? null,
    });
    if (logError) {
      // The reassignment already landed above. Losing the history row is a smaller
      // problem than pretending the reassignment failed because of it.
      console.error(`reassignItem: history row not written: ${logError.message}`);
    }
  }

  return itemFromRow(row);
}

/**
 * Pushes a COYOTE-declared line from one owner card to the other. Never writes
 * COYOTE, never mints a pm_items row — the line stays canon, the override lives
 * here. Assigning back to the default owner deletes the row so the table only
 * holds real moves.
 */
export async function assignCanonBlocker(
  client: SupabaseClient,
  input: {
    fingerprint: string;
    assignedTo: OwnerKey;
    text: string;
    sourceSection: string;
    kind: PmCanonAssignment["kind"];
  },
): Promise<PmCanonAssignment | null> {
  if (!input.fingerprint.trim()) throw new Error("assignCanonBlocker: fingerprint is required");
  if (!isOwnerKey(input.assignedTo)) throw new Error(`assignCanonBlocker: "${input.assignedTo}" is not an owner card`);

  if (input.assignedTo === defaultOwnerKey(input.kind)) {
    const { error } = await client.from("pm_canon_assignments").delete().eq("fingerprint", input.fingerprint);
    if (error) throw new Error(`assignCanonBlocker: ${error.message}`);
    return null;
  }

  const { data, error } = await client
    .from("pm_canon_assignments")
    .upsert(
      {
        fingerprint: input.fingerprint,
        assigned_to: input.assignedTo,
        text: input.text,
        source_section: input.sourceSection,
        kind: input.kind,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "fingerprint" },
    )
    .select()
    .single();
  const row = unwrap({ data, error }, "assignCanonBlocker");
  return {
    fingerprint: row.fingerprint,
    assignedTo: row.assigned_to as OwnerKey,
    text: row.text,
    sourceSection: row.source_section,
    kind: row.kind as PmCanonAssignment["kind"],
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: {
  id: string;
  node_key: string | null;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  waiting_on: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}): PmItem {
  return {
    id: row.id,
    nodeKey: row.node_key,
    kind: row.kind as PmItem["kind"],
    title: row.title,
    detail: row.detail,
    status: row.status as PmItem["status"],
    waitingOn: row.waiting_on,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export async function createNote(client: SupabaseClient, input: { kind: "note" | "decision"; body: string; nodeKey?: string | null; createdBy?: string | null }): Promise<PmNote> {
  const { data, error } = await client
    .from("pm_notes")
    .insert({ kind: input.kind, body: input.body, node_key: input.nodeKey ?? null, created_by: input.createdBy ?? null })
    .select()
    .single();
  const row = unwrap({ data, error }, "createNote");
  return { id: row.id, nodeKey: row.node_key, kind: row.kind, body: row.body, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

export async function addReference(client: SupabaseClient, input: { nodeKey: string; url: string; refType?: PmReference["refType"]; label?: string; createdBy?: string | null }): Promise<PmReference> {
  const { data, error } = await client
    .from("pm_references")
    .insert({ node_key: input.nodeKey, url: input.url, ref_type: input.refType ?? "link", label: input.label ?? null, created_by: input.createdBy ?? null })
    .select()
    .single();
  const row = unwrap({ data, error }, "addReference");
  return { id: row.id, nodeKey: row.node_key, refType: row.ref_type, label: row.label, url: row.url, createdBy: row.created_by, createdAt: row.created_at };
}

function fileFromRow(row: { id: string; node_key: string | null; storage_path: string; file_name: string; content_type: string | null; size_bytes: number | null; slot_index: number | null; created_by: string | null; created_at: string }): PmFile {
  return {
    id: row.id,
    nodeKey: row.node_key,
    storagePath: row.storage_path,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    slotIndex: row.slot_index,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function byteLength(bytes: Buffer | Blob | ArrayBuffer): number | null {
  if (bytes instanceof Buffer || bytes instanceof ArrayBuffer) return bytes.byteLength;
  if (typeof Blob !== "undefined" && bytes instanceof Blob) return bytes.size;
  return null;
}

/**
 * Uploads file bytes to the private bucket, then records metadata only after the upload
 * confirms — an orphaned Storage object with no DB row is harmless; a DB row pointing at
 * a missing object would render as broken UI, so this order is deliberate. `nodeKey:
 * null` records an UNSORTED drop. `slotIndex` is always null here — an ordinary
 * DROP-tab file; use addUiScreenshot for a UI-tab image instead.
 */
export async function uploadFile(
  client: SupabaseClient,
  input: { fileName: string; contentType: string | null; bytes: Buffer | Blob | ArrayBuffer; nodeKey?: string | null; createdBy?: string | null },
): Promise<PmFile> {
  const safeName = input.fileName.replace(/[^\w.\-]/g, "_");
  const storagePath = `${input.nodeKey ?? "unsorted"}/${crypto.randomUUID()}_${safeName}`;

  const { error: uploadError } = await client.storage.from(BUCKET).upload(storagePath, input.bytes, {
    contentType: input.contentType ?? undefined,
    upsert: false,
  });
  if (uploadError) throw new Error(`uploadFile: storage upload failed: ${uploadError.message}`);

  const { data, error } = await client
    .from("pm_files")
    .insert({
      node_key: input.nodeKey ?? null,
      storage_path: storagePath,
      file_name: input.fileName,
      content_type: input.contentType,
      size_bytes: byteLength(input.bytes),
      created_by: input.createdBy ?? null,
    })
    .select()
    .single();
  const row = unwrap({ data, error }, "uploadFile (metadata insert)");
  return fileFromRow(row);
}

/** Routes an UNSORTED file to a node (or moves it between nodes) — one UPDATE, the Storage object never moves. */
export async function assignFileToNode(client: SupabaseClient, fileId: string, nodeKey: string | null): Promise<PmFile> {
  const { data, error } = await client.from("pm_files").update({ node_key: nodeKey }).eq("id", fileId).select().single();
  const row = unwrap({ data, error }, "assignFileToNode");
  return fileFromRow(row);
}

/**
 * Adds one more UI screenshot for a node — real Storage upload, never a session-only
 * data URL. Purely additive: was setUiSlot, which cleared whatever already occupied a
 * fixed slot 0–3 before writing; Salman's ruling, 2026-09-15, removed the 4-item cap and
 * the replace-on-add behavior together, since a cap and "adding evicts the oldest" are
 * the same constraint seen from two sides. slot_index is now just this file's position
 * in an unbounded, append-only order — the next integer after whatever the node already
 * has, never a value the caller chooses, so two concurrent uploads can't both claim the
 * same position.
 */
export async function addUiScreenshot(
  client: SupabaseClient,
  input: { nodeKey: string; fileName: string; contentType: string | null; bytes: Buffer | Blob | ArrayBuffer; createdBy?: string | null },
): Promise<PmFile> {
  const { data: existing, error: selectError } = await client
    .from("pm_files")
    .select("slot_index")
    .eq("node_key", input.nodeKey)
    .not("slot_index", "is", null)
    .order("slot_index", { ascending: false })
    .limit(1);
  if (selectError) throw new Error(`addUiScreenshot: ${selectError.message}`);
  const nextIndex = (existing?.[0]?.slot_index ?? -1) + 1;

  const safeName = input.fileName.replace(/[^\w.\-]/g, "_");
  const storagePath = `${input.nodeKey}/ui-slot-${nextIndex}-${crypto.randomUUID()}_${safeName}`;

  const { error: uploadError } = await client.storage.from(BUCKET).upload(storagePath, input.bytes, {
    contentType: input.contentType ?? undefined,
    upsert: false,
  });
  if (uploadError) throw new Error(`addUiScreenshot: storage upload failed: ${uploadError.message}`);

  const { data, error } = await client
    .from("pm_files")
    .insert({
      node_key: input.nodeKey,
      storage_path: storagePath,
      file_name: input.fileName,
      content_type: input.contentType,
      size_bytes: byteLength(input.bytes),
      slot_index: nextIndex,
      created_by: input.createdBy ?? null,
    })
    .select()
    .single();
  const row = unwrap({ data, error }, "addUiScreenshot (metadata insert)");
  return fileFromRow(row);
}

/** Removes a file — both the Storage object and the pm_files row — keyed by id alone. Used for an ordinary DROP-tab file and, since 2026-09-15, for a UI screenshot too: neither has a fixed slot identity worth deleting by (nodeKey, slotIndex) instead of just its own id. */
export async function deleteFile(client: SupabaseClient, fileId: string): Promise<void> {
  const { data: existing, error: selectError } = await client.from("pm_files").select("storage_path").eq("id", fileId).single();
  if (selectError) throw new Error(`deleteFile: ${selectError.message}`);

  const { error: removeError } = await client.storage.from(BUCKET).remove([existing.storage_path]);
  if (removeError) throw new Error(`deleteFile: storage remove failed: ${removeError.message}`);

  const { error: deleteError } = await client.from("pm_files").delete().eq("id", fileId);
  if (deleteError) throw new Error(`deleteFile: row delete failed: ${deleteError.message}`);
}

/** A time-limited, signed download URL — the only way a file's bytes ever reach the browser; the bucket has no anon read policy at all. */
export async function getSignedFileUrl(client: SupabaseClient, storagePath: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) throw new Error(`getSignedFileUrl: ${error?.message ?? "no signed URL returned"}`);
  return data.signedUrl;
}

/** Ensures exactly one default layout exists; returns it. Safe to call repeatedly. */
export async function getOrCreateDefaultLayout(client: SupabaseClient, createdBy?: string | null): Promise<PmLayout> {
  const { data: existing, error: existingError } = await client.from("pm_layouts").select("*").eq("is_default", true).limit(1);
  if (existingError) throw new Error(`getOrCreateDefaultLayout: ${existingError.message}`);
  if (existing && existing.length > 0) {
    const row = existing[0];
    return { id: row.id, name: row.name, isDefault: row.is_default, createdBy: row.created_by, createdAt: row.created_at };
  }
  const { data, error } = await client.from("pm_layouts").insert({ name: "Default", is_default: true, created_by: createdBy ?? null }).select().single();
  const row = unwrap({ data, error }, "getOrCreateDefaultLayout (create)");
  return { id: row.id, name: row.name, isDefault: row.is_default, createdBy: row.created_by, createdAt: row.created_at };
}

/**
 * Position and colour — never a lock flag; see pm.ts / 0002_pm_layer.sql.
 *
 * `color` is genuinely optional, not "optional, defaults to null": most callers (every
 * plain drag) never pass one, and upsert sends only the columns present in the payload —
 * omitting the key here means the drag's ON CONFLICT UPDATE never touches the color
 * column, so a card's auto-assigned color survives every drag after the one that set it.
 * Passing `color: null` explicitly is still how a caller clears it on purpose.
 */
export async function upsertLayoutPosition(client: SupabaseClient, input: { layoutId: string; nodeKey: string; x: number; y: number; color?: string | null; updatedBy?: string | null }): Promise<PmLayoutPosition> {
  const row_: Record<string, unknown> = {
    layout_id: input.layoutId,
    node_key: input.nodeKey,
    x: input.x,
    y: input.y,
    updated_by: input.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.color !== undefined) row_.color = input.color;

  const { data, error } = await client
    .from("pm_layout_positions")
    .upsert(row_, { onConflict: "layout_id,node_key" })
    .select()
    .single();
  const row = unwrap({ data, error }, "upsertLayoutPosition");
  return { layoutId: row.layout_id, nodeKey: row.node_key, x: row.x, y: row.y, color: row.color, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/**
 * RESET clears arrangement only — every pm_layout_positions row for this layout (position
 * AND colour, since this table carries both) — never pm_nodes/pm_items/pm_notes/pm_files/
 * pm_references/pm_node_links. A layout reset undoing real work data would be a data-loss
 * bug, not a feature; the prototype reference's single-store "reset everything" doesn't
 * apply here because arrangement and content are separate, both-real persistence layers.
 * Returns the count actually cleared, for the caller's confirm-before-discard prompt.
 */
export async function resetLayout(client: SupabaseClient, layoutId: string): Promise<number> {
  const { data, error } = await client.from("pm_layout_positions").delete().eq("layout_id", layoutId).select("node_key");
  if (error) throw new Error(`resetLayout: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * A connection touching at least one PM-created node. The "at least one PM endpoint"
 * rule is NOT re-checked here — the DB trigger (pm_node_links_require_pm_endpoint_trg)
 * is the single source of truth for it, so this and any future caller can never drift
 * out of sync with the rule by duplicating it in application code. A rejected insert
 * surfaces the trigger's own message unchanged.
 */
export async function createNodeLink(client: SupabaseClient, input: { fromNodeKey: string; toNodeKey: string; citation?: string | null; createdBy?: string | null }): Promise<PmNodeLink> {
  const { data, error } = await client
    .from("pm_node_links")
    .insert({ from_node_key: input.fromNodeKey, to_node_key: input.toNodeKey, citation: input.citation ?? null, created_by: input.createdBy ?? null })
    .select()
    .single();
  const row = unwrap({ data, error }, "createNodeLink");
  return { id: row.id, fromNodeKey: row.from_node_key, toNodeKey: row.to_node_key, relation: row.relation ?? null, citation: row.citation, createdBy: row.created_by, createdAt: row.created_at };
}

/**
 * A wire that asserts something about §35 — and therefore a proposal, never a fact.
 *
 * Separate from createNodeLink because the two are different acts. That one draws the
 * containment wire a new card keeps to its parent, which claims nothing about
 * architecture; this one says "data flows from here to there", which is canon's to say,
 * so it opens a ruling and waits for Shawn.
 *
 * Both rows are written by one RPC rather than two calls from here. The narrowed endpoint
 * trigger (0010) requires the ruling to exist BEFORE a canonical-to-canonical link row,
 * and a caller that got that order wrong would either be refused outright or leave a queue
 * entry for a wire nobody can see. `propose_connection` owns that ordering so no caller
 * has to know it.
 */
export async function proposeConnection(
  client: SupabaseClient,
  input: { fromNodeKey: string; toNodeKey: string; relation: ConnectionRelation; label: string; createdBy?: string | null },
): Promise<{ rulingId: string; linkId: string | null; existing: boolean }> {
  const { data, error } = await client.rpc("propose_connection", {
    p_from: input.fromNodeKey,
    p_to: input.toNodeKey,
    p_relation: input.relation,
    p_label: input.label,
    p_created_by: input.createdBy ?? null,
  });
  if (error) throw new Error(`proposeConnection: ${error.message}`);
  const row = data as { ruling_id: string; link_id: string | null; existing: boolean };
  return { rulingId: row.ruling_id, linkId: row.link_id, existing: row.existing };
}

/**
 * Removes a wire. No trigger to satisfy on delete (the PM-endpoint rule only gates
 * insert/update) — a plain delete by id, plus the open ruling that wire was proposing.
 *
 * The ruling goes with it for the same reason deletePmNode withdraws a card's: Shawn rules
 * one at a time, so a queue entry for a wire that is no longer drawn costs him a real turn.
 * Resolved rulings stay — they are the record of what was proposed and what became of it.
 */
export async function deleteNodeLink(client: SupabaseClient, id: string): Promise<void> {
  const { error: rulingError } = await client.from("pm_rulings").delete().eq("link_id", id).eq("status", "pending");
  if (rulingError) throw new Error(`deleteNodeLink: clearing pm_rulings failed: ${rulingError.message}`);

  const { error } = await client.from("pm_node_links").delete().eq("id", id);
  if (error) throw new Error(`deleteNodeLink: ${error.message}`);
}

/**
 * Retargets a PM wire or edits its citation. Same trigger as insert: both ends still
 * cannot be canonical. The row keeps its id so the UI can keep holding it rather than
 * deleting and inserting, which would flash the wire away and make an in-place edit
 * look like a new one.
 */
export async function updateNodeLink(
  client: SupabaseClient,
  id: string,
  patch: { fromNodeKey?: string; toNodeKey?: string; citation?: string | null },
): Promise<PmNodeLink> {
  const body: Record<string, unknown> = {};
  if (patch.fromNodeKey !== undefined) body.from_node_key = patch.fromNodeKey;
  if (patch.toNodeKey !== undefined) body.to_node_key = patch.toNodeKey;
  if (patch.citation !== undefined) body.citation = patch.citation;
  const { data, error } = await client.from("pm_node_links").update(body).eq("id", id).select().single();
  const row = unwrap({ data, error }, "updateNodeLink");
  return { id: row.id, fromNodeKey: row.from_node_key, toNodeKey: row.to_node_key, relation: row.relation ?? null, citation: row.citation, createdBy: row.created_by, createdAt: row.created_at };
}

/**
 * Work-state is a fact about the node, true regardless of which named layout is being
 * viewed — see 0006_pm_node_state.sql's header comment for why this is its own table
 * rather than a column on pm_layout_positions. Valid for a canonical node_key (an engine)
 * just as much as a PM one — this table carries no FK to either, same rationale as
 * pm_layout_positions.node_key.
 */
export async function setNodeState(client: SupabaseClient, input: { nodeKey: string; state: PmNodeState["state"]; updatedBy?: string | null }): Promise<PmNodeState> {
  const { data, error } = await client
    .from("pm_node_state")
    .upsert({ node_key: input.nodeKey, state: input.state, updated_by: input.updatedBy ?? null, updated_at: new Date().toISOString() }, { onConflict: "node_key" })
    .select()
    .single();
  const row = unwrap({ data, error }, "setNodeState");
  return { nodeKey: row.node_key, state: row.state, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/**
 * Deletes a PM-created node and every real record that points at it — items, notes,
 * references, files (Storage objects included), links on either end, and its work-state
 * row. Refuses a key with no pm_nodes row: a canonical node (an engine, say) never has
 * one, and "canon cards are never removable" is enforced here by that absence, not by a
 * second, duplicated kind-check — the same "let the data model make the illegal state
 * unreachable" posture as renamePmNode having no canonical equivalent anywhere in this
 * module. Sub-nodes of the deleted node are NOT cascaded — they become parentless PM
 * nodes (parent_node_key pointed at a now-missing row), the same orphan-tolerant posture
 * createPmNode's own comment already documents for a parent that doesn't resolve.
 */
export async function deletePmNode(client: SupabaseClient, nodeKey: string): Promise<void> {
  const { data: existing, error: existingError } = await client.from("pm_nodes").select("node_key").eq("node_key", nodeKey).maybeSingle();
  if (existingError) throw new Error(`deletePmNode: ${existingError.message}`);
  if (!existing) throw new Error(`deletePmNode: "${nodeKey}" is not a PM-created node — nothing to delete (a canonical node has no delete path here or anywhere else)`);

  const { data: files, error: filesError } = await client.from("pm_files").select("id, storage_path").eq("node_key", nodeKey);
  if (filesError) throw new Error(`deletePmNode: ${filesError.message}`);
  if (files && files.length > 0) {
    const { error: removeError } = await client.storage.from(BUCKET).remove(files.map((f) => f.storage_path));
    if (removeError) throw new Error(`deletePmNode: storage remove failed: ${removeError.message}`);
  }

  for (const [table, column] of [
    ["pm_files", "node_key"],
    ["pm_items", "node_key"],
    ["pm_notes", "node_key"],
    ["pm_references", "node_key"],
    ["pm_node_state", "node_key"],
    // Position was missing from this list until 2026-09-09, so every card ever deleted
    // through the app left its x/y behind. Harmless to render — nothing looks up a
    // position for a node that is gone — but it is the one row that survives a delete, so
    // it is also the only forensic trace that a card was removed this way rather than by a
    // script, and leaving it made "what happened to this card" harder to answer than it
    // needed to be. Clearing it costs nothing; the trace was never worth the orphan.
    ["pm_layout_positions", "node_key"],
  ] as const) {
    const { error } = await client.from(table).delete().eq(column, nodeKey);
    if (error) throw new Error(`deletePmNode: clearing ${table} failed: ${error.message}`);
  }

  const { error: linksFromError } = await client.from("pm_node_links").delete().eq("from_node_key", nodeKey);
  if (linksFromError) throw new Error(`deletePmNode: clearing outgoing links failed: ${linksFromError.message}`);
  const { error: linksToError } = await client.from("pm_node_links").delete().eq("to_node_key", nodeKey);
  if (linksToError) throw new Error(`deletePmNode: clearing incoming links failed: ${linksToError.message}`);

  // Withdraw the open ruling with the card. Leaving it would show Shawn a queue entry for
  // something that no longer exists on the map — and he rules one at a time, so a ghost
  // costs him a real turn. Resolved rulings (ruled/rejected) are history and stay: their
  // label is snapshotted, so they still read correctly with no node behind them.
  const { error: rulingError } = await client.from("pm_rulings").delete().eq("node_key", nodeKey).eq("status", "pending");
  if (rulingError) throw new Error(`deletePmNode: clearing pm_rulings failed: ${rulingError.message}`);

  const { error: deleteError } = await client.from("pm_nodes").delete().eq("node_key", nodeKey);
  if (deleteError) throw new Error(`deletePmNode: ${deleteError.message}`);
}
