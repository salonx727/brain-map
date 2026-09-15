// Shared Supabase client options for every server-side read/write in this app.
//
// Two things here, both confirmed live as the refresh hang (2026-09-13):
//
// 1. Next.js patches `fetch` and caches GET by default. supabase-js speaks HTTP GET.
//    A refresh can sit on a cached/deduped request that never resolves, which is the
//    "site cannot be reached" after 1–2 minutes — the function never sent a byte.
//    `cache: "no-store"` turns that off.
//
// 2. supabase-js has no request timeout. A Supabase gateway blip (the same
//    "Gateway Timeout" that 500'd `/` today) would wait until Vercel or the browser
//    dropped the connection.
//
// The budget is per method, not per client, because the two kinds of request have
// nothing in common. A read is a PostgREST GET and seven seconds is already generous —
// short enough that withRetry's second attempt still lands inside one page request. A
// write is a POST, and so is a Storage upload: a photo off a phone legitimately takes
// longer than any query, and cutting it at the read budget would fail uploads that were
// working fine.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const READ_MS = 7_000;
const WRITE_MS = 30_000;

export function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD";
  const timeout = AbortSignal.timeout(isRead ? READ_MS : WRITE_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  // Nothing is said about caching here, deliberately, so each route decides for itself:
  // `/` sets a revalidate window and its reads are cached behind the CDN with it, while a
  // Server Action or /api/health runs dynamically and gets Next 15's uncached default.
  //
  // Pinning `cache: "no-store"` — as this file did when the only goal was stopping a hung
  // refresh — opts a route out of static rendering on contact, and it applied to writes
  // too. One POST for a signed image URL was enough to force the whole surface to render
  // per request. Next never caches a POST anyway, so the setting bought nothing and cost
  // the cached surface entirely.
  return fetch(input, { ...init, signal });
}

function options() {
  return {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseFetch },
  };
}

export function createAnonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, options());
}

export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, options());
}
