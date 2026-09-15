// Drops the cached surface so the next visitor gets a fresh render.
//
// The page is served from the CDN now, and every edit made through the app already busts
// that cache from inside a Server Action. A new COYOTE snapshot does not: it is published
// by scripts/sync-coyote.ts from a terminal, which has no way to reach into the running
// deployment. This route is that way in, and sync-coyote calls it the moment it publishes.
//
// POST, and a secret. A GET anyone could stumble into would let a stranger force a
// regeneration on every request and turn the cache back into the per-visit render this
// replaced.

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "REVALIDATE_SECRET is not set on this deployment." }, { status: 503 });
  }
  // Compared against a header rather than a query string so it stays out of access logs.
  if (request.headers.get("x-revalidate-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  revalidatePath("/");
  return NextResponse.json({ ok: true, revalidated: "/", at: new Date().toISOString() });
}
