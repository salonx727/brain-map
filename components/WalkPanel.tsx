"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  createTouchPointAction,
  deleteTouchPointAction,
  getWalkForNodeAction,
  hideScreenAction,
  startWalkForNodeAction,
  updateTouchPointAction,
  type WalkGraphWithUrls,
} from "@/app/actions/walk";
import { useBrain } from "@/lib/brain";
import { flowsForNode, laneSequence, lanes, mainPath, orphanScreens, validateFlow } from "@/lib/walk/derive";
import { WALK_FLAG_LABELS, type WalkFlag, type WalkLane } from "@/lib/walk/types";
import WalkTray from "./WalkTray";

type View = "images" | "chart";

export type WalkLanding = { flowId: string; screenId: string };

/**
 * WALK — the step-through UX viewer, spec v1.7. Function, not design (Founder ruling
 * 2026-09-16). Layout follows reference/WALK_viewer_reference.html so the fixture reads
 * the same as the mockup Shawn signed off; the rulings in spec §1 stay binding.
 * Mounted inside the existing UI tab (ControlPanel.tsx, tab === 0), never a route or a
 * pop-up of its own — BUILD_PROMPT.md hard constraint 1 and 6.
 */
export default function WalkPanel({
  nodeId,
  landing,
  onLandingConsumed,
  onOpenNode,
}: {
  nodeId: string;
  landing?: WalkLanding | null;
  onLandingConsumed?: () => void;
  onOpenNode: (nodeId: string, landing?: WalkLanding) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; graph: WalkGraphWithUrls }
  >({ status: "loading" });

  const load = useCallback(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    getWalkForNodeAction(nodeId)
      .then((graph) => {
        if (!cancelled) setState({ status: "ready", graph });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  useEffect(() => load(), [load]);

  if (state.status === "loading") return <div className="none">Loading WALK…</div>;
  if (state.status === "error") return <div className="none">{state.message}</div>;
  return (
    <WalkViewer
      nodeId={nodeId}
      graph={state.graph}
      landing={landing}
      onLandingConsumed={onLandingConsumed}
      onOpenNode={onOpenNode}
      onChanged={load}
    />
  );
}

/**
 * Every node's own WALK, not just MUSE's — Shawn, 2026-09-17. A node with no walk_flow row
 * yet used to be a dead end ("no flows are mapped," full stop, no way to change that). This
 * creates an empty flow (no screens) so the tray has somewhere to attach the first upload —
 * createScreenAtEnd sets start_screen from whatever gets added first.
 */
function WalkStartPrompt({ nodeId, onChanged }: { nodeId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleStart() {
    setBusy(true);
    setError("");
    const result = await startWalkForNodeAction({ nodeId });
    if (result.ok) onChanged();
    else setError(result.message);
    setBusy(false);
  }

  return (
    <div className="walk-start">
      <div className="none">No flows are mapped for this node.</div>
      <button className="act armed" disabled={busy} onClick={handleStart}>
        + START WALK FOR THIS NODE
      </button>
      {error ? <div className="walk-tray-error">{error}</div> : null}
    </div>
  );
}

function WalkViewer({
  nodeId,
  graph,
  landing,
  onLandingConsumed,
  onOpenNode,
  onChanged,
}: {
  nodeId: string;
  graph: WalkGraphWithUrls;
  landing?: WalkLanding | null;
  onLandingConsumed?: () => void;
  onOpenNode: (nodeId: string, landing?: WalkLanding) => void;
  onChanged: () => void;
}) {
  const { model } = useBrain();
  const owned = useMemo(() => flowsForNode(graph, nodeId), [graph, nodeId]);
  const [flowId, setFlowId] = useState<string | null>(owned[0]?.id ?? null);
  const [laneIndex, setLaneIndex] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  /** A screen nothing points to yet (V6) has no place in any sequence — viewing one is a one-off override, not a position within main/lane navigation. Cleared by any other navigation. */
  const [orphanView, setOrphanView] = useState<string | null>(null);
  const [view, setView] = useState<View>("images");
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  /** Double-click the preview image to add or edit a touch point — Codeman, 2026-09-18.
      existingId null means "create new here"; a real id means "editing this one," and the
      click also repositions it to wherever was just double-clicked. */
  const [tpModal, setTpModal] = useState<{ screenId: string; existingId: string | null; x: number; y: number; action: string; toScreen: string } | null>(null);
  const [tpError, setTpError] = useState("");
  const [tpBusy, setTpBusy] = useState(false);

  useEffect(() => {
    if (landing?.flowId) {
      setFlowId(landing.flowId);
      setLaneIndex(null);
      setVisited(new Set());
      return;
    }
    setFlowId(owned[0]?.id ?? null);
    setLaneIndex(null);
    setPosition(0);
    setVisited(new Set());
  }, [nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only fires on the transition from "no flows yet" to "flows exist" — a node that had
  // zero walk_flow rows just got its first one (WalkStartPrompt), and flowId's own state
  // was set to null back when owned was still empty; it never re-derives on its own
  // because the effect above only re-runs on nodeId, not on every graph refresh (switching
  // flows by hand shouldn't get silently overridden just because a tray upload refetched).
  useEffect(() => {
    if (!flowId && owned.length > 0) setFlowId(owned[0].id);
  }, [owned, flowId]);

  const shownFlows = useMemo(() => {
    const extra = flowId && !owned.some((f) => f.id === flowId) ? graph.flows.find((f) => f.id === flowId) : undefined;
    return extra ? [...owned, extra] : owned;
  }, [owned, flowId, graph.flows]);

  const flowLanes = useMemo<WalkLane[]>(() => (flowId ? lanes(graph, flowId) : []), [graph, flowId]);
  const main = useMemo(() => (flowId ? mainPath(graph, flowId) : []), [graph, flowId]);
  /** Screens nothing points to yet — appended at the end of the strip, per spec, until a touch point reaches them (V6 "not linked"). */
  const orphans = useMemo(() => (flowId ? orphanScreens(graph, flowId) : []), [graph, flowId]);
  const flags = useMemo<WalkFlag[]>(() => (flowId ? validateFlow(graph, flowId) : []), [graph, flowId]);
  const flagsByScreen = useMemo(() => {
    const touchPointScreen = new Map(graph.touchPoints.map((t) => [t.id, t.screenId]));
    const m = new Map<string, WalkFlag[]>();
    for (const f of flags) {
      const screenId = graph.screens.some((s) => s.id === f.target) ? f.target : touchPointScreen.get(f.target);
      if (!screenId) continue;
      if (!m.has(screenId)) m.set(screenId, []);
      m.get(screenId)!.push(f);
    }
    return m;
  }, [flags, graph]);

  const sequence = useMemo(() => {
    if (!flowId) return [];
    if (laneIndex === null) return main;
    const lane = flowLanes[laneIndex];
    return lane ? laneSequence(graph, flowId, lane) : main;
  }, [graph, flowId, laneIndex, flowLanes, main]);

  useEffect(() => {
    if (!landing?.screenId) return;
    const seq = landing.flowId ? mainPath(graph, landing.flowId) : sequence;
    const idx = seq.indexOf(landing.screenId);
    setPosition(idx >= 0 ? idx : 0);
    onLandingConsumed?.();
  }, [landing?.flowId, landing?.screenId]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentScreenId = orphanView ?? sequence[position];
  const currentScreen = graph.screens.find((s) => s.id === currentScreenId);

  useEffect(() => {
    if (!currentScreenId) return;
    setVisited((prev) => (prev.has(currentScreenId) ? prev : new Set(prev).add(currentScreenId)));
  }, [currentScreenId]);

  const goToFlowScreen = useCallback(
    (targetFlowId: string, screenId: string) => {
      setFlowId(targetFlowId);
      setLaneIndex(null);
      setOrphanView(null);
      const seq = mainPath(graph, targetFlowId);
      const idx = seq.indexOf(screenId);
      setPosition(idx >= 0 ? idx : 0);
    },
    [graph],
  );

  const handleRemoveOrphan = useCallback(
    async (screenId: string) => {
      if (orphanView === screenId) setOrphanView(null);
      const result = await hideScreenAction({ nodeId, screenId });
      if (result.ok) {
        onChanged();
      } else {
        setFlash(result.message);
      }
    },
    [nodeId, onChanged, orphanView],
  );

  const handleExit = useCallback(
    (exit: { node: string; flow: string; screen: string }) => {
      if (exit.node !== nodeId && model.nodes[exit.node]) {
        onOpenNode(exit.node, { flowId: exit.flow, screenId: exit.screen });
        return;
      }
      setFlash(`Exit: opens the ${graph.flows.find((f) => f.id === exit.flow)?.title ?? exit.flow} flow strip`);
      goToFlowScreen(exit.flow, exit.screen);
    },
    [nodeId, model.nodes, onOpenNode, graph.flows, goToFlowScreen],
  );

  /** Double-click near an existing touch point edits (and repositions) it; anywhere else starts a new one at that exact spot. "Near" is a small percentage radius, not pixel-exact — a phone finger is wider than a mouse pointer. */
  const handleImageDoubleClick = useCallback(
    (screenId: string, x: number, y: number) => {
      setTpError("");
      const onScreen = graph.touchPoints.filter((t) => t.screenId === screenId);
      const nearby = onScreen.find((t) => Math.abs(t.x - x) <= 5 && Math.abs(t.y - y) <= 5);
      if (nearby) {
        setTpModal({ screenId, existingId: nearby.id, x, y, action: nearby.action, toScreen: nearby.toScreen });
      } else {
        setTpModal({ screenId, existingId: null, x, y, action: "", toScreen: "" });
      }
    },
    [graph.touchPoints],
  );

  const handleSaveTouchPoint = useCallback(async () => {
    if (!tpModal) return;
    if (!tpModal.action.trim() || !tpModal.toScreen) {
      setTpError("A label and a destination screen are both required.");
      return;
    }
    setTpBusy(true);
    setTpError("");
    const result = tpModal.existingId
      ? await updateTouchPointAction({ touchPointId: tpModal.existingId, x: tpModal.x, y: tpModal.y, action: tpModal.action.trim(), toScreen: tpModal.toScreen })
      : await createTouchPointAction({ screenId: tpModal.screenId, x: tpModal.x, y: tpModal.y, action: tpModal.action.trim(), toScreen: tpModal.toScreen });
    setTpBusy(false);
    if (result.ok) {
      onChanged();
      setTpModal(null);
    } else {
      setTpError(result.message);
    }
  }, [tpModal, onChanged]);

  const handleDeleteTouchPoint = useCallback(
    async (touchPointId: string) => {
      setTpBusy(true);
      setTpError("");
      const result = await deleteTouchPointAction(touchPointId);
      setTpBusy(false);
      if (result.ok) {
        onChanged();
        setTpModal(null);
      } else {
        setTpError(result.message);
      }
    },
    [onChanged],
  );

  /** Hold-then-drag finished — Codeman, 2026-09-18: a touch point is never static once
      armed, so this is the plain position update a drag ends with, no popup involved. */
  const handleTouchPointReposition = useCallback(
    async (touchPointId: string, x: number, y: number) => {
      const result = await updateTouchPointAction({ touchPointId, x, y });
      if (result.ok) onChanged();
      else setFlash(result.message);
    },
    [onChanged],
  );

  const navigateTo = useCallback(
    (screenId: string) => {
      setFlash("");
      if (orphans.includes(screenId)) {
        setOrphanView(screenId);
        return;
      }
      setOrphanView(null);
      const inCurrent = sequence.indexOf(screenId);
      if (inCurrent >= 0) {
        setPosition(inCurrent);
        return;
      }
      for (let i = 0; i < flowLanes.length; i++) {
        const seq = flowId ? laneSequence(graph, flowId, flowLanes[i]) : [];
        const idx = seq.indexOf(screenId);
        if (idx >= 0) {
          setLaneIndex(i);
          setPosition(idx);
          return;
        }
      }
      const dest = graph.screens.find((s) => s.id === screenId);
      if (dest && dest.flowId !== flowId) {
        const destFlow = graph.flows.find((f) => f.id === dest.flowId);
        handleExit({ node: destFlow?.nodeId ?? "", flow: dest.flowId, screen: dest.id });
      }
    },
    [orphans, sequence, flowLanes, flowId, graph, handleExit],
  );

  const goDelta = useCallback(
    (delta: number) => {
      setFlash("");
      setOrphanView(null);
      setPosition((p) => Math.max(0, Math.min(sequence.length - 1, p + delta)));
    },
    [sequence.length],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") goDelta(-1);
      if (e.key === "ArrowRight") goDelta(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goDelta]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let touchStartX: number | null = null;
    function onTouchStart(e: TouchEvent) {
      touchStartX = e.touches[0]?.clientX ?? null;
    }
    function onTouchEnd(e: TouchEvent) {
      if (touchStartX === null) return;
      const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
      if (Math.abs(dx) > 40) goDelta(dx < 0 ? 1 : -1);
      touchStartX = null;
    }
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [goDelta]);

  if (owned.length === 0 && !flowId) {
    return <WalkStartPrompt nodeId={nodeId} onChanged={onChanged} />;
  }

  const touchPoints = currentScreen
    ? graph.touchPoints.filter((t) => t.screenId === currentScreen.id).sort((a, b) => a.n - b.n)
    : [];
  const currentVersionId = currentScreen?.currentVersion ?? null;
  const imageUrl = currentVersionId ? graph.signedUrls[currentVersionId] : null;
  const screenFlags = currentScreen ? (flagsByScreen.get(currentScreen.id) ?? []) : [];

  return (
    <div className="walk">
      <div className="walk-bar">
        {shownFlows.map((f) => (
          <button
            key={f.id}
            className={"walk-flowtab" + (f.id === flowId ? " on" : "")}
            onClick={() => {
              setFlowId(f.id);
              setLaneIndex(null);
              setPosition(0);
              setOrphanView(null);
              setFlash("");
            }}
          >
            {f.title}
          </button>
        ))}
        <span className="walk-crumb">
          {orphanView
            ? `${orphanView} · not linked`
            : currentScreenId
              ? `${currentScreenId} · ${position + 1} of ${sequence.length}`
              : ""}
          {!orphanView && laneIndex !== null ? " · branch lane" : ""}
        </span>
        <span className="walk-viewtoggle">
          <button className={"tg" + (view === "images" ? " act" : "")} onClick={() => setView("images")}>
            Images
          </button>
          <button className={"tg" + (view === "chart" ? " act" : "")} onClick={() => setView("chart")}>
            Chart
          </button>
        </span>
      </div>

      {view === "images" ? (
        <>
          <div className="walk-stage" ref={stageRef}>
            <button className="nav" aria-label="Previous" onClick={() => goDelta(-1)}>
              ‹
            </button>
            <div className="walk-phonewrap">
              <PhoneFrame
                screenId={currentScreenId}
                screenTitle={currentScreen?.title ?? currentScreenId ?? ""}
                imageUrl={imageUrl}
                touchPoints={touchPoints}
                onTouchPointClick={(toScreen) => {
                  const dest = graph.screens.find((s) => s.id === toScreen);
                  if (dest && dest.flowId !== flowId) {
                    const destFlow = graph.flows.find((f) => f.id === dest.flowId);
                    handleExit({ node: destFlow?.nodeId ?? "", flow: dest.flowId, screen: dest.id });
                    return;
                  }
                  navigateTo(toScreen);
                }}
                onImageDoubleClick={currentScreenId ? (x, y) => handleImageDoubleClick(currentScreenId, x, y) : undefined}
                onTouchPointReposition={handleTouchPointReposition}
              />
              <div className="walk-cap">
                {currentScreenId} — {currentScreen?.title ?? ""}
                {screenFlags.length ? (
                  <span className="walk-flags">
                    {screenFlags.map((f, i) => (
                      <span key={i} className="walk-flag" title={f.reason}>
                        {WALK_FLAG_LABELS[f.rule]}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            </div>
            <button className="nav" aria-label="Next" onClick={() => goDelta(1)}>
              ›
            </button>
          </div>
          <div className="walk-legend">
            {flash
              ? flash
              : touchPoints.length === 0
                ? "End of flow"
                : touchPoints
                    .map((tp) => {
                      const dest = graph.screens.find((s) => s.id === tp.toScreen);
                      const destFlow = dest ? graph.flows.find((f) => f.id === dest.flowId) : undefined;
                      const destLabel =
                        dest && dest.flowId !== flowId ? destFlow?.title ?? tp.toScreen : tp.toScreen;
                      return `T${tp.n} → ${destLabel}${tp.n === 1 ? " (main path)" : ""} · authored`;
                    })
                    .join("   ·   ")}
          </div>
          <WalkGrid
            main={main}
            orphans={orphans}
            lanesList={flowLanes}
            currentScreenId={currentScreenId}
            graph={graph}
            flagsByScreen={flagsByScreen}
            mode="images"
            visited={visited}
            onScreenClick={navigateTo}
            onExitClick={handleExit}
            onRemoveOrphan={handleRemoveOrphan}
            nodeId={nodeId}
          />
        </>
      ) : (
        <>
          <WalkGrid
            main={main}
            orphans={orphans}
            lanesList={flowLanes}
            currentScreenId={currentScreenId}
            graph={graph}
            flagsByScreen={flagsByScreen}
            mode="chart"
            visited={visited}
            onScreenClick={navigateTo}
            onExitClick={handleExit}
            nodeId={nodeId}
          />
          <div className="walk-legend walk-legend-nav">
            <button className="nav" aria-label="Previous" onClick={() => goDelta(-1)}>
              ‹
            </button>
            <button className="nav" aria-label="Next" onClick={() => goDelta(1)}>
              ›
            </button>
          </div>
        </>
      )}

      {flowId ? <WalkTray nodeId={nodeId} flowId={flowId} main={main} graph={graph} onChanged={onChanged} /> : null}

      {tpModal ? (
        <div
          className="screens-modal-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTpModal(null);
          }}
        >
          <div className="screens-modal-card">
            <div className="head">
              <div className="title">{tpModal.existingId ? "Edit touch point" : "Add touch point"}</div>
              <button className="dismiss" aria-label="Dismiss" onClick={() => setTpModal(null)}>
                <span />
              </button>
            </div>

            <label style={{ display: "block", marginTop: 10 }}>
              <span className="lab">LABEL</span>
              <input
                className="f"
                value={tpModal.action}
                placeholder="e.g. CONTROL X"
                onChange={(e) => setTpModal({ ...tpModal, action: e.target.value })}
              />
            </label>

            <div style={{ marginTop: 10 }}>
              <span className="lab">
                DESTINATION SCREEN{tpModal.toScreen ? ` · ${tpModal.toScreen}` : ""}
              </span>
              {/* Tap the actual screen, not a name in a list — Codeman, 2026-09-18: whichever
                  image you pick here becomes the destination, nothing to separately select. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {graph.screens
                  .filter((s) => s.flowId === flowId && s.id !== tpModal.screenId)
                  .map((s) => (
                    <div key={s.id} style={{ width: 72 }}>
                      <Thumb
                        id={s.id}
                        graph={graph}
                        flagsByScreen={flagsByScreen}
                        current={tpModal.toScreen === s.id}
                        onClick={() => setTpModal({ ...tpModal, toScreen: s.id })}
                      />
                    </div>
                  ))}
              </div>
            </div>

            {tpError ? (
              <div className="cap" style={{ color: "var(--baton)", marginTop: 10 }}>
                {tpError}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="act" disabled={tpBusy} onClick={() => setTpModal(null)}>
                Cancel
              </button>
              {tpModal.existingId ? (
                <button className="act" disabled={tpBusy} onClick={() => handleDeleteTouchPoint(tpModal.existingId as string)}>
                  Delete
                </button>
              ) : null}
              <button className="act armed" style={{ flex: 1 }} disabled={tpBusy} onClick={handleSaveTouchPoint}>
                {tpModal.existingId ? "Save" : "Add"}
              </button>
            </div>

            {(() => {
              const others = graph.touchPoints.filter((t) => t.screenId === tpModal.screenId && t.id !== tpModal.existingId);
              if (!others.length) return null;
              return (
                <>
                  <div className="cap" style={{ marginTop: 16, marginBottom: 8 }}>
                    OTHER TOUCH POINTS ON THIS SCREEN
                  </div>
                  {others.map((t) => (
                    <div className="item" key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <span>
                        T{t.n} · {t.action} → {t.toScreen}
                      </span>
                      <button className="minus" aria-label="Delete" disabled={tpBusy} onClick={() => handleDeleteTouchPoint(t.id)}>
                        <span />
                      </button>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Gray-bar widths from the reference mockup so MUSE's placeholder screens read the same. */
const PLACEHOLDER_BARS: Record<string, number[]> = {
  M1: [70, 90, 50],
  M2: [60, 90, 90, 90],
  M3: [80, 90, 60, 90],
  M4: [60, 90, 50, 90],
  M5: [90, 70, 90],
  M6: [50, 70],
  X1: [90, 90, 60],
  P1: [70, 90, 50],
  P2: [60, 80, 70],
};

function placeholderBars(id: string): number[] {
  if (PLACEHOLDER_BARS[id]) return PLACEHOLDER_BARS[id];
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const count = 2 + (n % 3);
  return Array.from({ length: count }, (_, i) => 50 + ((n >> (i * 5)) % 41));
}

/** Hold for 3 seconds — it blinks — then drag anywhere in the image. A touch point is
    never static once armed. Released early or without moving, it's a plain tap and
    navigates, exactly as before — Codeman, 2026-09-18. */
const TOUCH_POINT_HOLD_MS = 3000;

function TouchPointMarker({
  tp,
  onNavigate,
  onReposition,
}: {
  tp: { id: string; n: number; x: number; y: number; action: string; toScreen: string };
  onNavigate: (toScreen: string) => void;
  onReposition: (id: string, x: number, y: number) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [livePos, setLivePos] = useState<{ x: number; y: number } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const containerRect = useRef<DOMRect | null>(null);
  const justDragged = useRef(false);

  function clearHold() {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    containerRect.current = e.currentTarget.parentElement?.getBoundingClientRect() ?? null;
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      setArmed(true);
      setLivePos({ x: tp.x, y: tp.y });
    }, TOUCH_POINT_HOLD_MS);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!armed) return;
    const rect = containerRect.current;
    if (!rect) return;
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setLivePos({ x, y });
  }

  function handlePointerUp() {
    clearHold();
    if (armed) {
      const final = livePos ?? { x: tp.x, y: tp.y };
      setArmed(false);
      setLivePos(null);
      justDragged.current = true;
      onReposition(tp.id, final.x, final.y);
    }
  }

  function handlePointerCancel() {
    clearHold();
    setArmed(false);
    setLivePos(null);
  }

  const pos = livePos ?? { x: tp.x, y: tp.y };
  return (
    <button
      className={"walk-tp" + (armed ? " armed" : "")}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      title={tp.action}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={(e) => {
        e.stopPropagation();
        if (justDragged.current) {
          justDragged.current = false;
          return;
        }
        onNavigate(tp.toScreen);
      }}
    >
      {tp.n}
    </button>
  );
}

function PhoneFrame({
  screenId,
  screenTitle,
  imageUrl,
  touchPoints,
  onTouchPointClick,
  onImageDoubleClick,
  onTouchPointReposition,
}: {
  screenId: string | undefined;
  screenTitle: string;
  imageUrl: string | null;
  touchPoints: { id: string; n: number; x: number; y: number; action: string; toScreen: string }[];
  onTouchPointClick: (toScreen: string) => void;
  onImageDoubleClick?: (x: number, y: number) => void;
  onTouchPointReposition: (id: string, x: number, y: number) => void;
}) {
  return (
    <div
      className="walk-ph"
      onDoubleClick={
        onImageDoubleClick
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
              onImageDoubleClick(x, y);
            }
          : undefined
      }
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={screenTitle} />
      ) : (
        <div className="walk-ph-bars" aria-label="no image">
          {placeholderBars(screenId ?? "").map((w, i) => (
            <div key={i} className="walk-ln" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {touchPoints.map((tp) => (
        <TouchPointMarker key={tp.id} tp={tp} onNavigate={onTouchPointClick} onReposition={onTouchPointReposition} />
      ))}
    </div>
  );
}

function exitLabel(
  graph: WalkGraphWithUrls,
  end: { flow: string; node: string },
  nodeId: string,
  nodeName?: string,
): string {
  const flow = graph.flows.find((f) => f.id === end.flow);
  const title = flow?.title ?? "exit";
  if (end.node && end.node !== nodeId && nodeName) return `${nodeName} ↗`;
  return `${title} ↗`;
}

function WalkGrid({
  main,
  orphans,
  lanesList,
  currentScreenId,
  graph,
  flagsByScreen,
  mode,
  visited,
  onScreenClick,
  onExitClick,
  onRemoveOrphan,
  nodeId,
}: {
  main: string[];
  orphans: string[];
  lanesList: WalkLane[];
  currentScreenId: string | undefined;
  graph: WalkGraphWithUrls;
  flagsByScreen: Map<string, WalkFlag[]>;
  mode: View;
  visited: Set<string>;
  onScreenClick: (screenId: string) => void;
  onExitClick: (exit: { node: string; flow: string; screen: string }) => void;
  onRemoveOrphan?: (screenId: string) => void;
  nodeId: string;
}) {
  const { model } = useBrain();
  const cols = Math.max(main.length + orphans.length, 1);
  const branchPoints = new Set(lanesList.map((l) => l.from));

  return (
    <div
      className={mode === "chart" ? "walk-chart" : "walk-grid"}
      style={{ gridTemplateColumns: `repeat(${cols}, ${mode === "chart" ? "minmax(0, 150px)" : "72px"})` }}
    >
      {main.map((id, k) =>
        mode === "chart" ? (
          <ChartBox
            key={id}
            id={id}
            title={graph.screens.find((s) => s.id === id)?.title ?? ""}
            current={id === currentScreenId}
            visited={visited.has(id)}
            branch={branchPoints.has(id)}
            arrow={k < main.length - 1}
            style={{ gridColumn: k + 1, gridRow: 1 }}
            onClick={() => onScreenClick(id)}
          />
        ) : (
          <div key={id} style={{ gridColumn: k + 1, gridRow: 1 }}>
            <Thumb
              id={id}
              graph={graph}
              flagsByScreen={flagsByScreen}
              branch={branchPoints.has(id)}
              current={id === currentScreenId}
              onClick={() => onScreenClick(id)}
              // Codeman, 2026-09-18: shown on every main-path thumbnail now, not just a
              // single dead-end flow's lone screen. hideScreen itself refuses (with a
              // clear message, surfaced via the flash line) to remove anything that still
              // has content after it — the safety this button needs no longer depends on
              // the UI only offering it where it was already known to be safe.
              onRemove={onRemoveOrphan ? () => onRemoveOrphan(id) : undefined}
            />
          </div>
        ),
      )}
      {orphans.map((id, j) =>
        mode === "chart" ? (
          <ChartBox
            key={id}
            id={id}
            title={graph.screens.find((s) => s.id === id)?.title ?? ""}
            current={id === currentScreenId}
            visited={visited.has(id)}
            style={{ gridColumn: main.length + j + 1, gridRow: 1 }}
            onClick={() => onScreenClick(id)}
          />
        ) : (
          <div key={id} style={{ gridColumn: main.length + j + 1, gridRow: 1 }}>
            <Thumb
              id={id}
              graph={graph}
              flagsByScreen={flagsByScreen}
              current={id === currentScreenId}
              onClick={() => onScreenClick(id)}
              onRemove={onRemoveOrphan ? () => onRemoveOrphan(id) : undefined}
            />
          </div>
        ),
      )}
      {lanesList.map((lane, i) => {
        const fromIdx = main.indexOf(lane.from);
        const row =
          2 +
          lanesList
            .slice(0, i)
            .filter((other) => main.indexOf(other.from) === fromIdx).length;
        // Directly under the parent's own column, not offset one to the right — Shawn/
        // Codeman, 2026-09-18 (sketch): two neighbouring main-path screens each branching
        // "in the same direction" could overlap under the old +1 offset the moment a lane
        // ever grows past one screen. Anchored under its own parent, a lane can never share
        // a column with a different parent's lane, whatever length it grows to.
        const startCol = Math.max(1, fromIdx + 1);
        return (
          <span key={i} style={{ display: "contents" }}>
            {lane.screens.map((id, j) =>
              mode === "chart" ? (
                <ChartBox
                  key={id}
                  id={id}
                  title={graph.screens.find((s) => s.id === id)?.title ?? ""}
                  current={id === currentScreenId}
                  visited={visited.has(id)}
                  dashed
                  from={j === 0 ? lane.from : undefined}
                  arrow={j < lane.screens.length - 1 || lane.end.type !== "end"}
                  style={{ gridColumn: startCol + j, gridRow: row }}
                  onClick={() => onScreenClick(id)}
                />
              ) : (
                <div key={id} style={{ gridColumn: startCol + j, gridRow: row }}>
                  <Thumb
                    id={id}
                    graph={graph}
                    flagsByScreen={flagsByScreen}
                    dashed
                    current={id === currentScreenId}
                    onClick={() => onScreenClick(id)}
                  />
                </div>
              ),
            )}
            {lane.end.type === "rejoin" ? (
              <div
                className="walk-mk"
                style={{
                  gridColumn: Math.max(startCol + lane.screens.length, main.indexOf(lane.end.screen) + 1),
                  gridRow: row,
                }}
              >
                rejoin {lane.end.screen}
              </div>
            ) : lane.end.type === "exit" ? (
              <button
                className="walk-mk walk-exit"
                style={{ gridColumn: startCol + lane.screens.length, gridRow: row }}
                onClick={() => onExitClick(lane.end as { node: string; flow: string; screen: string })}
              >
                {mode === "chart" ? (
                  <span className="walk-chart-from">↓ from {lane.from}</span>
                ) : null}
                {exitLabel(graph, lane.end, nodeId, model.nodes[lane.end.node]?.name)}
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function Thumb({
  id,
  graph,
  flagsByScreen,
  branch,
  dashed,
  current,
  onClick,
  onRemove,
}: {
  id: string;
  graph: WalkGraphWithUrls;
  flagsByScreen: Map<string, WalkFlag[]>;
  branch?: boolean;
  dashed?: boolean;
  current: boolean;
  onClick: () => void;
  /** Only ever passed for an orphan screen (V6, not reachable from the flow) — a linked screen isn't removable this way, see hideScreen's own header. */
  onRemove?: () => void;
}) {
  const screen = graph.screens.find((s) => s.id === id);
  const version = screen?.currentVersion ? graph.imageVersions.find((v) => v.id === screen.currentVersion) : null;
  const url = version ? graph.signedUrls[version.id] : null;
  const flags = flagsByScreen.get(id) ?? [];
  return (
    <div className="walk-thumb-wrap">
      <button
        className={"walk-thumb" + (dashed ? " walk-thumb-lane" : "") + (current ? " on" : "")}
        title={flags.map((f) => WALK_FLAG_LABELS[f.rule]).join("; ") || undefined}
        onClick={onClick}
      >
      <span className="walk-thumb-tile">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={id} />
        ) : (
          <span className="walk-thumb-empty">
            {placeholderBars(id).map((w, i) => (
              <span key={i} className="walk-ln" style={{ width: `${w}%` }} />
            ))}
          </span>
        )}
        {branch ? <span className="walk-thumb-branch">*</span> : null}
        {flags.length ? <span className="walk-thumb-badge">!</span> : null}
      </span>
      <span className="walk-thumb-id">{id}</span>
      </button>
      {onRemove ? (
        <button className="walk-thumb-remove" aria-label={`Remove ${id}`} title="Remove from view" onClick={onRemove}>
          ×
        </button>
      ) : null}
    </div>
  );
}

function ChartBox({
  id,
  title,
  current,
  visited,
  branch,
  dashed,
  from,
  arrow,
  style,
  onClick,
}: {
  id: string;
  title: string;
  current: boolean;
  visited: boolean;
  branch?: boolean;
  dashed?: boolean;
  from?: string;
  arrow?: boolean;
  style: CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      className={
        "walk-box" + (current ? " on" : "") + (visited && !current ? " visited" : "") + (dashed ? " walk-box-lane" : "")
      }
      style={style}
      onClick={onClick}
    >
      {from ? <span className="walk-chart-from">↓ from {from}</span> : null}
      <b>{id}</b>
      <span>{title}</span>
      {branch ? <span className="walk-thumb-branch">*</span> : null}
      {arrow ? <span className="walk-ar">→</span> : null}
    </button>
  );
}
