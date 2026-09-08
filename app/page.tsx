import { getCanonicalGraph } from "@/lib/graph/getCanonicalGraph";
import { getLayout, getWholeBoardPmLayer } from "@/lib/graph/getPmLayer";
import { buildModel } from "@/lib/adapter";
import { signModelFiles } from "@/lib/pm/signModelFiles";
import BrainSurface from "@/components/BrainSurface";

// Without this, Next.js prerenders this page at build time and a newly published
// canonical snapshot — or any PM edit — would only appear after a rebuild, which is
// exactly the redeploy this app exists to avoid. Forces a real per-request read.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { nodes, connections, sourceError } = await getCanonicalGraph();
  const pm = await getWholeBoardPmLayer(nodes.map((n) => n.nodeKey));
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

  const model = await signModelFiles(buildModel(nodes, connections, pm, positions));

  // layoutId travels with the model because a dragged card writes its position back, and
  // a position belongs to a layout. Null when Supabase isn't configured — the surface
  // then says positions aren't being saved rather than silently dropping them.
  return <BrainSurface initialModel={model} layoutId={layout?.layout.id ?? null} />;
}
