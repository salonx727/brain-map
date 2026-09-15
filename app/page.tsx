import { getCanonicalGraph } from "@/lib/graph/getCanonicalGraph";
import { getLayout, getWholeBoardPmLayer } from "@/lib/graph/getPmLayer";
import { buildModel } from "@/lib/adapter";
import { signModelFiles } from "@/lib/pm/signModelFiles";
import { findReconcileCandidates } from "@/lib/pm/rulingReader";
import BrainSurface from "@/components/BrainSurface";

/**
 * The surface is served from the CDN and regenerated behind it, never rendered from
 * scratch per visit.
 *
 * This page used to be `force-dynamic`, so that a newly published canonical snapshot or
 * any PM edit appeared without a redeploy. It did — at the cost of every single refresh
 * waiting on a function to wake up and then make a dozen Supabase round trips, which is
 * the 2.5–4 second cold open Shawn kept hitting (2026-09-13).
 *
 * Nothing about freshness is given up, because the invalidation is explicit rather than
 * time-based: every write action in app/actions/pm.ts already calls `revalidatePath("/")`,
 * and scripts/sync-coyote.ts pings /api/revalidate the moment it publishes. The 30 seconds
 * below is only the backstop for a change that arrives through neither path — a row
 * written straight into Supabase by hand, say. In the normal case the cache is already
 * stale before the reader asks for it.
 */
export const revalidate = 30;
// Every Server Action fired from this surface — the AI hub ask included — posts back to
// this same route and inherits this budget. The earlier 20 was sized for the page read
// alone and was quietly capping a Claude call, which takes longer than any query here.
export const maxDuration = 60;

function readError(message: string) {
  return (
    <main style={{ padding: 40, fontFamily: "var(--font-mono, monospace)", fontSize: 13, lineHeight: 1.7 }}>
      <p>THE MAP COULD NOT BE READ.</p>
      <p style={{ opacity: 0.7 }}>{message}</p>
      <p style={{ opacity: 0.7 }}>Nothing is missing — this surface simply has no source to draw. Fix the read above and reload.</p>
    </main>
  );
}

export default async function Page() {
  let nodes;
  let connections;
  let diagnostics;
  let sourceError;
  let pm;
  let layout;
  try {
    // These three reads do not depend on each other. Running them in a line was
    // stacking three Supabase round-trips; a gateway blip on the PM one (the
    // confirmed 2026-09-13 failure) then held the whole page until the browser
    // gave up with "this site can't be reached."
    const [canonical, pmLayer, savedLayout] = await Promise.all([
      getCanonicalGraph(),
      getWholeBoardPmLayer(),
      getLayout(),
    ]);
    nodes = canonical.nodes;
    connections = canonical.connections;
    diagnostics = canonical.diagnostics;
    sourceError = canonical.sourceError;
    pm = pmLayer;
    layout = savedLayout;
  } catch (err) {
    return readError(err instanceof Error ? err.message : String(err));
  }
  const positions = new Map((layout?.positions ?? []).map((p) => [p.nodeKey, p]));

  // A failed read and a genuinely empty graph both produce zero nodes, and telling them
  // apart is the whole point of this app. Say which one happened rather than rendering a
  // blank surface that looks like a map with nothing on it.
  if (sourceError) {
    return readError(sourceError);
  }

  let model;
  try {
    model = await signModelFiles(buildModel(nodes, connections, pm, positions, diagnostics));
  } catch (err) {
    return readError(err instanceof Error ? err.message : String(err));
  }

  // Which canonical arrivals look like a card someone drew. Computed here, at read time,
  // rather than inside the sync job — sync-coyote.ts stays single-purpose, and a reconcile
  // nobody got to today is still waiting tomorrow instead of having scrolled past.
  const reconcile = findReconcileCandidates(model.rulings, nodes);

  // layoutId travels with the model because a dragged card writes its position back, and
  // a position belongs to a layout. Null when Supabase isn't configured — the surface
  // then says positions aren't being saved rather than silently dropping them.
  return <BrainSurface initialModel={model} layoutId={layout?.layout.id ?? null} reconcile={reconcile} />;
}
