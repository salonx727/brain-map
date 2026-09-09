import { getCanonicalGraph } from "@/lib/graph/getCanonicalGraph";
import { getLayout, getWholeBoardPmLayer } from "@/lib/graph/getPmLayer";
import { buildModel } from "@/lib/adapter";
import { signModelFiles } from "@/lib/pm/signModelFiles";
import { OWNER_KEYS } from "@/lib/owners";
import { findReconcileCandidates } from "@/lib/pm/rulingReader";
import BrainSurface from "@/components/BrainSurface";

// Without this, Next.js prerenders this page at build time and a newly published
// canonical snapshot — or any PM edit — would only appear after a rebuild, which is
// exactly the redeploy this app exists to avoid. Forces a real per-request read.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { nodes, connections, diagnostics, sourceError } = await getCanonicalGraph();
  // Owner keys join the canonical ones because an owner card is a real node: anything
  // hand-typed onto it lives in the same pm_* tables, keyed the same way.
  const pm = await getWholeBoardPmLayer([...nodes.map((n) => n.nodeKey), ...OWNER_KEYS]);
  const layout = await getLayout();
  const positions = new Map((layout?.positions ?? []).map((p) => [p.nodeKey, p]));

  // A failed read and a genuinely empty graph both produce zero nodes, and telling them
  // apart is the whole point of this app. Say which one happened rather than rendering a
  // blank surface that looks like a map with nothing on it.
  if (sourceError) {
    return (
      <main style={{ padding: 40, fontFamily: "var(--font-mono, monospace)", fontSize: 13, lineHeight: 1.7 }}>
        <p>THE MAP COULD NOT BE READ.</p>
        <p style={{ opacity: 0.7 }}>{sourceError}</p>
        <p style={{ opacity: 0.7 }}>Nothing is missing — this surface simply has no source to draw. Fix the read above and reload.</p>
      </main>
    );
  }

  const model = await signModelFiles(buildModel(nodes, connections, pm, positions, diagnostics));

  // Which canonical arrivals look like a card someone drew. Computed here, at read time,
  // rather than inside the sync job — sync-coyote.ts stays single-purpose, and a reconcile
  // nobody got to today is still waiting tomorrow instead of having scrolled past.
  const reconcile = findReconcileCandidates(model.rulings, nodes);

  // layoutId travels with the model because a dragged card writes its position back, and
  // a position belongs to a layout. Null when Supabase isn't configured — the surface
  // then says positions aren't being saved rather than silently dropping them.
  return <BrainSurface initialModel={model} layoutId={layout?.layout.id ?? null} reconcile={reconcile} />;
}
