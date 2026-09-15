// Server-only. The ONLY file outside Phase 2's own module allowed to import the
// resolver/parser, and (since 2026-09-03) the only file allowed to import the read-only
// Supabase canonical reader. Every UI surface (Server Component included) reaches
// COYOTE-derived data exclusively through this function — never through resolver.ts,
// parser.ts, or supabaseReader.ts directly. That's an architectural rule, not a
// convention: nothing under src/components/** imports from src/lib/coyote/** or
// src/lib/canonical/**.
//
// Two paths, selected by env, never both: when SUPABASE_URL + SUPABASE_ANON_KEY are set
// (the production/Vercel shape), this reads the already-published, already-validated
// canonical_* snapshot — it never touches the local filesystem and never re-parses raw
// COYOTE text, per the sync-architecture review's explicit rule ("Vercel/Next.js never
// touches raw COYOTE text"). Otherwise it falls back to the local resolver/parser path
// unchanged from Phase 2/3 — this is what keeps local dev working with no Supabase
// project at all, which is also the only path exercised by this repo's own test suite
// today (no live Supabase project is provisioned yet — see the implementation report).
// This is a request-time read either way, so a new canonical snapshot or a new local
// COYOTE file both show up on next request with no rebuild/redeploy.

import type { CanonicalConnection, CanonicalNode, Diagnostic } from "@/lib/types/canonicalNode";
import { resolveCoyoteSource } from "@/lib/coyote/resolver";
import { parseCanonicalNodes } from "@/lib/coyote/parser";
import { buildFullDiagnostics } from "@/lib/coyote/diagnostics";
import { fetchCanonicalGraphFromSupabase } from "@/lib/canonical/supabaseReader";

export interface CanonicalGraph {
  nodes: CanonicalNode[];
  connections: CanonicalConnection[];
  diagnostics: Diagnostic[];
  sourceError?: string;
}

async function getCanonicalGraphFromLocalResolver(): Promise<CanonicalGraph> {
  const result = await resolveCoyoteSource();
  if (!result.ok) {
    return { nodes: [], connections: [], diagnostics: [], sourceError: result.diagnostic.message };
  }
  const parsed = parseCanonicalNodes(result.source);
  return { nodes: parsed.nodes, connections: parsed.connections, diagnostics: buildFullDiagnostics(parsed) };
}

export async function getCanonicalGraph(): Promise<CanonicalGraph> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return getCanonicalGraphFromLocalResolver();
  }

  // Lazy import: keeps the Supabase client out of the local-dev path's module graph
  // when it's never going to be used — SUPABASE_URL/SUPABASE_ANON_KEY are checked above,
  // so createClient() is never called with missing/empty args either way.
  const { createAnonClient } = await import("@/lib/supabase/client");
  const client = createAnonClient(supabaseUrl, supabaseAnonKey);
  return fetchCanonicalGraphFromSupabase(client);
}
