// Where the page's time actually goes, measured inside the function rather than inferred
// from the outside. A load measured from a laptop folds three unknowns together — the hop
// to the function, the function's own work, and the function's hop to Supabase — and they
// have completely different fixes. This separates them.
//
//   curl https://salonx-mind-map.vercel.app/api/health
//
// Read-only and credential-free: it reports durations, row counts and the region it ran
// in. Never the keys it used, and never any row content.
//
// This is what chose the region in vercel.json, which that file has no way to explain
// because JSON takes no comments. `firstRoundTrip` is one trivial query on its own — the
// function's distance to Supabase, nothing else — and it read 156-512ms from iad1, 84-309
// from sfo1 and 55-126 from pdx1 on 2026-09-13. Supabase sits in the Pacific Northwest, so
// a function in Virginia was crossing the continent and back for every single query on a
// page that makes a dozen. Re-run this before moving the region again.

import { NextResponse } from "next/server";
import { getCanonicalGraph } from "@/lib/graph/getCanonicalGraph";
import { getLayout, getWholeBoardPmLayer } from "@/lib/graph/getPmLayer";
import { buildModel } from "@/lib/adapter";
import { signModelFiles } from "@/lib/pm/signModelFiles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const out = await fn();
  return [out, Date.now() - t];
}

export async function GET() {
  const started = Date.now();
  try {
    // One trivial round trip on its own, before anything else, so the number below is the
    // function's distance to Supabase rather than the cost of any particular query.
    const [, pingMs] = await timed(() => getLayout());

    const [[canonical, canonicalMs], [pm, pmMs], [layout, layoutMs]] = await Promise.all([
      timed(() => getCanonicalGraph()),
      timed(() => getWholeBoardPmLayer()),
      timed(() => getLayout()),
    ]);

    const positions = new Map((layout?.positions ?? []).map((p) => [p.nodeKey, p]));
    const [model, buildMs] = await timed(async () =>
      signModelFiles(buildModel(canonical.nodes, canonical.connections, pm, positions, canonical.diagnostics)),
    );

    const counts = Object.values(model.nodes).reduce(
      (a, n) => ({ todos: a.todos + n.todos.length, blockers: a.blockers + n.blockers.length }),
      { todos: 0, blockers: 0 },
    );

    return NextResponse.json(
      {
        ok: true,
        region: process.env.VERCEL_REGION ?? "(unknown)",
        ms: { firstRoundTrip: pingMs, canonical: canonicalMs, pmLayer: pmMs, layout: layoutMs, buildAndSign: buildMs, total: Date.now() - started },
        cards: Object.keys(model.nodes).length,
        todos: counts.todos,
        blockers: counts.blockers,
        modelKb: Math.round(JSON.stringify(model).length / 1024),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, region: process.env.VERCEL_REGION ?? "(unknown)", ms: { total: Date.now() - started }, error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
