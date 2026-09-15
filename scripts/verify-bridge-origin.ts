// Proves the origin gate: the bridge can claim a message from the local map and cannot
// claim one from the public deployment, whatever order they arrive in.
//
// Runs against the live queue because that is the thing being asserted — the function is
// security-definer and the grant, not the policy, is the gate, so a local mock would
// prove nothing about the row Vercel actually writes. Probe rows are deleted in a finally
// block, and every one is tagged so a crashed run leaves something greppable behind
// rather than a mystery row in Shawn's conversation.
//
//   npx tsx --env-file=.env scripts/verify-bridge-origin.ts

import { createClient } from "@supabase/supabase-js";

const TAG = "[bridge-origin-probe]";

async function main() {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const probeIds: string[] = [];
  const results: [string, boolean][] = [];

  try {
    const { data: thread, error: threadErr } = await client
      .from("ai_threads")
      .insert({ title: `${TAG} thread` })
      .select()
      .single();
    if (threadErr) throw new Error(`could not open probe thread: ${threadErr.message}`);

    const queue = async (origin: string) => {
      const { data, error } = await client
        .from("ai_messages")
        .insert({ thread_id: thread.id, role: "user", content: `${TAG} ${origin}`, status: "pending", origin })
        .select()
        .single();
      if (error) throw new Error(`could not queue ${origin}: ${error.message}`);
      probeIds.push(data.id);
      return data.id as string;
    };

    const claim = async (origins: string[]) => {
      const { data, error } = await client.rpc("claim_ai_message", { p_origins: origins });
      if (error) throw new Error(`claim failed: ${error.message}`);
      if (process.env.DEBUG_CLAIM) console.log(`    claim(${origins}) ->`, JSON.stringify(data));
      return (data as { id: string | null } | null)?.id ?? null;
    };

    // Queued first, so if the gate were missing this is the row a naive claim returns —
    // the ordering is the test, not incidental.
    const vercelId = await queue("vercel");
    const localId = await queue("local");

    const first = await claim(["local"]);
    results.push(["a public-deployment message is not claimed", first !== vercelId]);
    results.push(["the local message is claimed instead", first === localId]);

    const second = await claim(["local"]);
    results.push(["nothing else local is left to claim", second === null]);

    const third = await claim(["local", "vercel"]);
    results.push(["widening the allowlist does reach it, so the gate is the filter", third === vercelId]);

    const { data: rows } = await client.from("ai_messages").select("id, origin").in("id", probeIds);
    results.push(["every queued row carried an origin", (rows ?? []).every((r) => r.origin)]);

    await client.from("ai_threads").delete().eq("id", thread.id);
  } finally {
    if (probeIds.length) await client.from("ai_messages").delete().in("id", probeIds);
  }

  for (const [name, ok] of results) console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  const passed = results.every(([, ok]) => ok);
  console.log(`\n${passed ? "PASS" : "FAIL"} — ${results.filter(([, o]) => o).length}/${results.length}`);
  process.exit(passed ? 0 : 1);
}

main();
