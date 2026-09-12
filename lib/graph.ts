import { SIZE, TAGS } from "./seed";
import type { BrainNode, Link, Nodes, Shape } from "./types";

export function counts(d: BrainNode): number[] {
  return TAGS.map((t) => {
    if (t.key === "subs") return d.subs.length;
    /* screens is a fixed-length slot array; empty slots are null */
    if (t.key === "screens") return d.screens.filter(Boolean).length;
    return d[t.key].length;
  });
}

export function totalItems(d: BrainNode): number {
  return counts(d).reduce((a, b) => a + b, 0);
}

export function linksOf(links: Link[], id: string): Link[] {
  return links.filter((l) => l.a === id || l.b === id);
}

export function otherEnd(l: Link, id: string): string {
  return l.a === id ? l.b : l.a;
}

export function hasLink(links: Link[], a: string, b: string): boolean {
  return links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

export function centreOf(d: BrainNode): { x: number; y: number } {
  const sz = SIZE[d.shape];
  return { x: d.x + sz[0] / 2, y: d.y + sz[1] / 2 };
}

/** A canon card is never removable in one touch. */
export function isEmpty(nodes: Nodes, links: Link[], id: string): boolean {
  const d = nodes[id];
  if (!d) return false;
  const noContent = counts(d).every((c) => c === 0);
  if (d.origin === "user") {
    /* a card you just made: the wire back to its parent does not count —
       changing your mind must stay one touch. Same for a synthesized containment
       edge, which is not a row to begin with. */
    const foreign = linksOf(links, id).filter((l) => !l.fromPromote && !l.containment);
    return noContent && foreign.length === 0;
  }
  return false;
}

export function collides(
  nodes: Nodes,
  order: string[],
  x: number,
  y: number,
  shape: Shape,
  skipId?: string
): boolean {
  const sz = SIZE[shape];
  return order.some((oid) => {
    if (oid === skipId) return false;
    const o = nodes[oid];
    if (!o) return false;
    const os = SIZE[o.shape];
    return !(
      x + sz[0] + 150 < o.x ||
      x > o.x + os[0] + 150 ||
      y + sz[1] + 60 < o.y ||
      y > o.y + os[1] + 60
    );
  });
}

/** First clear slot beside the parent, then below it. */
export function freeSpot(
  nodes: Nodes,
  order: string[],
  parentId: string,
  shape: Shape
): { x: number; y: number } {
  const p = nodes[parentId];
  const tries: [number, number][] = [
    [410, 0],
    [-410, 0],
    [0, 172],
    [0, -172],
    [410, 172],
    [-410, 172],
    [410, -172],
    [-410, -172],
  ];
  for (const [dx, dy] of tries) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (!collides(nodes, order, x, y, shape)) return { x, y };
  }
  let y2 = p.y + 172;
  while (collides(nodes, order, p.x, y2, shape)) y2 += 172;
  return { x: p.x, y: y2 };
}

/**
 * REALIGN — every card into a clean grid, same column/row spacing freeSpot already uses
 * (410 across, 172 down) so a realigned board reads no differently from one arranged by
 * hand one freeSpot placement at a time. Column count is fixed at 3 to match the shape
 * every hand-built layout in this app has used so far (see seed.ts) — not derived from
 * card count, so a 4-card board and a 40-card board both read as the same kind of grid.
 */
export function realignGrid(order: string[]): Record<string, { x: number; y: number }> {
  const COLS = 3;
  const out: Record<string, { x: number; y: number }> = {};
  order.forEach((id, i) => {
    out[id] = { x: (i % COLS) * 410, y: Math.floor(i / COLS) * 172 };
  });
  return out;
}

/**
 * A real "are these two cards actually touching" test — a small fixed gap, not
 * `collides`'s 150px/60px margin. That margin exists to keep a freshly-added card from
 * crowding an existing one and is intentionally generous for that; reused here it flags
 * cards a full freeSpot/realignGrid step apart (172px vertically) as "colliding," which
 * would make BALANCE rewrite a layout that was never actually overlapping.
 */
function boxesOverlap(nodes: Nodes, order: string[], x: number, y: number, shape: Shape): boolean {
  const GAP = 8;
  const sz = SIZE[shape];
  return order.some((oid) => {
    const o = nodes[oid];
    if (!o) return false;
    const os = SIZE[o.shape];
    return !(
      x + sz[0] + GAP < o.x ||
      x > o.x + os[0] + GAP ||
      y + sz[1] + GAP < o.y ||
      y > o.y + os[1] + GAP
    );
  });
}

/**
 * BALANCE — keeps every card where it was dragged to; only resolves genuine overlaps.
 * Earlier cards in draw order are never moved by a later one (each card is only ever
 * checked against positions already finalized this pass), so re-running BALANCE on an
 * already-clear board is a no-op rather than a slow drift.
 */
export function balanceLayout(nodes: Nodes, order: string[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const settledOrder: string[] = [];
  const settledNodes: Nodes = {};

  for (const id of order) {
    const n = nodes[id];
    if (!n) continue;
    let { x, y } = n;

    if (boxesOverlap(settledNodes, settledOrder, x, y, n.shape)) {
      // Same ring-search freeSpot uses, centred on the card's own current position
      // rather than a parent's — this is "clear a spot right here," not "find a spot
      // beside something else."
      const tries: [number, number][] = [
        [410, 0], [-410, 0], [0, 172], [0, -172],
        [410, 172], [-410, 172], [410, -172], [-410, -172],
      ];
      let placed = false;
      for (const [dx, dy] of tries) {
        if (!boxesOverlap(settledNodes, settledOrder, x + dx, y + dy, n.shape)) {
          x += dx;
          y += dy;
          placed = true;
          break;
        }
      }
      if (!placed) {
        let ring = 2;
        while (boxesOverlap(settledNodes, settledOrder, x, y + ring * 172, n.shape)) ring++;
        y += ring * 172;
      }
    }

    out[id] = { x, y };
    settledNodes[id] = { ...n, x, y };
    settledOrder.push(id);
  }
  return out;
}

export function sizeOf(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

/** A citation at the end of a line is read off it: "… §35.6 EMITS". */
export function splitCitation(raw: string): { text: string; sec: string } {
  const m = raw.match(/\s(§[0-9][0-9.]*(?:\s+[A-Z][A-Z_ ]*)?)\s*$/);
  if (m && m.index !== undefined) {
    return { text: raw.slice(0, m.index).trim(), sec: m[1].trim() };
  }
  return { text: raw, sec: "" };
}

/** Images are downscaled before they are held, so a session does not
    accumulate full-resolution originals in memory. */
export function readImage(
  file: File,
  done: (url: string | null, w?: number, h?: number) => void
): void {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1400;
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        const k = Math.min(max / w, max / h);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      cv.getContext("2d")?.drawImage(img, 0, 0, w, h);
      let out: string;
      try {
        out = cv.toDataURL("image/jpeg", 0.82);
      } catch {
        out = String(fr.result);
      }
      done(out, w, h);
    };
    img.onerror = () => done(null);
    img.src = String(fr.result);
  };
  fr.onerror = () => done(null);
  fr.readAsDataURL(file);
}

export function namesFrom(dt: DataTransfer | null): string[] {
  const f = dt && dt.files ? Array.from(dt.files) : [];
  if (f.length) return f.map((x) => x.name);
  const t = dt ? dt.getData("text") : "";
  return t ? [t] : [];
}
