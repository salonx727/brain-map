"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { counts, hasLink, isEmpty, linksOf } from "./graph";
import { nextUnusedTribeColor } from "@/lib/pm/tribeColors";
import {
  createNodeLinkAction,
  createPmNodeAction,
  deletePmNodeAction,
  getSignedFileUrlAction,
  listItemsForNodeAction,
  setPmNodeParentAction,
  uploadFileAction,
  upsertLayoutPositionAction,
} from "@/app/actions/pm";
import type { BrainNode, Item, Model, Shape } from "./types";
import type { PmItem } from "@/lib/types/pm";

/* Model itself now lives in ./types, because the server builds one before any of this
   client module exists. Re-exported so every existing `from "@/lib/brain"` import keeps
   working untouched. */
export type { Model };

/* The arrangement is read server-side from the canonical COYOTE mirror plus the PM layer
   (lib/adapter.ts) and handed in whole. Edits go back the same way — one Server Action per
   kind of change, never a whole-model blob, because the PM layer is relational and a
   to-do, a wire and a position are separate rows with separate lifetimes.

   There is deliberately no generic save() here any more. A single "save the model" call
   cannot exist against a relational backend without diffing, and the version of it that
   used to sit in this file did nothing at all while every call site believed otherwise.
   Removing it is what guarantees a new call site has to name the write it intends. */
/* Idle is silent. The chrome shares this line with the lock hints, so a standing "all
   good" message would sit on top of them forever; a completed write announces itself
   through the SAVED flash instead. What does stay up is a failure, until the next write
   either succeeds or fails in its own right. */
const IDLE_NOTE = "";
const SAVING_NOTE = "SAVING…";

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > 120 ? raw.slice(0, 117) + "…" : raw;
}

export type Brain = {
  model: Model;
  /** re-read the model after a mutation */
  bump: () => void;
  version: number;

  /**
   * Sends one change to the database.
   *
   * Callers mutate the model first so the surface responds immediately, then hand the
   * write and the way to take it back. On failure the rollback runs, the surface returns
   * to what is actually stored, and the note says why — the flash never fires for a write
   * that did not land, which is the whole reason this is not fire-and-forget.
   */
  persist: (run: () => Promise<unknown>, rollback?: () => void) => void;
  /**
   * Replace this card's TO DO / typed-blocker lists with whatever pm_items currently
   * holds. Called after a write so the list is the database, not the optimistic row.
   * Canon §15 blockers stay — they have no pm_items row.
   */
  refreshNodeLists: (nodeId: string) => Promise<void>;
  storeNote: string;
  savedFlash: boolean;

  /**
   * Files onto a card: uploaded, then shown. Lives here rather than in IntakeProvider
   * because the canvas drops files too, and the canvas sits outside that provider — a
   * write intent belongs with the other write intents, not with the file pickers.
   */
  addFiles: (nodeId: string, files: FileList | File[]) => void;

  /** Creates a real PM node. Resolves to its permanent node_key, or null if the write failed. */
  addNode: (opts: {
    x: number;
    y: number;
    ref?: string;
    name?: string;
    shape?: Shape;
    wireTo?: string | null;
  }) => Promise<string | null>;
  removeNode: (id: string, quiet: boolean) => void;
  /**
   * Nests an already-existing card under another, instead of createPmNode's "type a
   * label, get a new one." No-op for a canonical childId — see canEditNode: it has no PM
   * row for parent_node_key to live on.
   */
  attachExistingAsSub: (childId: string, parentId: string) => void;
  /** What was just removed, for the standing notice. Removal is permanent — see removeNode. */
  removed: { ref: string; quiet: boolean } | null;
  reset: () => void;
  isEmpty: (id: string) => boolean;
  /**
   * Whether this card's own content can be edited here at all. False for every canonical
   * node: its name and identity come from COYOTE, which this app reads and never writes.
   * To-dos, files, wires and position attach to a canonical node freely — those live in
   * the PM layer. Only the node itself is untouchable.
   */
  canEditNode: (id: string) => boolean;
  /**
   * The layout every saved position belongs to. Null when Supabase is not configured, in
   * which case dragging still moves cards on screen but nothing is written — the surface
   * says so rather than pretending.
   */
  layoutId: string | null;
};

const BrainCtx = createContext<Brain | null>(null);

export function useBrain(): Brain {
  const ctx = useContext(BrainCtx);
  if (!ctx) throw new Error("useBrain must be used inside BrainProvider");
  return ctx;
}

export function BrainProvider({
  initialModel,
  layoutId = null,
  children,
}: {
  initialModel: Model;
  layoutId?: string | null;
  children: React.ReactNode;
}) {
  const modelRef = useRef<Model>(initialModel);

  const [version, setVersion] = useState(0);
  const [storeNote, setStoreNote] = useState(IDLE_NOTE);
  const [savedFlash, setSavedFlash] = useState(false);
  const [removed, setRemoved] = useState<{ ref: string; quiet: boolean } | null>(null);

  const inflight = useRef(0);
  const flashTimer = useRef<number | null>(null);
  const removedTimer = useRef<number | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const persist = useCallback(
    (run: () => Promise<unknown>, rollback?: () => void) => {
      inflight.current += 1;
      setStoreNote(SAVING_NOTE);
      run()
        .then(() => {
          inflight.current -= 1;
          // Only the last write standing announces itself, so a burst of edits reads as
          // one "saved" rather than a strobe.
          if (inflight.current > 0) return;
          setStoreNote(IDLE_NOTE);
          setSavedFlash(true);
          if (flashTimer.current) window.clearTimeout(flashTimer.current);
          flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600);
        })
        .catch((err: unknown) => {
          inflight.current -= 1;
          rollback?.();
          bump();
          setStoreNote("NOT SAVED · " + messageOf(err));
        });
    },
    [bump],
  );

  const refreshNodeLists = useCallback(
    async (nodeId: string) => {
      const d = modelRef.current.nodes[nodeId];
      if (!d) return;
      const rows = await listItemsForNodeAction(nodeId);
      const asEntry = (item: PmItem): Item => ({
        id: item.id,
        text: item.title,
        done: item.status === "done",
        sec: "",
      });
      d.todos = rows.filter((r) => r.kind === "todo").map(asEntry);
      bump();
    },
    [bump],
  );

  const addFiles = useCallback(
    (nodeId: string, list: FileList | File[]) => {
      const d = modelRef.current.nodes[nodeId];
      const arr = Array.from(list);
      if (!d || !arr.length) return;

      persist(async () => {
        for (const f of arr) {
          const form = new FormData();
          form.set("file", f);
          form.set("nodeKey", nodeId);
          const record = await uploadFileAction(form);
          // Bytes are private, so the surface shows a signed link to the row that now
          // exists — never the local File, which looks identical and disappears on reload.
          const url = record.contentType?.startsWith("image/")
            ? await getSignedFileUrlAction(record.storagePath)
            : null;
          d.drops = d.drops.concat([
            {
              id: record.id,
              storagePath: record.storagePath,
              name: record.fileName,
              size: record.sizeBytes,
              type: record.contentType ?? undefined,
              data: url,
            },
          ]);
          bump();
        }
      });
    },
    [bump, persist],
  );

  /* ---------------- create ---------------- */
  const addNode = useCallback(
    async (opts: {
      x: number;
      y: number;
      ref?: string;
      name?: string;
      shape?: Shape;
      wireTo?: string | null;
    }): Promise<string | null> => {
      const m = modelRef.current;
      inflight.current += 1;
      setStoreNote(SAVING_NOTE);
      try {
        // The database assigns node_key and display_ref; nothing is placed on the canvas
        // until it does. A temporary local id would have to be swapped for the real one
        // across nodes, order, links and whatever card is open — and any of those missed
        // is a card that silently stops saving.
        const { node: created, ruling } = await createPmNodeAction({
          label: opts.name || "",
          parentNodeKey: opts.wireTo ?? null,
        });

        // Auto-assigned so a card someone just made is never the same hue as one
        // already on the field — never user-picked at creation, never touching a
        // fixed engine's own NODE_HUES entry in Field3D.tsx.
        const usedColors = Object.values(m.nodes)
          .map((n) => n.color)
          .filter((c): c is string => c !== null);
        const color = nextUnusedTribeColor(usedColors).key;

        m.nodes[created.nodeKey] = {
          id: created.nodeKey,
          ref: created.displayRef,
          shape: opts.shape || "box",
          x: opts.x,
          y: opts.y,
          name: created.label,
          sec: "",
          color,
          state: "UNTOUCHED",
          origin: "user",
          // A new card is a proposal, and it says so from the first paint. Waiting for a
          // reload to reveal that would let it read, briefly, as though canon had accepted
          // something nobody has ruled on.
          awaitingRuling: Boolean(ruling),
          rulingRef: ruling?.rulingRef,
          subs: [],
          todos: [],
          blockers: [],
          screens: [],
          drops: [],
        };
        m.order.push(created.nodeKey);
        if (ruling) m.rulings = [...m.rulings, ruling];

        // parent_node_key is nesting, not a drawn wire. The 3D field and the SVG
        // paths both read model.links; without a pm_node_links row the new card
        // has no edges, layout3 parks it off-camera, and "WIRED TO THIS CARD"
        // looked like it did nothing.
        if (opts.wireTo && m.nodes[opts.wireTo]) {
          try {
            const row = await createNodeLinkAction({ fromNodeKey: created.nodeKey, toNodeKey: opts.wireTo });
            m.links.push({ id: row.id, a: created.nodeKey, b: opts.wireTo, fromPromote: true });
          } catch (err) {
            setStoreNote("CARD SAVED · WIRE NOT SAVED · " + messageOf(err));
          }
        }

        if (layoutId) {
          try {
            await upsertLayoutPositionAction({ layoutId, nodeKey: created.nodeKey, x: opts.x, y: opts.y, color });
          } catch {
            // Position (and the assigned color with it) is still on the canvas this
            // session; a reload drops both to the unplaced row's defaults. Not worth
            // refusing the card over.
          }
        }

        inflight.current -= 1;
        if (inflight.current === 0) {
          setStoreNote(IDLE_NOTE);
          setSavedFlash(true);
          if (flashTimer.current) window.clearTimeout(flashTimer.current);
          flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600);
        }
        bump();
        return created.nodeKey;
      } catch (err) {
        inflight.current -= 1;
        setStoreNote("NOT SAVED · " + messageOf(err));
        bump();
        return null;
      }
    },
    [bump, layoutId],
  );

  /* ---------------- removal · permanent ----------------
     deletePmNode clears the node's files from Storage along with its items, notes,
     references and state. None of that can be handed back twelve seconds later, so the
     old undo offer is gone rather than kept as a button that cannot do what it says. The
     two-tap confirm on the card is the real guard. */
  const removeNode = useCallback(
    (id: string, quiet: boolean) => {
      const m = modelRef.current;
      const d = m.nodes[id];
      if (!d) return;

      const priorLinks = linksOf(m.links, id).slice();
      const priorIndex = m.order.indexOf(id);
      const priorRulings = m.rulings;

      m.links = m.links.filter((l) => l.a !== id && l.b !== id);
      m.order = m.order.filter((o) => o !== id);
      // The open ruling goes with the card — deletePmNode withdraws it server-side for the
      // same reason: Shawn rules one at a time, so a queue entry for a card that no longer
      // exists costs him a real turn.
      m.rulings = m.rulings.filter((r) => r.nodeKey !== id);
      delete m.nodes[id];
      bump();

      persist(
        () => deletePmNodeAction(id),
        () => {
          m.nodes[id] = d;
          m.order.splice(Math.min(priorIndex, m.order.length), 0, id);
          priorLinks.forEach((l) => m.links.push(l));
          m.rulings = priorRulings;
        },
      );

      setRemoved({ ref: d.ref, quiet });
      if (removedTimer.current) window.clearTimeout(removedTimer.current);
      removedTimer.current = window.setTimeout(() => setRemoved(null), 8000);
    },
    [bump, persist],
  );

  /* ---------------- nest an existing card ----------------
     The other half of "Add a sub-node": that flow only ever creates a brand-new card.
     This one points an existing, already-created card's parent_node_key at d.id instead —
     same two writes as addNode's wireTo branch (parent + a real link), just against a row
     that already exists rather than one this call is minting. */
  const attachExistingAsSub = useCallback(
    (childId: string, parentId: string) => {
      const m = modelRef.current;
      const child = m.nodes[childId];
      const parent = m.nodes[parentId];
      // Only a PM-created card has a pm_nodes row for parent_node_key to live on — a
      // canonical card's identity is COYOTE's, same boundary canEditNode already draws.
      if (!child || !parent || child.origin !== "user" || childId === parentId) return;

      const priorLinks = m.links.slice();
      const alreadyLinked = hasLink(m.links, childId, parentId);
      if (!alreadyLinked) {
        m.links.push({ a: childId, b: parentId, fromPromote: true });
      }
      bump();

      persist(
        async () => {
          await setPmNodeParentAction(childId, parentId);
          if (alreadyLinked) return;
          const row = await createNodeLinkAction({ fromNodeKey: childId, toNodeKey: parentId });
          const added = m.links.find((l) => l.a === childId && l.b === parentId && !l.id);
          if (added) added.id = row.id;
        },
        () => {
          m.links = priorLinks;
        },
      );
    },
    [bump, persist],
  );

  /* Pressed on purpose, never automatic. Everything lives in the database now, so this
     re-reads it — which discards nothing except a failed edit still sitting on screen. */
  const reset = useCallback(() => {
    window.location.reload();
  }, []);

  const isEmptyCb = useCallback(
    (id: string) => isEmpty(modelRef.current.nodes, modelRef.current.links, id),
    [],
  );

  const canEditNode = useCallback((id: string) => modelRef.current.nodes[id]?.origin === "user", []);

  const value = useMemo<Brain>(
    () => ({
      model: modelRef.current,
      bump,
      version,
      persist,
      refreshNodeLists,
      storeNote,
      savedFlash,
      addFiles,
      addNode,
      removeNode,
      attachExistingAsSub,
      removed,
      reset,
      isEmpty: isEmptyCb,
      canEditNode,
      layoutId,
    }),
    [bump, version, persist, refreshNodeLists, storeNote, savedFlash, addFiles, addNode, removeNode, attachExistingAsSub, removed, reset, isEmptyCb, canEditNode, layoutId],
  );

  return <BrainCtx.Provider value={value}>{children}</BrainCtx.Provider>;
}

/** What RESET says it will discard, before it does it. */
export function resetTally(model: Model): { placed: number; items: number } {
  return {
    placed: model.order.length,
    items: model.order.reduce(
      (a, id) => a + counts(model.nodes[id]).reduce((x, y) => x + y, 0),
      0,
    ),
  };
}

/** Kept beside the provider so a card can ask what it is without importing the model's types. */
export function isCanonical(node: BrainNode): boolean {
  return node.origin === "canon";
}
