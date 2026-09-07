// The one place the PM write path constructs a Supabase client. Service-role only —
// never imported by anything under src/components/** or any Client Component. Every
// Server Action in src/app/actions/pm.ts calls this, never `createClient` directly, so
// there is exactly one place to audit for "does this ever run in the browser."

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createPmServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("createPmServiceClient: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set — PM writes require Supabase to be configured.");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}
