-- The queue that lets the web AI hub talk to the real brain.
--
-- CommandOS — the Telegram surface — is a Python process on Shawn's machine holding a
-- Claude Agent SDK session with the workspace as cwd, the vault in add_dirs, and Bash
-- among its tools. The map is a serverless Next.js app on Vercel that can reach Supabase
-- and the Anthropic API and nothing else. No amount of tooling added to the map's own AI
-- can close that gap: it will never be able to read the vault or write gtd/inbox.md,
-- because it has no filesystem to read or write.
--
-- So the web hub does not get a second brain. It gets a second door onto the one that
-- already exists, and this is the doorway. Vercel cannot open a connection to a laptop
-- behind NAT, but CommandOS is already a process that polls — coyote_watch.py has watched
-- a directory every 60 seconds since 2026-09-08. Same shape here: the browser writes a
-- row, CommandOS claims it, runs it through the same primed session with the same persona
-- and the same tools, and writes the answer back. No tunnel, no inbound port, no firewall
-- change, and nothing to keep running that was not already running.
--
-- Deliberately NOT granted to anon, unlike every other table in this schema. The map is
-- served publicly with no auth today, and the rows here are a command channel into a
-- machine rather than a picture of a graph — so every read and write goes through a
-- Server Action holding the service-role key, and the browser never touches these tables
-- directly. That is a smaller promise than real authentication and is not a substitute
-- for it; it is what keeps the blast radius to "the app can do this" rather than "anyone
-- with a Supabase anon key can."

create table if not exists ai_threads (
  id uuid primary key default gen_random_uuid(),
  -- Named by the agent on request, the way /name renames a Telegram forum topic. Null
  -- until then rather than a placeholder, so "unnamed" is a fact and not a fake title.
  title text,
  -- Which surface opened it. Telegram's own threads are not in this table and are not
  -- meant to be; this column exists so a second web-side surface later is a value, not a
  -- schema change.
  surface text not null default 'web',
  -- The Agent SDK session this thread resumes. Written by the bridge after the first
  -- run primes it, and rewritten whenever the SDK hands back a new one (a /compact
  -- changes it). Null means the next message primes a fresh session.
  agent_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references ai_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  -- pm_files ids, uploaded through the existing intake pipeline before the message is
  -- sent. Bytes never travel through this table: the bridge resolves an id to a storage
  -- path and downloads it to CommandOS's own inbox, which is exactly what the Telegram
  -- document handler does with a Telegram file id. Plain uuid[] rather than a join table
  -- or an FK — a message's attachments are ordered and are only ever read together.
  file_ids uuid[] not null default '{}',
  -- pending  → written by the browser, waiting for the bridge
  -- running  → claimed by the bridge, agent is working
  -- done     → an assistant row exists for it
  -- error    → the run failed; `error` says how, and the browser shows it
  -- An assistant row is written straight to 'done'; only a user row is ever queued.
  status text not null default 'done' check (status in ('pending', 'running', 'done', 'error')),
  error text,
  -- What the run cost and how long it took, so the web surface can eventually show what
  -- Telegram logs to costs.jsonl. Null on a user row.
  cost_usd numeric,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists ai_messages_thread_idx on ai_messages (thread_id, created_at);
-- Partial: the bridge's poll asks one question every few seconds — "is anything waiting" —
-- and this keeps that question off the full table for the entire life of the app.
create index if not exists ai_messages_pending_idx on ai_messages (created_at) where status = 'pending';

comment on table ai_threads is 'One web conversation with the CommandOS agent. Mirrors a Telegram forum topic: its own resumable Agent SDK session, its own history.';
comment on table ai_messages is 'Queue and transcript for the web AI hub. A user row lands as pending; apps/command/web_bridge.py claims it, runs the agent, and writes the assistant row back.';

/**
 * Hand the oldest waiting message to exactly one caller.
 *
 * `for update skip locked` is the whole point. Two bridge loops — a restart that overlaps
 * its predecessor by a second, or a second machine someone starts without thinking — would
 * otherwise both select the same pending row and both run the agent on it, and the user
 * would watch one question get answered twice, with the second answer built on a session
 * the first had already moved. The lock makes claiming a message a thing that can only
 * happen once, in the database, rather than a thing the Python is trusted to get right.
 */
create or replace function claim_ai_message()
returns ai_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed ai_messages;
begin
  update ai_messages
  set status = 'running'
  where id = (
    select id from ai_messages
    where status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning * into claimed;

  return claimed;
end;
$$;

alter table ai_threads enable row level security;
alter table ai_messages enable row level security;

-- No policies at all, on purpose. RLS with zero policies denies every anon and
-- authenticated request; the service role bypasses RLS and is the only credential that
-- ever touches these two tables. Every other table in this schema grants anon SELECT
-- because it holds a picture of a graph. This one holds instructions for a machine.

-- Supabase grants EXECUTE on every new function to anon and authenticated at creation
-- time, and a security-definer function bypasses the RLS above — so the grant, not the
-- policy, is the real gate here. Same reasoning as publish_canonical_snapshot in 0001.
revoke execute on function claim_ai_message() from public, anon, authenticated;
grant execute on function claim_ai_message() to service_role;
