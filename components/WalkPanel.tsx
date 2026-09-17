"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getWalkForNodeAction, type WalkGraphWithUrls } from "@/app/actions/walk";
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
    return <div className="none">No flows are mapped for this node.</div>;
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

function PhoneFrame({
  screenId,
  screenTitle,
  imageUrl,
  touchPoints,
  onTouchPointClick,
}: {
  screenId: string | undefined;
  screenTitle: string;
  imageUrl: string | null;
  touchPoints: { id: string; n: number; x: number; y: number; action: string; toScreen: string }[];
  onTouchPointClick: (toScreen: string) => void;
}) {
  return (
    <div className="walk-ph">
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
            <Thumb id={id} graph={graph} flagsByScreen={flagsByScreen} current={id === currentScreenId} onClick={() => onScreenClick(id)} />
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
        const fromCol = fromIdx + 1;
        const startCol = Math.max(1, fromCol + 1);
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
