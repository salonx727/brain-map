// Bridges real canonical + PM data (Supabase-backed) into this prototype's own Model
// shape, so every component below it stays exactly as it was written. Nothing in
// components/ knows a database exists; this file is the whole seam.
//
// `node_key` IS the BrainNode id here — the prototype minted arbitrary "n0"/"n1" ids
// because a localStorage blob needed nothing better, and ours are already real, stable
// and meaningful. That single decision is what lets a to-do, a position and a wire all
// refer to the same node across reloads.
//
// Where the seed still wins: layout, shape and display name for the thirteen nodes the
// sheet already places. The canonical label is "E01 - Ghost Notes"; the sheet says
// "GHOST NOTES" at (-470, 230), and the sheet is the design. Canonical data fills in
// everything the sheet has no opinion about, and anything not in the sheet at all (a PM
// node someone added) is placed below the map rather than dropped.

import { SEED } from "./seed";
import type { BrainNode, Drop, Item, Link, Model, NodeState, Shape, Shot } from "./types";
import type { CanonicalConnection, CanonicalNode, Diagnostic } from "@/lib/types/canonicalNode";
import type { PmLayer, PmLayoutPosition, PmNodeWorkState } from "@/lib/types/pm";
import { OWNERS, unattributedFrom } from "@/lib/owners";

/** The database spells states with underscores; this UI's own NodeState uses spaces. Converted here and nowhere else. */
const DB_TO_UI_STATE: Record<PmNodeWorkState, NodeState> = {
  UNTOUCHED: "UNTOUCHED",
  IN_BUILD: "IN BUILD",
  BLOCKED: "BLOCKED",
  DONE: "DONE",
  OUT_OF_SCOPE: "OUT OF SCOPE",
};

export function uiStateToDb(state: NodeState): PmNodeWorkState {
  const found = (Object.keys(DB_TO_UI_STATE) as PmNodeWorkState[]).find((k) => DB_TO_UI_STATE[k] === state);
  return found ?? "UNTOUCHED";
}

/**
 * The sheet's ref for a canonical key: `engine:E01` -> `E01`, `intake:GATE` -> `INT GATE`.
 * Intake is spelled out rather than sliced because LOCK-260901-369's class prefix is
 * `INT GATE`, which is what SEED and every card face already say.
 */
export function seedRefOf(nodeKey: string): string {
  const [kind, rest] = [nodeKey.slice(0, nodeKey.indexOf(":")), nodeKey.slice(nodeKey.indexOf(":") + 1)];
  return kind === "intake" ? `INT ${rest}` : rest;
}

const SEED_BY_REF = new Map(SEED.map((s) => [s[0], { shape: s[1], x: s[2], y: s[3], name: s[4], sec: s[5] }]));

/** Where a node with no sheet entry and no saved position goes — below the sheet, in arrival order, never on top of it. */
const UNPLACED_ROW_Y = 1650;
const UNPLACED_SPACING = 320;

function emptyNode(id: string, ref: string, shape: Shape, x: number, y: number, name: string, sec: string, origin: "canon" | "user"): BrainNode {
  return {
    id,
    ref,
    shape,
    x,
    y,
    name,
    sec,
    color: null,
    state: "UNTOUCHED",
    origin,
    subs: [],
    todos: [],
    blockers: [],
    screens: [null, null, null, null],
    drops: [],
  };
}

export function buildModel(
  canonicalNodes: CanonicalNode[],
  connections: CanonicalConnection[],
  pm: PmLayer,
  positions: Map<string, PmLayoutPosition>,
  diagnostics: Diagnostic[] = [],
): Model {
  // Screens are canonical but are not engine-graph nodes — Shawn's ruling, 2026-09-07.
  // The sheet contains none either, so this keeps the two in agreement rather than
  // rendering six cards the design never asked for.
  const mapNodes = canonicalNodes.filter((n) => n.kind !== "screen");

  const nodes: Model["nodes"] = {};
  const order: string[] = [];
  let unplaced = 0;

  for (const node of mapNodes) {
    const ref = seedRefOf(node.nodeKey);
    const seed = SEED_BY_REF.get(ref);
    const saved = positions.get(node.nodeKey);
    const x = saved?.x ?? seed?.x ?? unplaced * UNPLACED_SPACING;
    const y = saved?.y ?? seed?.y ?? UNPLACED_ROW_Y;
    if (!saved && !seed) unplaced += 1;

    nodes[node.nodeKey] = emptyNode(
      node.nodeKey,
      ref,
      seed?.shape ?? (node.kind === "intake" ? "circle" : "box"),
      x,
      y,
      seed?.name ?? node.label,
      seed?.sec ?? node.canonRefs[0]?.value ?? "",
      "canon",
    );
    // §15's blockers and §00a's open questions, already extracted and attributed to an
    // engine by the parser and carried through field_states. They were being published
    // and then dropped on the floor here, so the map showed only hand-typed items and
    // canon's own list of what is in the way was invisible.
    //
    // A question goes in TO DO rather than BLK on purpose: §00a is a queue of things
    // awaiting an answer, not things declared to be blocking. Both are read-only.
    if (node.kind === "engine") {
      const target = nodes[node.nodeKey];
      for (const b of node.blockers) {
        target.blockers.push({ text: b.text, done: false, sec: b.sourceSection, canon: true });
      }
      for (const q of node.openQuestions) {
        const prefix = [q.qId, q.status].filter(Boolean).join(" · ");
        target.todos.push({
          text: q.text,
          done: (q.status ?? "").toUpperCase() === "CLOSED",
          sec: prefix ? `${q.sourceSection} · ${prefix}` : q.sourceSection,
          canon: true,
        });
      }
    }

    order.push(node.nodeKey);
  }

  // The owner cards. Built after the canonical loop and before the PM one because they
  // are neither: their identity is fixed here rather than in COYOTE (nothing in canon
  // declares a person), and they are not user-created, so `canon` origin is what keeps
  // them from being renamed or deleted like a card someone added.
  //
  // Everything they hold is read-only for the same reason an engine's canon items are —
  // there is no row to edit and the next publish would restore it. But the card itself
  // is a real node with a real key, so a hand-typed to-do, a dropped file, a work state
  // or a wire attaches to it exactly as it would to an engine.
  const loose = unattributedFrom(diagnostics);
  for (const owner of OWNERS) {
    const saved = positions.get(owner.nodeKey);
    nodes[owner.nodeKey] = emptyNode(
      owner.nodeKey,
      owner.ref,
      owner.shape,
      saved?.x ?? owner.x,
      saved?.y ?? owner.y,
      owner.name,
      owner.sec,
      "canon",
    );
    const target = nodes[owner.nodeKey];
    for (const item of loose) {
      if (item.kind !== owner.takes) continue;
      const detail = [item.qId, item.status].filter(Boolean).join(" · ");
      const entry: Item = {
        text: item.text,
        done: (item.status ?? "").toUpperCase() === "CLOSED",
        sec: detail ? `${item.sourceSection} · ${detail}` : item.sourceSection,
        canon: true,
      };
      // Same tab an engine's items go to, so BLK means §15 and TO DO means §00a
      // everywhere on the map rather than meaning one thing per card class.
      if (item.kind === "blocker") target.blockers.push(entry);
      else target.todos.push(entry);
    }
    order.push(owner.nodeKey);
  }

  for (const pmNode of pm.nodes) {
    const saved = positions.get(pmNode.nodeKey);
    const x = saved?.x ?? unplaced * UNPLACED_SPACING;
    const y = saved?.y ?? UNPLACED_ROW_Y;
    if (!saved) unplaced += 1;
    nodes[pmNode.nodeKey] = emptyNode(pmNode.nodeKey, pmNode.displayRef, "box", x, y, pmNode.label, "", "user");
    order.push(pmNode.nodeKey);
  }

  for (const s of pm.states) {
    const target = nodes[s.nodeKey];
    if (target) target.state = DB_TO_UI_STATE[s.state];
  }

  for (const item of pm.items) {
    if (!item.nodeKey) continue;
    const target = nodes[item.nodeKey];
    if (!target) continue;
    const entry: Item = { id: item.id, text: item.title, done: item.status === "done", sec: "" };
    if (item.kind === "todo") target.todos.push(entry);
    else target.blockers.push(entry);
  }

  for (const file of pm.files) {
    if (!file.nodeKey) continue;
    const target = nodes[file.nodeKey];
    if (!target) continue;
    // `data` stays null: bytes live in private Storage and are fetched through a signed
    // URL when something actually needs to show them, never inlined into the model.
    if (file.slotIndex !== null && file.slotIndex >= 0 && file.slotIndex <= 3) {
      const shot: Shot = { id: file.id, storagePath: file.storagePath, name: file.fileName, data: null };
      target.screens[file.slotIndex] = shot;
    } else {
      const drop: Drop = {
        id: file.id,
        storagePath: file.storagePath,
        name: file.fileName,
        size: file.sizeBytes,
        type: file.contentType ?? undefined,
        data: null,
      };
      target.drops.push(drop);
    }
  }

  // Two sources, deliberately distinguishable. A COYOTE-declared edge carries `canon` and
  // no id, so the UI can refuse to delete something this app never owned; a user's wire
  // carries a real pm_node_links.id and can be removed.
  const links: Link[] = [];
  for (const c of connections) {
    if (!nodes[c.fromNodeKey] || !nodes[c.toNodeKey]) continue;
    links.push({ canon: true, a: c.fromNodeKey, b: c.toNodeKey, why: c.declaringCitation, back: c.backward });
  }
  for (const l of pm.links) {
    if (!nodes[l.fromNodeKey] || !nodes[l.toNodeKey]) continue;
    links.push({ id: l.id, a: l.fromNodeKey, b: l.toNodeKey, why: l.citation ?? undefined });
  }

  // A PM node's parent_node_key is nesting, not a wire — createPmNode never requires a
  // pm_node_links row alongside it (see pmWriter.ts's own comment on the column). Most of
  // the time the UI's own promote flow adds the real link too, but wherever it doesn't
  // (a failed link write, a node nested some other way) the parent relationship still
  // deserves to be seen rather than silently dropped, which is what happened before this:
  // buildModel never read parentNodeKey at all. Synthesized, never persisted — no `id`,
  // so nothing here is a row the UI could delete.
  for (const pmNode of pm.nodes) {
    if (!pmNode.parentNodeKey) continue;
    if (!nodes[pmNode.nodeKey] || !nodes[pmNode.parentNodeKey]) continue;
    const alreadyWired = links.some(
      (l) =>
        (l.a === pmNode.nodeKey && l.b === pmNode.parentNodeKey) ||
        (l.a === pmNode.parentNodeKey && l.b === pmNode.nodeKey),
    );
    if (alreadyWired) continue;
    links.push({ a: pmNode.nodeKey, b: pmNode.parentNodeKey, containment: true });
  }

  const unrouted: Drop[] = pm.files
    .filter((f) => !f.nodeKey)
    .map((f) => ({
      id: f.id,
      storagePath: f.storagePath,
      name: f.fileName,
      size: f.sizeBytes,
      type: f.contentType ?? undefined,
      data: null,
    }));

  return { nodes, order, links, unrouted };
}
