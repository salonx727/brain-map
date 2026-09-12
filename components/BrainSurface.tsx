"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrainProvider, useBrain } from "@/lib/brain";
import { IntakeProvider } from "@/lib/intake";
import { upsertLayoutPositionAction } from "@/app/actions/pm";
import { SIZE } from "@/lib/seed";
import { balanceLayout, collides, linksOf, otherEnd, realignGrid } from "@/lib/graph";
import type { Model } from "@/lib/types";
import type { ReconcileCandidate } from "@/lib/pm/rulingReader";
import ControlPanel from "./ControlPanel";
import Field3D from "./Field3D";
import NodeCard from "./NodeCard";
import ReconcileTray from "./ReconcileTray";
import Roster, { type RosterMode } from "./Roster";

export default function BrainSurface({
  initialModel,
  layoutId = null,
  reconcile = [],
}: {
  initialModel: Model;
  layoutId?: string | null;
  /** Canonical arrivals that look like a pending ruling's card — suggestions only, resolved by a tap. */
  reconcile?: ReconcileCandidate[];
}) {
  /* The arrangement now arrives from the server already resolved (app/page.tsx ->
     lib/adapter.ts), so there is no stored layout to wait for. The mount gate stays
     because the canvas measures the window on first paint. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <BrainProvider initialModel={initialModel} layoutId={layoutId}>
      <Surface reconcile={reconcile} />
    </BrainProvider>
  );
}

function Surface({ reconcile }: { reconcile: ReconcileCandidate[] }) {
  const brain = useBrain();
  const { model, bump, persist, storeNote, savedFlash, layoutId, addFiles } = brain;

  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterMode | null>(null);

  const [locked, setLocked] = useState(false);
  const [moved, setMoved] = useState(0);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const committed = useRef<Record<string, { x: number; y: number }> | null>(null);

  const [wireMode, setWireMode] = useState(false);
  const [wireFocus, setWireFocus] = useState<string | null>(null);
  const [focus3, setFocus3] = useState<string | null>(null);
  const [readoutHidden, setReadoutHidden] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);

  const [screenMenuOpen, setScreenMenuOpen] = useState(false);
  /* Captured once, from the server-resolved arrangement this page loaded with — "the
     layout before anything was moved" (Shawn, 2026-09-12), not a fixed default. A second
     RESET later this same session still goes back to page-load, not to whatever the
     first RESET produced. */
  const originalPositions = useRef<Record<string, { x: number; y: number }> | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const zoomRef = useRef<HTMLInputElement>(null);

  /* the view is written straight to the DOM: a pan must not cost a render */
  const view = useRef({ x: 90, y: 70, k: 1 });
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<null | { d: number; k: number }>(null);
  const gesture = useRef<
    | null
    | { kind: "pan"; x: number; y: number; vx: number; vy: number; live: boolean }
    | { kind: "node"; id: string; x: number; y: number; nx: number; ny: number; live: boolean }
  >(null);
  const suppress = useRef(false);
  const lastWasDrag = useRef(false);

  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const wireModeRef = useRef(wireMode);
  wireModeRef.current = wireMode;

  /* ---------------- explore ---------------- */

  const clampK = (k: number) => Math.min(2.5, Math.max(0.25, k));

  const apply = useCallback(() => {
    const plane = planeRef.current;
    if (!plane) return;
    const v = view.current;
    /* the name holds a readable screen size; detail fades rather than shrinking */
    const far = v.k < 0.55;
    plane.classList.toggle("far", far);
    if (far) {
      const px = Math.min(14 / v.k, 62);
      plane.style.setProperty("--farname", px.toFixed(1) + "px");
    }
    plane.style.transform =
      "translate(" + Math.round(v.x) + "px," + Math.round(v.y) + "px) scale(" + v.k + ")";
    if (pctRef.current) pctRef.current.textContent = Math.round(v.k * 100) + "%";
    if (zoomRef.current) zoomRef.current.value = String(v.k);
  }, []);

  const nodeBounds = useCallback(() => {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    model.order.forEach((id) => {
      const d = model.nodes[id];
      if (!d) return;
      const s = SIZE[d.shape];
      /* pad both flanks for the chip rails and the WIRE chip beneath */
      x1 = Math.min(x1, d.x - 24);
      y1 = Math.min(y1, d.y);
      x2 = Math.max(x2, d.x + s[0] + 24);
      y2 = Math.max(y2, d.y + s[1] + 12);
    });
    return { x1, y1, x2, y2 };
  }, [model]);

  /**
   * Centred under whatever the current arrangement's node bounds are, sitting just below
   * the lowest card — never a fixed model-space point. Shawn, 2026-09-12: after REALIGN
   * reflowed the board, the door's old hardcoded {left:-112, top:1390} no longer landed
   * anywhere near "under everything," because it was never connected to the arrangement
   * to begin with.
   */
  const doorRect = useCallback(
    (nb: { x1: number; x2: number; y2: number }) => {
      const w = 196;
      const h = 84;
      const gap = 40;
      const left = (nb.x1 + nb.x2) / 2 - w / 2;
      const top = nb.y2 + gap;
      return { left, top, x1: left, x2: left + w, y2: top + h };
    },
    [],
  );

  const bounds = useCallback(() => {
    const nb = nodeBounds();
    const door = doorRect(nb);
    return {
      x1: Math.min(nb.x1, door.x1),
      y1: nb.y1,
      x2: Math.max(nb.x2, door.x2),
      y2: door.y2,
    };
  }, [nodeBounds, doorRect]);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const b = bounds();
    const w = b.x2 - b.x1;
    const h = b.y2 - b.y1;
    // FIT is "shrink to see everything," never "blow small boards up to fill the
    // screen" — Shawn, 2026-09-12, after decluttering left few enough cards that this
    // computed k approached clampK's 2.5 ceiling and every card rendered oversized.
    // clampK's ceiling stays 2.5 for a deliberate pinch/wheel zoom-in; this is FIT's own,
    // lower one.
    const k = Math.min(1, clampK(Math.min((vp.clientWidth - 100) / w, (vp.clientHeight - 170) / h)));
    // Vertical balance is against the space above #bar, not the full viewport — Shawn,
    // 2026-09-12: "everything designed above the toolbar vertical balance." #bar sits
    // 22px off the bottom edge and is itself roughly 46px tall; centering against the
    // full height instead would read as "pushed down," not balanced, once the toolbar's
    // own footprint is accounted for.
    const TOOLBAR_SPACE = 90;
    view.current = {
      k,
      x: (vp.clientWidth - w * k) / 2 - b.x1 * k,
      y: Math.max(46, (vp.clientHeight - TOOLBAR_SPACE - h * k) / 2 - b.y1 * k - 16),
    };
    apply();
  }, [apply, bounds]);

  const zoomAt = useCallback(
    (cx: number, cy: number, k: number) => {
      const nk = clampK(k);
      const v = view.current;
      const r = nk / v.k;
      view.current = { k: nk, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
      apply();
    },
    [apply]
  );

  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  /* the wheel needs a non-passive listener to hold the page still */
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        zoomAt(e.clientX, e.clientY, view.current.k * (1 - e.deltaY * 0.01));
      } else {
        view.current.x -= e.deltaX;
        view.current.y -= e.deltaY;
        apply();
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [apply, zoomAt]);

  /* ---------------- control surface ---------------- */

  const control = useCallback((id: string, t: number | null) => {
    setOpenId(id);
    setTab(t);
  }, []);

  /* Closing a card saves nothing, because every edit inside it already wrote itself. */
  const dismiss = useCallback(() => {
    setOpenId(null);
    setTab(null);
  }, []);

  /* ---------------- lock ---------------- */

  const snapshot = useCallback(() => {
    const out: Record<string, { x: number; y: number }> = {};
    model.order.forEach((id) => {
      out[id] = { x: model.nodes[id].x, y: model.nodes[id].y };
    });
    return out;
  }, [model]);

  useEffect(() => {
    if (!originalPositions.current) originalPositions.current = snapshot();
  }, [snapshot]);

  /**
   * Applies a computed x/y map to the live model and writes each changed position
   * through the same action a drag does — SCREEN's three options are "arrange," not a
   * separate save path.
   */
  const applyPositions = useCallback(
    (next: Record<string, { x: number; y: number }>) => {
      for (const id of model.order) {
        const p = next[id];
        const n = model.nodes[id];
        if (!p || !n || (n.x === p.x && n.y === p.y)) continue;
        n.x = p.x;
        n.y = p.y;
        if (layoutId) persist(() => upsertLayoutPositionAction({ layoutId, nodeKey: id, x: p.x, y: p.y }));
      }
      bump();
      window.requestAnimationFrame(fit);
    },
    [model, layoutId, persist, bump],
  );

  const doReset = useCallback(() => {
    setScreenMenuOpen(false);
    if (originalPositions.current) applyPositions(originalPositions.current);
  }, [applyPositions]);

  const doBalance = useCallback(() => {
    setScreenMenuOpen(false);
    applyPositions(balanceLayout(model.nodes, model.order));
  }, [applyPositions, model]);

  const doRealign = useCallback(() => {
    setScreenMenuOpen(false);
    applyPositions(realignGrid(model.order));
  }, [applyPositions, model]);

  const lockGuard = useRef(0);
  const toggleLock = useCallback(() => {
    const now = Date.now();
    if (now - lockGuard.current < 400) return;
    lockGuard.current = now;
    setLocked((was) => {
      if (!was) {
        committed.current = snapshot();
        setMoved(0);
      }
      return !was;
    });
  }, [snapshot]);

  /* ---------------- wire ---------------- */

  const toggleWire = useCallback(() => {
    setWireMode((was) => !was);
    setWireFocus(null);
    setFocus3(null);
    setReadoutHidden(false);
  }, []);

  const exitWire = useCallback(() => {
    setWireMode(false);
    setWireFocus(null);
    setFocus3(null);
  }, []);

  /** Take a card straight into the field, focused. */
  const showWire = useCallback(
    (id: string) => {
      dismiss();
      setWireMode(true);
      setWireFocus(id);
      setFocus3(id);
      setReadoutHidden(false);
    },
    [dismiss]
  );

  useEffect(() => {
    document.body.classList.toggle("wire3d", wireMode);
    return () => document.body.classList.remove("wire3d");
  }, [wireMode]);

  /* Escape puts away whatever is open. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dismiss();
      setRoster(null);
      exitWire();
      setScreenMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss, exitWire]);

  /* ---------------- field gestures ---------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      gesture.current = null;
      const v = Array.from(pointers.current.values());
      pinch.current = {
        d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1,
        k: view.current.k,
      };
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("#panel, #bar, #roster, .ctl, .corner, .door")) return;
    const nodeEl = lockedRef.current ? null : target.closest(".node");
    if (nodeEl) {
      const id = (nodeEl as HTMLElement).dataset.id;
      if (!id || !model.nodes[id]) return;
      gesture.current = {
        kind: "node",
        id,
        x: e.clientX,
        y: e.clientY,
        nx: model.nodes[id].x,
        ny: model.nodes[id].y,
        live: false,
      };
    } else {
      gesture.current = {
        kind: "pan",
        x: e.clientX,
        y: e.clientY,
        vx: view.current.x,
        vy: view.current.y,
        live: false,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pointers.current.size === 2 && pinch.current) {
      const v = Array.from(pointers.current.values());
      const dd = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1;
      zoomAt(
        (v[0].x + v[1].x) / 2,
        (v[0].y + v[1].y) / 2,
        pinch.current.k * (dd / pinch.current.d)
      );
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.live) {
      if (Math.hypot(dx, dy) < 5) return;
      g.live = true;
      suppress.current = true;
      if (g.kind === "pan") viewportRef.current?.classList.add("exploring");
      else setMoved((m) => m + 1);
    }
    if (g.kind === "pan") {
      view.current.x = g.vx + dx;
      view.current.y = g.vy + dy;
      apply();
    } else {
      const n = model.nodes[g.id];
      if (!n) return;
      n.x = Math.round(g.nx + dx / view.current.k);
      n.y = Math.round(g.ny + dy / view.current.k);
      /* the card follows the finger without a render; React catches up on lift */
      const el = document.getElementById("n-" + g.id);
      if (el) {
        el.style.left = n.x + "px";
        el.style.top = n.y + "px";
      }
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    lastWasDrag.current = !!(g && g.live);
    if (g && g.kind === "node" && g.live) {
      bump();
      // Written once the finger lifts, never per frame. upsertLayoutPositionAction
      // deliberately skips revalidatePath for the same reason — a drag is the most
      // frequent write on this surface by a wide margin.
      const moved = model.nodes[g.id];
      if (moved && layoutId) {
        // Position only. The stored colour is a token string and this card's `color` is a
        // palette index — sending one as the other would overwrite a real colour with a
        // number on every drag. Colour has its own control and its own write.
        persist(() => upsertLayoutPositionAction({ layoutId, nodeKey: moved.id, x: moved.x, y: moved.y }));
      }
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    viewportRef.current?.classList.remove("exploring");
    gesture.current = null;
    window.setTimeout(() => {
      suppress.current = false;
    }, 60);
  };

  /* Double-tap the field: commit every position, or release them again.
     Works for mouse (dblclick) and touch (paired taps). */
  const lastTap = useRef(0);
  const lastTapX = useRef(0);
  const lastTapY = useRef(0);
  const fieldChrome = ".node, #bar, #panel, #lockstate, #roster, .door";

  const onFieldPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    endPointer(e);
    const target = e.target as HTMLElement;
    if (target.closest(fieldChrome)) return;
    if (lastWasDrag.current) {
      lastTap.current = 0;
      return;
    }
    const now = Date.now();
    if (
      now - lastTap.current < 320 &&
      Math.abs(e.clientX - lastTapX.current) < 24 &&
      Math.abs(e.clientY - lastTapY.current) < 24
    ) {
      lastTap.current = 0;
      toggleLock();
    } else {
      lastTap.current = now;
      lastTapX.current = e.clientX;
      lastTapY.current = e.clientY;
    }
  };

  /* ---------------- chrome text ---------------- */

  let lockHint: string;
  if (copyNote) lockHint = copyNote;
  else if (storeNote) lockHint = storeNote;
  else if (locked) lockHint = "DOUBLE-TAP FIELD TO UNLOCK";
  else if (moved) lockHint = moved + " MOVED · DOUBLE-TAP FIELD TO LOCK";
  else lockHint = "DOUBLE-TAP FIELD TO LOCK";

  const copyLayout = () => {
    const src = committed.current || snapshot();
    const rows = model.order
      .map((id) => {
        const d = model.nodes[id];
        return (
          '    ["' +
          d.ref +
          '", "' +
          d.shape +
          '", ' +
          src[id].x +
          ", " +
          src[id].y +
          (d.color === null || d.color === undefined ? "" : ", " + d.color) +
          "]"
        );
      })
      .join(",\n");
    const wireRows = model.links
      .map((l) => '    ["' + model.nodes[l.a].ref + '", "' + model.nodes[l.b].ref + '"]')
      .join(",\n");
    const text =
      "var SEED = [\n" + rows + "\n  ];\n\n" + "var WIRES = [\n" + wireRows + "\n  ];";

    const done = (ok: boolean) => {
      setCopyNote(ok ? "LAYOUT COPIED" : "COPY UNAVAILABLE");
      window.setTimeout(() => setCopyNote(null), 1600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => done(true),
        () => done(false)
      );
      return;
    }
    /* no clipboard API (http origin, older browser) — copy via a scratch field */
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    done(ok);
  };

  const readoutFocus = focus3 || wireFocus;
  const wireOpen = wireMode && (!readoutHidden || !!readoutFocus);

  const openNode = openId ? model.nodes[openId] ?? null : null;
  const doorPos = doorRect(nodeBounds());

  return (
    <IntakeProvider openId={openId} onUnrouted={() => setRoster({ kind: "hub", tab: 0 })}>
      <div id="declare">
        SALON X · BRAIN WORK SURFACE · DARK-ONLY PROTOTYPE (§38.10)
      </div>

      <div id="savedtag" className={savedFlash ? "on" : ""}>
        SAVED
      </div>

      <div id="lockstate" className={locked ? "locked" : ""}>
        <span className="state">{locked ? "LOCKED" : "UNLOCKED"}</span>
        <span className="hint">{lockHint}</span>
        <button className="act" onClick={copyLayout}>
          COPY LAYOUT
        </button>
      </div>

      {/* A notice, not an offer. Removing a card deletes its items, notes and files —
          including the bytes in Storage — so there is nothing left here to hand back, and
          a button saying UNDO would be the one thing this surface must never do: claim a
          write it cannot make. The two-tap confirm on the card is where removal is caught. */}
      <div id="undo" className={brain.removed ? "open" : ""}>
        <span>
          {brain.removed ? (
            <>
              <b>{brain.removed.ref}</b>
              {" REMOVED" + (brain.removed.quiet ? " · IT WAS EMPTY" : "")}
            </>
          ) : null}
        </span>
      </div>

      <ReconcileTray candidates={reconcile} />

      <div id="wireout" className={wireOpen ? "open" : ""}>
        <span
          className="msg"
          /* touching the readout puts it away; focusing a node brings it back */
          onClick={() => setReadoutHidden(true)}
        >
          {readoutFocus && model.nodes[readoutFocus] ? (
            <>
              <b>{model.nodes[readoutFocus].ref}</b>
              {" · " + linksOf(model.links, readoutFocus).length + " WIRES"}
            </>
          ) : (
            <>
              <b>{model.links.length + " EDGES"}</b>
              {" · DRAG · TWIST · PINCH"}
            </>
          )}
        </span>
        <button
          className="act"
          onClick={() => {
            setResetNonce((n) => n + 1);
            setFocus3(null);
            setReadoutHidden(false);
          }}
        >
          RESET VIEW
        </button>
        <button className="act" onClick={exitWire}>
          EXIT
        </button>
      </div>

      <Field3D
        open={wireMode}
        focus={focus3}
        setFocus={(id) => {
          setFocus3(id);
          if (id) setReadoutHidden(false);
        }}
        resetNonce={resetNonce}
      />

      <div
        id="viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onFieldPointerUp}
        onPointerCancel={endPointer}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest(fieldChrome)) return;
          toggleLock();
        }}
      >
        <div id="plane" ref={planeRef}>
          {model.order.map((id) => {
            const d = model.nodes[id];
            if (!d) return null;
            const unwired =
              wireMode && wireFocus
                ? id !== wireFocus &&
                  !linksOf(model.links, wireFocus).some(
                    (l) => otherEnd(l, wireFocus) === id
                  )
                : false;
            return (
              <NodeCard
                key={id}
                d={d}
                removable={brain.isEmpty(id)}
                discovered={openId === id}
                unwired={unwired}
                wirefocus={wireFocus === id}
                suppressRef={suppress}
                onOpen={() => {
                  if (wireModeRef.current) {
                    setWireFocus((f) => (f === id ? null : id));
                    setReadoutHidden(false);
                    return;
                  }
                  /* a tap opens the card. no second gesture to learn */
                  control(id, null);
                }}
                onControl={(t) => control(id, t)}
                onState={() => setRoster({ kind: "state", id })}
                onRemove={() => brain.removeNode(id, true)}
                onDrop={(dropped) => {
                  addFiles(id, dropped);
                  control(id, 3);
                }}
              />
            );
          })}

          {/* CODEMAN and SHAWN used to be drawn here as two counters with their numbers
              typed into seed.ts. They are real cards now, rendered by the loop above with
              every other node and carrying the work COYOTE names but attaches to no
              engine — so the numbers on them are counted, not written down. */}

          {/* one door. AI and intake live behind it. */}
          <div
            className="door"
            style={{ left: doorPos.left, top: doorPos.top }}
            onClick={(e) => {
              e.stopPropagation();
              if (!suppress.current) setRoster({ kind: "hub", tab: 0 });
            }}
          >
            <svg width="196" height="84" viewBox="0 0 196 84">
              <g fill="none" stroke="#FF8A14">
                <rect x="46" y="14" width="104" height="42" rx="21" opacity="0.22" />
                <rect x="62" y="22" width="72" height="26" rx="13" opacity="0.48" />
              </g>
              <rect x="78" y="29" width="40" height="12" rx="6" fill="#FF8A14" />
              <g stroke="#FF8A14" strokeWidth="2" fill="none" strokeLinecap="round">
                <path d="M 22 28 l 9 7 l -9 7" opacity="0.9" />
                <path d="M 36 28 l 9 7 l -9 7" opacity="0.45" />
                <path d="M 174 28 l -9 7 l 9 7" opacity="0.9" />
                <path d="M 160 28 l -9 7 l 9 7" opacity="0.45" />
              </g>
              <text
                x="98"
                y="78"
                textAnchor="middle"
                fill="#FF8A14"
                fontFamily="var(--font-space-mono), monospace"
                fontSize="11"
                letterSpacing="2.4"
              >
                INTAKE · AI
              </text>
            </svg>
          </div>
        </div>
      </div>

      <div id="bar">
        <button
          className="stepper"
          aria-label="Zoom out"
          onClick={() => {
            const vp = viewportRef.current;
            if (vp) zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, view.current.k / 1.2);
          }}
        >
          −
        </button>
        <input
          type="range"
          ref={zoomRef}
          min="0.25"
          max="2.5"
          step="0.01"
          defaultValue="1"
          aria-label="Zoom"
          onInput={(e) => {
            const vp = viewportRef.current;
            if (vp) {
              zoomAt(
                vp.clientWidth / 2,
                vp.clientHeight / 2,
                parseFloat((e.target as HTMLInputElement).value)
              );
            }
          }}
        />
        <button
          className="stepper"
          aria-label="Zoom in"
          onClick={() => {
            const vp = viewportRef.current;
            if (vp) zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, view.current.k * 1.2);
          }}
        >
          +
        </button>
        <span className="pct" ref={pctRef}>
          100%
        </span>
        <button className="act" onClick={fit}>
          FIT
        </button>
        <span className="sep" />
        <button className={"act" + (wireMode ? " armed" : "")} onClick={toggleWire}>
          WIRE
        </button>
        <span className="sep" />
        <div style={{ position: "relative" }}>
          {screenMenuOpen ? (
            <div className="screen-menu">
              <button className="act" onClick={doReset}>
                RESET · BACK TO HOW THIS LOADED
              </button>
              <button className="act" onClick={doBalance}>
                BALANCE · TIDY WHERE THEY ARE
              </button>
              <button className="act" onClick={doRealign}>
                REALIGN · CLEAN GRID
              </button>
            </div>
          ) : null}
          <button className={"act" + (screenMenuOpen ? " armed" : "")} onClick={() => setScreenMenuOpen((was) => !was)}>
            SCREEN
          </button>
        </div>
        <button
          className="act"
          onClick={() => {
            const vp = viewportRef.current;
            if (!vp) return;
            const v = view.current;
            const x = Math.round((vp.clientWidth / 2 - v.x) / v.k) - 95;
            let y = Math.round((vp.clientHeight / 2 - v.y) / v.k) - 58;
            while (collides(model.nodes, model.order, x, y, "box")) y += 172;
            void brain.addNode({ x, y }).then((id) => {
              if (id) control(id, null);
            });
          }}
        >
          ADD CARD
        </button>
      </div>

      {roster ? (
        <Roster
          mode={roster}
          onClose={() => setRoster(null)}
          onHubTab={(t) => setRoster({ kind: "hub", tab: t })}
        />
      ) : null}

      <div
        id="scrim"
        className={openNode ? "open" : ""}
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
      >
        {openNode ? (
          <ControlPanel
            d={openNode}
            tab={tab}
            setTab={setTab}
            onDismiss={dismiss}
            onOpenCard={control}
            onShowOnField={showWire}
          />
        ) : null}
      </div>
    </IntakeProvider>
  );
}
