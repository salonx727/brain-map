// Runs exactly what app/page.tsx runs, then reports what the UI would actually receive.
// Separates "the edges are not in the database" from "the edges are in the database but
// never reach the canvas" — two failures that look identical on screen.
//
//   npx tsx --env-file=.env scripts/check-model.ts

import { getCanonicalGraph } from "../lib/graph/getCanonicalGraph";
import { getLayout, getPmLayer } from "../lib/graph/getPmLayer";
import { buildModel } from "../lib/adapter";

async function main() {
  const { nodes, connections, sourceError } = await getCanonicalGraph();
  console.log("sourceError :", sourceError ?? "(none)");
  console.log("nodes       :", nodes.length);
  console.log("connections :", connections.length);

  const pm = await getPmLayer(nodes.map((n) => n.nodeKey));
  const layout = await getLayout();
  const positions = new Map((layout?.positions ?? []).map((p) => [p.nodeKey, p]));

  const model = buildModel(nodes, connections, pm, positions);
  console.log("model nodes :", Object.keys(model.nodes).length);
  console.log("model links :", model.links.length);
  console.log("");
  for (const l of model.links.slice(0, 25)) {
    console.log(`  ${l.canon ? "canon" : "pm   "}  ${l.a} -> ${l.b}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
