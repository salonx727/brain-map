// Read-only: which of the page's reads owns the TTFB, and how big the payload the
// surface has to ship actually is.
//
//   npx tsx --env-file=.env scripts/measure-reads.ts

import { getCanonicalGraph } from "../lib/graph/getCanonicalGraph";
import { getWholeBoardPmLayer, getLayout } from "../lib/graph/getPmLayer";
import { buildModel } from "../lib/adapter";
import { signModelFiles } from "../lib/pm/signModelFiles";

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const out = await fn();
  console.log(`${label.padEnd(18)} ${String(Date.now() - t).padStart(6)} ms`);
  return out;
}

async function main() {
  const t0 = Date.now();
  const [canonical, pm, layout] = await Promise.all([
    time("canonical", () => getCanonicalGraph()),
    time("pm layer", () => getWholeBoardPmLayer()),
    time("layout", () => getLayout()),
  ]);
  console.log(`${"(parallel total)".padEnd(18)} ${String(Date.now() - t0).padStart(6)} ms`);

  const positions = new Map((layout?.positions ?? []).map((p) => [p.nodeKey, p]));
  const model = await time("build + sign", () =>
    signModelFiles(buildModel(canonical.nodes, canonical.connections, pm, positions, canonical.diagnostics)),
  );

  const json = JSON.stringify(model);
  console.log(`${"model json".padEnd(18)} ${String(Math.round(json.length / 1024)).padStart(6)} KB`);
  const counts = Object.values(model.nodes).reduce(
    (a, n) => ({ todos: a.todos + n.todos.length, blockers: a.blockers + n.blockers.length }),
    { todos: 0, blockers: 0 },
  );
  console.log(`${"items".padEnd(18)} ${counts.todos} todos · ${counts.blockers} blockers`);
}

main();
