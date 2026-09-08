// What is actually sitting in the bridge queue right now.
//
// The two halves of this feature fail in ways that look identical from the browser — a
// message that was never inserted and a message nobody claimed both show as "Working on
// it…" forever. This says which.
//
//   npx tsx --env-file=.env scripts/peek-ai-bridge.ts

import { createPmServiceClient } from "../lib/pm/serviceClient";

async function main() {
  const client = createPmServiceClient();

  const { data: threads, error: tErr } = await client
    .from("ai_threads")
    .select("id, agent_session_id, updated_at")
    .order("updated_at", { ascending: false });
  if (tErr) throw new Error(`ai_threads: ${tErr.message}`);
  console.log(`threads: ${threads?.length ?? 0}`);
  for (const t of threads ?? []) {
    console.log(`  ${t.id}  session=${t.agent_session_id ?? "none"}  ${t.updated_at}`);
  }

  const { data: messages, error: mErr } = await client
    .from("ai_messages")
    .select("id, thread_id, role, status, content, error, created_at")
    .order("created_at", { ascending: true });
  if (mErr) throw new Error(`ai_messages: ${mErr.message}`);

  console.log(`\nmessages: ${messages?.length ?? 0}`);
  for (const m of messages ?? []) {
    const body = (m.content ?? "").replace(/\s+/g, " ").slice(0, 80);
    console.log(`  [${m.status.padEnd(7)}] ${m.role.padEnd(9)} ${body}${m.error ? `  !! ${m.error}` : ""}`);
  }
}

main();
