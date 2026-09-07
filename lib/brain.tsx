"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { counts, isEmpty, linksOf } from "./graph";
import type { BrainNode, Drop, Link, Model, Shape } from "./types";

/* Model itself now lives in ./types, because the server builds one before any of this
   client module exists. Re-exported so every existing `from "@/lib/brain"` import keeps
   working untouched. */
export type { Model };

type Trash = {
  node: BrainNode;
  links: Link[];
  index: number;
  at: number;
};

/* The arrangement no longer comes from localStorage. It is read server-side from the
   canonical COYOTE mirror plus the PM layer (lib/adapter.ts) and handed in whole, so the
   surface renders real nodes, real to-dos and real wires on first paint.

   Writes are not wired to the backend yet. Rather than let an edit look saved and vanish
   on reload — the single failure this whole rebuild exists to stop making — saveNow()
   below stays honest and the surface carries a standing note saying so. */
const NOT_WIRED_NOTE = "READ-ONLY · EDITS ARE NOT SAVED YET";

export type Brain = {
  model: Model;
  /** re-read the model after a mutation */
  bump: () => void;
  version: number;

  saveNow: () => void;
  saveSoon: () => void;
  storeNote: string;
  savedFlash: boolean;

  addNode: (opts: {
    x: number;
    y: number;
    ref?: string;
    name?: string;
    shape?: Shape;
    wireTo?: string | null;
  }) => string;
  removeNode: (id: string, quiet: boolean) => void;
  undo: () => void;
  /** what was taken back, for the twelve-second offer */
  undone: { ref: string; quiet: boolean } | null;
  reset: () => void;
  isEmpty: (id: string) => boolean;
};

const BrainCtx = createContext<Brain | null>(null);

export function useBrain(): Brain {
  const ctx = useContext(BrainCtx);
  if (!ctx) throw new Error("useBrain must be used inside BrainProvider");
  return ctx;
}

export function BrainProvider({ initialModel, children }: { initialModel: Model; children: React.ReactNode }) {
  const modelRef = useRef<Model>(initialModel);
  const seqRef = useRef<number>(initialModel.order.length);

  const [version, setVersion] = useState(0);
  const [storeNote, setStoreNote] = useState(NOT_WIRED_NOTE);
  /* Stays false while writes are unwired — see saveNow(). */
  const [savedFlash] = useState(false);
  const [undone, setUndone] = useState<{ ref: string; quiet: boolean } | null>(null);

  const trashRef = useRef<Trash | null>(null);
  const saveTimer = useRef<number | null>(null);
  const undoTimer = useRef<number | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /* Intentionally does not persist, and intentionally does not flash "saved" either —
     the flash is the surface's only signal that something was written, and firing it
     against a no-op is exactly how a person comes to believe they saved something they
     did not. The standing note stays up instead. */
  const saveNow = useCallback(() => {
    setStoreNote(NOT_WIRED_NOTE);
  }, []);

  const saveSoon = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(saveNow, 400);
  }, [saveNow]);

  /* ---------------- create · a new card wires itself ---------------- */
  const addNode = useCallback(
    (opts: {
      x: number;
      y: number;
      ref?: string;
      name?: string;
      shape?: Shape;
      wireTo?: string | null;
    }) => {
      const m = modelRef.current;
      seqRef.current += 1;
      const seq = seqRef.current;
      const id = "n" + seq + "-" + Date.now().toString(36);
      const shape: Shape = opts.shape || "box";
      m.nodes[id] = {
        id,
        ref: opts.ref || "N" + seq,
        shape,
        x: opts.x,
        y: opts.y,
        name: opts.name || "",
        sec: "",
        color: null,
        state: "UNTOUCHED",
        origin: "user",
        subs: [],
        todos: [],
        blockers: [],
        screens: [],
        drops: [],
      };
      m.order.push(id);
      if (opts.wireTo && m.nodes[opts.wireTo]) {
        m.links.push({ a: opts.wireTo, b: id, fromPromote: true });
      }
      bump();
      saveNow();
      return id;
    },
    [bump, saveNow]
  );

  /* ---------------- removal · recoverable for twelve seconds ---------------- */
  const removeNode = useCallback(
    (id: string, quiet: boolean) => {
      const m = modelRef.current;
      const d = m.nodes[id];
      if (!d) return;
      trashRef.current = {
        node: d,
        links: linksOf(m.links, id).slice(),
        index: m.order.indexOf(id),
        at: Date.now(),
      };
      m.links = m.links.filter((l) => l.a !== id && l.b !== id);
      m.order = m.order.filter((o) => o !== id);
      delete m.nodes[id];
      bump();
      saveNow();
      setUndone({ ref: d.ref, quiet });
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndone(null), 12000);
    },
    [bump, saveNow]
  );

  const undo = useCallback(() => {
    const t = trashRef.current;
    if (!t) return;
    const m = modelRef.current;
    m.nodes[t.node.id] = t.node;
    m.order.splice(Math.min(t.index, m.order.length), 0, t.node.id);
    t.links.forEach((l) => m.links.push(l));
    trashRef.current = null;
    bump();
    saveNow();
    setUndone(null);
  }, [bump, saveNow]);

  /* Pressed on purpose, never automatic. Now that the arrangement is served rather than
     stored locally, there is no local copy left to clear — reloading re-reads the real
     one, which discards this session's unsaved edits and nothing else. */
  const reset = useCallback(() => {
    window.location.reload();
  }, []);

  const isEmptyCb = useCallback(
    (id: string) => isEmpty(modelRef.current.nodes, modelRef.current.links, id),
    []
  );

  const value = useMemo<Brain>(
    () => ({
      model: modelRef.current,
      bump,
      version,
      saveNow,
      saveSoon,
      storeNote,
      savedFlash,
      addNode,
      removeNode,
      undo,
      undone,
      reset,
      isEmpty: isEmptyCb,
    }),
    [
      bump,
      version,
      saveNow,
      saveSoon,
      storeNote,
      savedFlash,
      addNode,
      removeNode,
      undo,
      undone,
      reset,
      isEmptyCb,
    ]
  );

  return <BrainCtx.Provider value={value}>{children}</BrainCtx.Provider>;
}

/** What RESET says it will discard, before it does it. */
export function resetTally(model: Model): { placed: number; items: number } {
  return {
    placed: model.order.length,
    items: model.order.reduce(
      (a, id) => a + counts(model.nodes[id]).reduce((x, y) => x + y, 0),
      0
    ),
  };
}
