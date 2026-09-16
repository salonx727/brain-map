"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWalkForNodeAction, type WalkGraphWithUrls } from "@/app/actions/walk";
import { flowsForNode, laneSequence, lanes, mainPath, validateFlow } from "@/lib/walk/derive";
import type { WalkFlag, WalkLane } from "@/lib/walk/types";

type View = "images" | "chart";

/**
 * WALK — the step-through UX viewer, spec v1.7. Function, not design (Founder ruling
 * 2026-09-16): this renders exactly what the spec asks for and nothing decorative on top.
 * Mounted inside the existing UI tab (ControlPanel.tsx, tab === 0), never a route or a
 * pop-up of its own — BUILD_PROMPT.md hard constraint 1 and 6.
 */
export default function WalkPanel({ nodeId, onOpenNode }: { nodeId: string; onOpenNode: (nodeId: string) => void }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; graph: WalkGraphWithUrls }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
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

  if (state.status === "loading") return <div className="none">Loading WALK…</div>;
  if (state.status === "error") return <div className="none">{state.message}</div>;
  return <WalkViewer nodeId={nodeId} graph={state.graph} onOpenNode={onOpenNode} />;
}

function WalkViewer({ nodeId, graph, onOpenNode }: { nodeId: string; graph: WalkGraphWithUrls; onOpenNode: (nodeId: string) => void }) {
  const flows = useMemo(() => flowsForNode(graph, nodeId), [graph, nodeId]);
  const [flowId, setFlowId] = useState<string | null>(flows[0]?.id ?? null);
  const [laneIndex, setLaneIndex] = useState<number | null>(null); // null = main path
  const [position, setPosition] = useState(0);
  const [view, setView] = useState<View>("images");
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const stageRef = useRef<HTMLDivElement>(null);

  // A different node was selected — start over rather than carry stale flow/lane state
  // into a graph that may not contain it at all.
  useEffect(() => {
    setFlowId(flows[0]?.id ?? null);
    setLaneIndex(null);
    setPosition(0);
    setVisited(new Set());
  }, [nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flowLanes = useMemo<WalkLane[]>(() => (flowId ? lanes(graph, flowId) : []), [graph, flowId]);
  const main = useMemo(() => (flowId ? mainPath(graph, flowId) : []), [graph, flowId]);
  const flags = useMemo<WalkFlag[]>(() => (flowId ? validateFlow(graph, flowId) : []), [graph, flowId]);
  // V1/V3/V4 target a screen id directly; V2/V5 target a touch point id (see derive.ts's
  // validateFlow) — resolved back to that touch point's own screen here, once, so every
  // caller can just ask "what's flagged on this screen" without knowing which rule keys
  // on what. Without this resolution M4.T1's "check position" flag computes correctly but
  // never appears anywhere a person can see it — ACCEPTANCE.md #14 needs it visible, not
  // just derivable.
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

  const currentScreenId = sequence[position];
  const currentScreen = graph.screens.find((s) => s.id === currentScreenId);

  useEffect(() => {
    if (!currentScreenId) return;
    setVisited((prev) => (prev.has(currentScreenId) ? prev : new Set(prev).add(currentScreenId)));
  }, [currentScreenId]);

  const handleExit = useCallback(
    (exit: { node: string; flow: string; screen: string }) => {
      if (exit.node !== nodeId) {
        onOpenNode(exit.node);
        return;
      }
      setFlowId(exit.flow);
      setLaneIndex(null);
      setPosition(0);
    },
    [nodeId, onOpenNode],
  );

  const navigateTo = useCallback(
    (screenId: string) => {
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
      const exitLane = flowLanes.find((l) => l.end.type === "exit" && l.end.screen === screenId);
      if (exitLane && exitLane.end.type === "exit") {
        handleExit(exitLane.end);
      }
    },
    [sequence, flowLanes, flowId, graph, handleExit],
  );

  const goDelta = useCallback(
    (delta: number) => {
      setPosition((p) => Math.max(0, Math.min(sequence.length - 1, p + delta)));
    },
    [sequence.length],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
    el.addEventListener("touchstart", onTouchStart);
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [goDelta]);

  if (flows.length === 0) {
    return <div className="none">No flows are mapped for this node.</div>;
  }

  const touchPoints = currentScreen ? graph.touchPoints.filter((t) => t.screenId === currentScreen.id).sort((a, b) => a.n - b.n) : [];
  const currentVersionId = currentScreen?.currentVersion ?? null;
  const imageUrl = currentVersionId ? graph.signedUrls[currentVersionId] : null;
  const screenFlags = currentScreen ? (flagsByScreen.get(currentScreen.id) ?? []) : [];

  return (
    <div className="walk sect">
      <div className="walk-bar">
        {flows.map((f) => (
          <button key={f.id} className={"walk-flowtab" + (f.id === flowId ? " on" : "")} onClick={() => { setFlowId(f.id); setLaneIndex(null); setPosition(0); }}>
            {f.title}
          </button>
        ))}
        <span className="walk-crumb">
          {currentScreenId ? `${currentScreenId} · ${position + 1} of ${sequence.length}` : ""}
          {laneIndex !== null ? " · branch lane" : ""}
        </span>
        <span className="walk-viewtoggle">
          <button className={"tg" + (view === "images" ? " act" : "")} onClick={() => setView("images")}>Images</button>
          <button className={"tg" + (view === "chart" ? " act" : "")} onClick={() => setView("chart")}>Chart</button>
        </span>
      </div>

      {view === "images" ? (
        <ImageView
          stageRef={stageRef}
          screenId={currentScreenId}
          screenTitle={currentScreen?.title ?? currentScreenId ?? ""}
          imageUrl={imageUrl}
          touchPoints={touchPoints}
          screenFlags={screenFlags}
          onPrev={() => goDelta(-1)}
          onNext={() => goDelta(1)}
          onTouchPointClick={(toScreen) => navigateTo(toScreen)}
          main={main}
          lanesList={flowLanes}
          currentScreenId={currentScreenId}
          onThumbnailClick={navigateTo}
          onExitClick={handleExit}
          graph={graph}
          flagsByScreen={flagsByScreen}
        />
      ) : (
        <ChartView
          main={main}
          lanesList={flowLanes}
          currentScreenId={currentScreenId}
          visited={visited}
          graph={graph}
          onBoxClick={navigateTo}
          onExitClick={handleExit}
          onPrev={() => goDelta(-1)}
          onNext={() => goDelta(1)}
        />
      )}
    </div>
  );
}

function ImageView({
  stageRef,
  screenId,
  screenTitle,
  imageUrl,
  touchPoints,
  screenFlags,
  onPrev,
  onNext,
  onTouchPointClick,
  main,
  lanesList,
  currentScreenId,
  onThumbnailClick,
  onExitClick,
  graph,
  flagsByScreen,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  screenId: string | undefined;
  screenTitle: string;
  imageUrl: string | null;
  touchPoints: { id: string; n: number; x: number; y: number; action: string; toScreen: string }[];
  screenFlags: WalkFlag[];
  onPrev: () => void;
  onNext: () => void;
  onTouchPointClick: (toScreen: string) => void;
  main: string[];
  lanesList: WalkLane[];
  currentScreenId: string | undefined;
  onThumbnailClick: (screenId: string) => void;
  onExitClick: (exit: { node: string; flow: string; screen: string }) => void;
  graph: WalkGraphWithUrls;
  flagsByScreen: Map<string, WalkFlag[]>;
}) {
  return (
    <>
      <div className="walk-stage" ref={stageRef}>
        <button className="nav" aria-label="Previous" onClick={onPrev}>
          ‹
        </button>
        <div className="walk-frame">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={screenTitle} />
          ) : (
            <div className="walk-placeholder">no image</div>
          )}
          {touchPoints.map((tp) => (
            <button
              key={tp.id}
              className="walk-tp"
              style={{ left: `${tp.x}%`, top: `${tp.y}%` }}
              title={tp.action}
              onClick={() => onTouchPointClick(tp.toScreen)}
            >
              {tp.n}
            </button>
          ))}
        </div>
        <button className="nav" aria-label="Next" onClick={onNext}>
          ›
        </button>
      </div>
      <div className="walk-cap">
        {screenId} · {screenTitle}
        {screenFlags.length ? (
          <span className="walk-flags">
            {screenFlags.map((f, i) => (
              <span key={i} className="walk-flag" title={f.reason}>
                {f.rule}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="walk-legend">
        {touchPoints.length === 0 ? (
          <span>No touch points on this screen.</span>
        ) : (
          touchPoints.map((tp) => (
            <span key={tp.id} className="walk-legend-line">
              T{tp.n} → {tp.toScreen} {tp.n === 1 ? "(main path)" : ""} · {tp.action} · authored
            </span>
          ))
        )}
      </div>
      <WalkStrip
        main={main}
        lanesList={lanesList}
        currentScreenId={currentScreenId}
        graph={graph}
        flagsByScreen={flagsByScreen}
        onThumbnailClick={onThumbnailClick}
        onExitClick={onExitClick}
      />
    </>
  );
}

function WalkStrip({
  main,
  lanesList,
  currentScreenId,
  graph,
  flagsByScreen,
  onThumbnailClick,
  onExitClick,
}: {
  main: string[];
  lanesList: WalkLane[];
  currentScreenId: string | undefined;
  graph: WalkGraphWithUrls;
  flagsByScreen: Map<string, WalkFlag[]>;
  onThumbnailClick: (screenId: string) => void;
  onExitClick: (exit: { node: string; flow: string; screen: string }) => void;
}) {
  const branchPoints = new Set(lanesList.map((l) => l.from));
  return (
    <div className="walk-strip">
      <div className="walk-strip-row">
        {main.map((id) => (
          <Thumb
            key={id}
            id={id}
            graph={graph}
            flagsByScreen={flagsByScreen}
            branch={branchPoints.has(id)}
            current={id === currentScreenId}
            onClick={() => onThumbnailClick(id)}
          />
        ))}
      </div>
      {lanesList.map((lane, i) => (
        <div className="walk-strip-lane" key={i} style={{ marginLeft: `${main.indexOf(lane.from) * 84}px` }}>
          {lane.screens.map((id) => (
            <Thumb
              key={id}
              id={id}
              graph={graph}
              flagsByScreen={flagsByScreen}
              dashed
              current={id === currentScreenId}
              onClick={() => onThumbnailClick(id)}
            />
          ))}
          {lane.end.type === "rejoin" ? (
            <div className="walk-endtile walk-rejoin">rejoin {lane.end.screen}</div>
          ) : lane.end.type === "exit" ? (
            <button className="walk-endtile walk-exit" onClick={() => onExitClick(lane.end as { node: string; flow: string; screen: string })}>
              {graph.flows.find((f) => f.id === (lane.end as { flow: string }).flow)?.title ?? "exit"}
            </button>
          ) : null}
        </div>
      ))}
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
}: {
  id: string;
  graph: WalkGraphWithUrls;
  flagsByScreen: Map<string, WalkFlag[]>;
  branch?: boolean;
  dashed?: boolean;
  current: boolean;
  onClick: () => void;
}) {
  const screen = graph.screens.find((s) => s.id === id);
  const version = screen?.currentVersion ? graph.imageVersions.find((v) => v.id === screen.currentVersion) : null;
  const url = version ? graph.signedUrls[version.id] : null;
  const flags = flagsByScreen.get(id) ?? [];
  return (
    <button
      className={"walk-thumb" + (dashed ? " walk-thumb-lane" : "") + (current ? " on" : "")}
      title={flags.map((f) => f.reason).join("; ") || undefined}
      onClick={onClick}
    >
      <span className="walk-thumb-tile">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={id} />
        ) : (
          <span className="walk-thumb-empty">{id}</span>
        )}
        {branch ? <span className="walk-thumb-branch">*</span> : null}
        {flags.length ? <span className="walk-thumb-badge">!</span> : null}
      </span>
      <span className="walk-thumb-id">{id}</span>
    </button>
  );
}

function ChartView({
  main,
  lanesList,
  currentScreenId,
  visited,
  graph,
  onBoxClick,
  onExitClick,
  onPrev,
  onNext,
}: {
  main: string[];
  lanesList: WalkLane[];
  currentScreenId: string | undefined;
  visited: Set<string>;
  graph: WalkGraphWithUrls;
  onBoxClick: (screenId: string) => void;
  onExitClick: (exit: { node: string; flow: string; screen: string }) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const branchPoints = new Set(lanesList.map((l) => l.from));
  function Box({ id }: { id: string }) {
    const screen = graph.screens.find((s) => s.id === id);
    return (
      <button
        className={"walk-box" + (id === currentScreenId ? " on" : "") + (visited.has(id) ? " visited" : "")}
        onClick={() => onBoxClick(id)}
      >
        <b>{id}</b>
        <span>{screen?.title ?? ""}</span>
        {branchPoints.has(id) ? <span className="walk-thumb-branch">*</span> : null}
      </button>
    );
  }
  return (
    <>
      <div className="walk-chart">
        <div className="walk-strip-row">
          {main.map((id) => (
            <Box key={id} id={id} />
          ))}
        </div>
        {lanesList.map((lane, i) => (
          <div className="walk-strip-lane" key={i} style={{ marginLeft: `${main.indexOf(lane.from) * 174}px` }}>
            <div className="walk-chart-from">from {lane.from}</div>
            {lane.screens.map((id) => (
              <Box key={id} id={id} />
            ))}
            {lane.end.type === "rejoin" ? (
              <div className="walk-endtile walk-rejoin">rejoin {lane.end.screen}</div>
            ) : lane.end.type === "exit" ? (
              <button className="walk-endtile walk-exit" onClick={() => onExitClick(lane.end as { node: string; flow: string; screen: string })}>
                {graph.flows.find((f) => f.id === (lane.end as { flow: string }).flow)?.title ?? "exit"}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="walk-legend" style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <button className="nav" aria-label="Previous" onClick={onPrev}>
          ‹
        </button>
        <button className="nav" aria-label="Next" onClick={onNext}>
          ›
        </button>
      </div>
    </>
  );
}
