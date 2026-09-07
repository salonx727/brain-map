"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { WIRES, buildSeedNodes, seedSample } from "./seed";
import { counts, isEmpty, linksOf } from "./graph";
import { clearStore, loadMap, saveMap } from "./store";
import type { BrainNode, Drop, Link, Nodes, Shape } from "./types";

export type Model = {
  nodes: Nodes;
  order: string[];
  links: Link[];
  /** unrouted is a state, not an error */
  unrouted: Drop[];
};

type Trash = {
  node: BrainNode;
  links: Link[];
  index: number;
  at: number;
};

function initModel(): { model: Model; note: string; sampleLoaded: boolean } {
  const { nodes, order, byRef } = buildSeedNodes();
  const links: Link[] = [];
  WIRES.forEach((w) => {
    const a = byRef[w[0]];
    const b = byRef[w[1]];
    if (a && b) links.push({ a, b, why: w[2], back: !!w[3] });
  });

  const model: Model = { nodes, order, links, unrouted: [] };
  const res = loadMap(nodes, order);
  if (res.ok) {
    model.nodes = res.nodes;
    model.order = res.order;
    if (res.links) model.links = res.links;
    if (res.unrouted) model.unrouted = res.unrouted;
    return { model, note: "", sampleLoaded: false };
  }
  /* Nothing usable was read. Positions are untouched seed positions — that is
     placement, not reset. Sample content fills the cards so the surface is
     legible on a first visit; RESET clears it. */
  seedSample(nodes);
  return { model, note: res.note, sampleLoaded: true };
}

export type Brain = {
  model: Model;
  /** re-read the model after a mutation */
  bump: () => void;
  version: number;

  saveNow: () => void;
  saveSoon: () => void;
  storeNote: string;
  sampleLoaded: boolean;
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

export function BrainProvider({ children }: { children: React.ReactNode }) {
  const boot = useRef<{ model: Model; note: string; sampleLoaded: boolean } | null>(null);
  if (!boot.current) boot.current = initModel();

  const modelRef = useRef<Model>(boot.current.model);
  const seqRef = useRef<number>(boot.current.model.order.length);
  const storeOK = useRef<boolean>(true);

  const [version, setVersion] = useState(0);
  const [storeNote, setStoreNote] = useState(boot.current.note);
  const [sampleLoaded] = useState(boot.current.sampleLoaded);
  const [savedFlash, setSavedFlash] = useState(false);
  const [undone, setUndone] = useState<{ ref: string; quiet: boolean } | null>(null);

  const trashRef = useRef<Trash | null>(null);
  const saveTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  const undoTimer = useRef<number | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const saveNow = useCallback(() => {
    if (!storeOK.current) return;
    const m = modelRef.current;
    const res = saveMap(m.nodes, m.order, m.links, m.unrouted);
    if (!res.storeOK) {
      storeOK.current = false;
      setStoreNote(res.note);
      return;
    }
    setSavedFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1400);
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

  /* Pressed on purpose, never automatic. */
  const reset = useCallback(() => {
    clearStore();
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
      sampleLoaded,
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
      sampleLoaded,
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
