"use client";

import { useCallback, useEffect, useRef } from "react";
import { useBrain } from "@/lib/brain";
import { linksOf, otherEnd } from "@/lib/graph";
import type { Link, Nodes } from "@/lib/types";

/* ==================================================================
   WIRE — a derived 3D field. It does not read the arranged positions
   and does not write them. Layout comes from the graph: sources at the
   front, the spine in the middle, sinks at the back. Exiting returns
   the flat map exactly as it was. No z reaches the schema.
   ================================================================== */

type Pt = { x: number; y: number; z: number; r: number; loose?: boolean };
type Hit = { id: string; p: Proj; R: number; loose?: boolean };
type Proj = { x: number; y: number; s: number; z: number };

function layout3(nodes: Nodes, order: string[], links: Link[]): Record<string, Pt> {
  /* depth = longest path from a source, ignoring the one backward edge */
  const fwd = links.filter((l) => !l.back);
  const indeg: Record<string, number> = {};
  const out: Record<string, string[]> = {};
  order.forEach((id) => {
    indeg[id] = 0;
    out[id] = [];
  });
  fwd.forEach((l) => {
    if (indeg[l.b] === undefined || out[l.a] === undefined) return;
    indeg[l.b]++;
    out[l.a].push(l.b);
  });

  const depth: Record<string, number> = {};
  const queue: string[] = [];
  order.forEach((id) => {
    depth[id] = 0;
    if (!indeg[id]) queue.push(id);
  });
  let guard = 0;
  while (queue.length && guard++ < 4000) {
    const id = queue.shift() as string;
    out[id].forEach((b) => {
      if (depth[b] < depth[id] + 1) depth[b] = depth[id] + 1;
      if (--indeg[b] === 0) queue.push(b);
    });
  }

  /* anything with no edges at all sits in its own lane, to one side */
  const lanes: Record<number, string[]> = {};
  const loose: string[] = [];
  order.forEach((id) => {
    if (!linksOf(links, id).length) {
      loose.push(id);
      return;
    }
    (lanes[depth[id]] = lanes[depth[id]] || []).push(id);
  });

  const keys = Object.keys(lanes)
    .map(Number)
    .sort((a, b) => a - b);
  const span = Math.max(1, keys.length - 1);
  const pts: Record<string, Pt> = {};
  keys.forEach((k, ki) => {
    const lane = lanes[k];
    const n = lane.length;
    const z = 340 - (ki / span) * 700;
    lane.forEach((id, i) => {
      const a = (i / n) * Math.PI * 2 + ki * 0.7;
      const r = n === 1 ? 0 : 90 + n * 26;
      pts[id] = {
        x: Math.cos(a) * r,
        y: Math.sin(a) * r * 0.72,
        z,
        r: 20 + Math.min(linksOf(links, id).length, 10) * 2.4,
      };
    });
  });
  loose.forEach((id, i) => {
    // Independent cards used to sit at x: -520, which is off the default camera.
    // A card you just made that is not wired yet still belongs in the field — it
    // just has no edges yet. Ring them in front of the spine so they are findable.
    const n = Math.max(loose.length, 1);
    const a = (i / n) * Math.PI * 2 - 0.4;
    pts[id] = {
      x: Math.cos(a) * (90 + n * 18),
      y: Math.sin(a) * (70 + n * 12),
      z: 380,
      r: 16,
      loose: true,
    };
  });
  return pts;
}

function rgba(a: number) {
  return "rgba(255,138,20," + a + ")";
}

/* Per-node identity color, orbs only — wires, pulses and the blocked mark stay Baton
   orange exactly as they were. Reference: Shawn's 2026-09-15 3D color mockup
   (vault: Visuals/platform/2026-09-15-brain-3d-node-color-reference). Keyed by the
   real node_key (§ nodeRegistry.ts), so this reads the live graph rather than a fixed
   list — anything not named here (owner cards, PM/user-created cards, independent
   cards) keeps today's single orange, unchanged. */
const NODE_HUES: Record<string, string> = {
  "engine:E01": "#B45CFF" /* GHOST NOTES — the hub */,
  "engine:E02": "#FFD60A" /* EMPIRE */,
  "engine:E03": "#10D982" /* MUSE */,
  "engine:E04": "#14D4C3" /* SIGNAL */,
  "engine:E05": "#FF2EBA" /* RAMP */,
  "engine:E06": "#6366F1" /* THE INK */,
  "engine:E07": "#FF3B5C" /* AFTERBURNER */,
  "engine:E08": "#C6FF3D" /* SKINZ */,
  "engine:E09": "#2541E8" /* THE DIAL */,
  "engine:E10": "#C7CAD1" /* TAG */,
  "engine:E11": "#2EB6FF" /* NEXUS — the sink */,
  "intake:GATE": "#FF8A14",
  "intake:BOOKING": "#FF8A14",
};
const DEFAULT_HUE = "#FF8A14"; /* Baton — today's color, for anything not named above */

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

export default function Field3D({
  open,
  focus,
  setFocus,
  resetNonce,
}: {
  open: boolean;
  focus: string | null;
  setFocus: (id: string | null) => void;
  resetNonce: number;
}) {
  const { model, version, isEmpty } = useBrain();
  const cvRef = useRef<HTMLCanvasElement>(null);

  const view = useRef({
    yaw: -0.42,
    pitch: -0.2,
    roll: 0,
    dist: 1180,
    zoom: 1,
    targetZoom: 1,
    panX: 0,
    panY: 0,
  });
  const pts = useRef<Record<string, Pt>>({});
  const hits = useRef<Hit[]>([]);
  const t3 = useRef(0);
  const raf = useRef<number | null>(null);

  const focusRef = useRef<string | null>(focus);
  focusRef.current = focus;

  const p3 = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch3 = useRef<
    | null
    | { d: number; a: number; mx: number; my: number; z: number; roll: number; px: number; py: number }
  >(null);
  const drag3 = useRef<null | { x: number; y: number; yaw: number; pitch: number }>(null);
  const moved3 = useRef(false);

  const fonts = useRef({ sans: "Helvetica, Arial, sans-serif", mono: "monospace" });

  const project3 = useCallback((p: { x: number; y: number; z: number }, W: number, H: number): Proj => {
    const v = view.current;
    /* yaw about the vertical, pitch about the horizontal, both unclamped —
       the field can be turned over the top and kept going */
    const cy = Math.cos(v.yaw);
    const sy = Math.sin(v.yaw);
    const cp = Math.cos(v.pitch);
    const sp = Math.sin(v.pitch);
    const x = p.x * cy - p.z * sy;
    let z = p.x * sy + p.z * cy;
    const y = p.y * cp - z * sp;
    z = p.y * sp + z * cp;
    let f = v.dist / (v.dist + z);
    if (v.dist + z < 60) f = 60 / v.dist;
    f *= v.zoom;
    let sx = x * f;
    let sy2 = y * f;
    /* roll about the view axis — two-finger twist */
    if (v.roll) {
      const cr = Math.cos(v.roll);
      const sr = Math.sin(v.roll);
      const rx = sx * cr - sy2 * sr;
      sy2 = sx * sr + sy2 * cr;
      sx = rx;
    }
    return { x: W / 2 + sx + v.panX, y: H / 2 + sy2 + v.panY, s: f, z };
  }, []);

  /* ---------------- the loop ---------------- */
  useEffect(() => {
    if (!open) return;
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const sans = css.getPropertyValue("--font-dm-sans").trim();
    const mono = css.getPropertyValue("--font-space-mono").trim();
    fonts.current = {
      sans: (sans ? sans + ", " : "") + "Helvetica, Arial, sans-serif",
      mono: (mono ? mono + ", " : "") + "monospace",
    };

    let W = 0;
    let H = 0;
    const resize3 = () => {
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      cv.width = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };

    /* Camera reset belongs to entering the field, not to a card being added. */
    resize3();
    const v = view.current;
    v.yaw = -0.42;
    v.pitch = -0.2;
    v.roll = 0;
    v.panX = 0;
    v.panY = 0;
    v.zoom = 1;
    v.targetZoom = 1;

    const bez3 = (a: Pt, b: Pt, k: number) => {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const mz = (a.z + b.z) / 2;
      const u = 1 - k;
      const bow = 1.22;
      return {
        x: u * u * a.x + 2 * u * k * mx * bow + k * k * b.x,
        y: u * u * a.y + 2 * u * k * my * bow + k * k * b.y,
        z: u * u * a.z + 2 * u * k * mz * bow + k * k * b.z,
      };
    };

    const draw3 = () => {
      t3.current += 0.006;
      const t = t3.current;
      v.zoom += (v.targetZoom - v.zoom) * 0.14;
      const focus3 = focusRef.current;

      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, W, H);

      model.links.forEach((l, i) => {
        const A = pts.current[l.a];
        const B = pts.current[l.b];
        if (!A || !B) return;
        const lit = !focus3 || l.a === focus3 || l.b === focus3;
        const SEG = 22;
        const path: Proj[] = [];
        for (let k = 0; k <= SEG; k++) path.push(project3(bez3(A, B, k / SEG), W, H));
        ctx.lineCap = "round";
        // Containment is nesting, not data-flow — a card you filed under another, not a
        // signal moving between them. Dotted and dim so it reads as structure in the
        // background rather than competing with a real wire for attention, and it never
        // gets the light-pulse below: there is nothing flowing to animate.
        // Three readings, drawn three ways, because the whole point of the ruling flow is
        // that a proposal must never look like canon:
        //   containment — nesting, dotted and dim, no pulse
        //   awaiting a ruling — a wire somebody drew that Shawn has not ruled on. Dashed
        //     and dimmer than a canonical edge; it keeps its pulse because it is a claim
        //     about data flow, but it must not read as a declared one.
        //   inferred — canon carries it, but no engine declares it: it is read out of the
        //     target's own READS. Drawn lighter than a declaration for the same reason
        //     `back` is drawn differently — an unfalsifiable rendering is worse than a
        //     missing one (§43.1).
        const strength = l.containment ? 0.22 : l.back ? 0.75 : l.awaitingRuling ? 0.2 : l.evidence === "inferred" ? 0.22 : 0.34;
        ctx.strokeStyle = rgba(lit ? strength : l.containment ? 0.04 : 0.05);
        ctx.lineWidth = l.back ? 1.6 : 1;
        ctx.setLineDash(
          l.containment ? [2, 5] : l.back ? [7, 5] : l.awaitingRuling ? [4, 4] : l.evidence === "inferred" ? [1, 4] : [],
        );
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let k = 1; k <= SEG; k++) ctx.lineTo(path[k].x, path[k].y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (l.containment) return;

        /* light travels source to target — direction, drawn */
        const ph = (t * 0.22 + i * 0.11) % 1;
        const pp = project3(bez3(A, B, ph), W, H);
        const fade = Math.sin(ph * Math.PI);
        const rr = 2.4 * pp.s * fade;
        if (rr > 0.2) {
          ctx.fillStyle = rgba((lit ? 0.95 : 0.1) * fade);
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, rr, 0, 6.2832);
          ctx.fill();
        }
      });

      hits.current = model.order
        .map((id) => {
          const P = pts.current[id];
          if (!P) return null;
          // Same rule as the flat map: a card with no name and nothing on it yet is
          // the moment right after ADD CARD, before anyone named it — not a card
          // meant to be seen (Shawn, 2026-09-15: "they should not be displayed").
          const n = model.nodes[id];
          if (n && !n.name && isEmpty(id)) return null;
          return { id, p: project3(P, W, H), R: P.r, loose: P.loose } as Hit;
        })
        .filter((h): h is Hit => !!h)
        .sort((a, b) => b.p.z - a.p.z);

      hits.current.forEach((h) => {
        const d = model.nodes[h.id];
        if (!d) return;
        const p = h.p;
        const lit =
          !focus3 ||
          h.id === focus3 ||
          linksOf(model.links, focus3).some((l) => otherEnd(l, focus3) === h.id);
        const alpha = lit ? 1 : 0.14;
        const rad = h.R * p.s * (1 + Math.sin(t * 1.6 + h.R) * 0.03);
        const blocked = d.blockers.length > 0 || d.state === "BLOCKED";

        const hue = NODE_HUES[h.id] ?? DEFAULT_HUE;
        const g = ctx.createRadialGradient(
          p.x - rad * 0.4,
          p.y - rad * 0.42,
          rad * 0.06,
          p.x,
          p.y,
          rad
        );
        g.addColorStop(0, hexA("#FFFFFF", 0.4 * alpha));
        g.addColorStop(0.3, hexA(hue, 0.9 * alpha));
        g.addColorStop(0.82, hexA(hue, 0.42 * alpha));
        g.addColorStop(1, hexA("#000000", 0.55 * alpha));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, 6.2832);
        ctx.fill();

        ctx.strokeStyle = hexA(hue, (h.loose ? 0.35 : 0.85) * alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, 6.2832);
        ctx.stroke();

        if (blocked) {
          /* the stuck mark, carried into the field */
          ctx.fillStyle = rgba(0.95 * alpha);
          ctx.beginPath();
          ctx.arc(p.x + rad * 0.78, p.y - rad * 0.78, 3.4 * p.s + 1.6, 0, 6.2832);
          ctx.fill();
        }
        if (focus3 === h.id) {
          ctx.strokeStyle = "rgba(255,255,255,0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad + 11, 0, 6.2832);
          ctx.stroke();
        }
        if (p.s > 0.3) {
          const la = Math.min(1, (p.s - 0.3) * 3.4) * alpha;
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(240,240,246," + 0.95 * la + ")";
          ctx.font = Math.max(10, 13 * p.s) + "px " + fonts.current.sans;
          ctx.fillText(d.name || d.ref, p.x, p.y + rad + 20 * p.s + 5);
          ctx.fillStyle = "rgba(142,142,150," + 0.85 * la + ")";
          ctx.font = Math.max(8, 9.5 * p.s) + "px " + fonts.current.mono;
          ctx.fillText(d.ref + (d.sec ? "  " + d.sec : ""), p.x, p.y + rad + 34 * p.s + 6);
        }
      });

      raf.current = requestAnimationFrame(draw3);
    };

    raf.current = requestAnimationFrame(draw3);
    window.addEventListener("resize", resize3);

    /* the trackpad and the wheel need a non-passive listener to hold the page still */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        view.current.roll += e.deltaY * 0.004; /* roll on a trackpad */
        return;
      }
      view.current.targetZoom = Math.max(
        0.25,
        Math.min(3.2, view.current.targetZoom * (1 - e.deltaY * 0.0015))
      );
    };
    cv.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      window.removeEventListener("resize", resize3);
      cv.removeEventListener("wheel", onWheel);
      pts.current = {};
      hits.current = [];
    };
  }, [open, project3]);

  /* Re-derive whenever the graph changes. Without this a card added while the field
     is open (or added on the flat map then revealed here) has no point in pts, so
     draw3 skips it and the card is simply not there. Camera stays put. */
  useEffect(() => {
    if (!open) return;
    pts.current = layout3(model.nodes, model.order, model.links);
  }, [open, version, model]);

  /* reset lives on the readout, not on a gesture, so a pinch can never fire it */
  useEffect(() => {
    if (!resetNonce) return;
    const v = view.current;
    v.yaw = -0.42;
    v.pitch = -0.2;
    v.roll = 0;
    v.panX = 0;
    v.panY = 0;
    v.targetZoom = 1;
  }, [resetNonce]);

  const pick3 = (cx: number, cy: number) => {
    let best: string | null = null;
    let bd = 1e9;
    hits.current.forEach((h) => {
      const dd = Math.hypot(h.p.x - cx, h.p.y - cy);
      if (dd < Math.max(26, h.R * h.p.s + 14) && dd < bd) {
        bd = dd;
        best = h.id;
      }
    });
    setFocus(best ? (focusRef.current === best ? null : best) : null);
  };

  return (
    <canvas
      id="field3d"
      ref={cvRef}
      className={open ? "open" : ""}
      onPointerDown={(e) => {
        p3.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (p3.current.size === 2) {
          const v = Array.from(p3.current.values());
          pinch3.current = {
            d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1,
            a: Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x),
            mx: (v[0].x + v[1].x) / 2,
            my: (v[0].y + v[1].y) / 2,
            z: view.current.targetZoom,
            roll: view.current.roll,
            px: view.current.panX,
            py: view.current.panY,
          };
          drag3.current = null;
          return;
        }
        drag3.current = {
          x: e.clientX,
          y: e.clientY,
          yaw: view.current.yaw,
          pitch: view.current.pitch,
        };
        moved3.current = false;
        e.currentTarget.classList.add("drag");
      }}
      onPointerMove={(e) => {
        if (p3.current.has(e.pointerId)) {
          p3.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        const pc = pinch3.current;
        if (p3.current.size === 2 && pc) {
          const v = Array.from(p3.current.values());
          const dd = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1;
          const aa = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
          const mx = (v[0].x + v[1].x) / 2;
          const my = (v[0].y + v[1].y) / 2;
          view.current.targetZoom = Math.max(0.25, Math.min(3.2, pc.z * (dd / pc.d)));
          let da = aa - pc.a;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          view.current.roll = pc.roll + da; /* twist */
          view.current.panX = pc.px + (mx - pc.mx); /* slide, horizontal */
          view.current.panY = pc.py + (my - pc.my); /* slide, vertical */
          return;
        }
        const dg = drag3.current;
        if (!dg) return;
        const dx = e.clientX - dg.x;
        const dy = e.clientY - dg.y;
        if (Math.hypot(dx, dy) > 5) moved3.current = true;
        view.current.yaw = dg.yaw + dx * 0.005;
        view.current.pitch = dg.pitch + dy * 0.005; /* no stop at the poles */
      }}
      /* No double-tap reset here. Lifting two fingers produces two pointerups
         in quick succession, which read as a double tap and snapped every
         pinch back. */
      onPointerUp={(e) => {
        p3.current.delete(e.pointerId);
        if (p3.current.size < 2) pinch3.current = null;
        e.currentTarget.classList.remove("drag");
        if (drag3.current && !moved3.current) pick3(e.clientX, e.clientY);
        drag3.current = null;
      }}
      onPointerCancel={(e) => {
        p3.current.delete(e.pointerId);
        if (p3.current.size < 2) pinch3.current = null;
        e.currentTarget.classList.remove("drag");
        drag3.current = null;
      }}
    />
  );
}
