-- Which deployment queued a message, and which deployments the bridge will answer.
--
-- 0008 turned the bridge OFF by default and said why in its own header: the map is served
-- to the public internet with no authentication, and the bridge connects it to an agent
-- holding Bash on Shawn's machine under permission_mode="bypassPermissions". That left the
-- flag as the only control, and it is an all-or-nothing one — turning it on to use the hub
-- locally also opens it to every anonymous visitor of salonx-mind-map.vercel.app, because
-- both deployments write to this one queue and `claim_ai_message()` never asked where a
-- row came from.
--
-- So it asks now. Each deployment stamps its own `origin` from a server-side env var the
-- browser never sees, and the bridge claims only the origins it was configured to trust.
-- Local is trusted; the public deployment is not, and its rows sit unclaimed until it has
-- a login in front of it. A visitor cannot forge the value: `ai_messages` grants nothing
-- to anon (0008), so the only way to insert is through a Server Action holding the service
-- role, and the Action stamps the origin from the environment, not from the request.
--
-- This is a narrowing, not a replacement for authentication. When auth lands in front of
-- the map, add `vercel` to the bridge's allowlist and the public hub comes alive.

alter table ai_messages add column if not exists origin text;

comment on column ai_messages.origin is
  'Deployment that queued this row, from BRIDGE_ORIGIN. Set server-side; never supplied by the browser. Null means it predates 0013.';

-- Rows written before this migration came from the local map during bridge verification
-- (0008''s note records those runs) and from nowhere else — the bridge has never been on
-- outside that. Naming them keeps the allowlist honest instead of carrying a null case
-- forward that would have to be treated as trusted.
update ai_messages set origin = 'legacy' where origin is null;

-- The zero-argument form has to go rather than be left beside the new one: an overload
-- that claims everything is exactly the hole this migration exists to close, and
-- PostgREST would happily resolve an argument-less POST to it.
drop function if exists claim_ai_message();

/**
 * Claim the oldest pending message from a trusted origin, or return an empty row.
 *
 * `for update skip locked` carries forward from 0008 for the same reason: two bridge
 * loops — a restart overlapping its predecessor, or a second machine someone starts
 * without thinking — would otherwise both run the agent on one message.
 *
 * The default is restrictive on purpose. A caller that forgets to pass an allowlist gets
 * local-only, never everything, so the failure mode of an un-updated bridge is "answers
 * nothing it should not" rather than "answers the internet".
 */
create or replace function claim_ai_message(p_origins text[] default array['local'])
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
      and origin = any(p_origins)
    order by created_at
    limit 1
    for update skip locked
  )
  returning * into claimed;

  return claimed;
end;
$$;

-- Same reasoning as 0008 and as publish_canonical_snapshot in 0001: Supabase grants
-- EXECUTE to anon and authenticated at creation time, and a security-definer function
-- bypasses RLS, so the grant is the real gate.
revoke execute on function claim_ai_message(text[]) from public, anon, authenticated;
grant execute on function claim_ai_message(text[]) to service_role;

create index if not exists ai_messages_pending_origin_idx
  on ai_messages (origin, created_at)
  where status = 'pending';
