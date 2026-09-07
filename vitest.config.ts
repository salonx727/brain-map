import { defineConfig } from "vitest/config";
import path from "node:path";

// Unlike `npm run sync:coyote` (tsx --env-file=.env), vitest has no built-in .env
// loading for process.env — without this, COYOTE_LOCAL_DIR and the Supabase creds
// never reach the integration tests, regardless of what's in .env. Silently ignored
// if .env doesn't exist (CI, or a fresh checkout before first setup): those tests are
// meant to skip/fail loudly on missing credentials, not on a missing loader.
try {
  process.loadEnvFile();
} catch {
  // no .env present — fine, see above
}

// Mirrors tsconfig.json's "@/*" -> "./*" path alias — vitest doesn't read tsconfig paths
// on its own, and this workspace has no tsconfig-paths plugin installed, so the mapping
// is restated here rather than adding a dependency for one alias. This app keeps its
// source at the repository root (lib/, app/, components/) rather than under src/, so the
// two aliases must agree on the root or every "@/..." import in a test fails to resolve.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
});
