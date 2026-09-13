/**
 * Retries a read once on a transient failure — the same Supabase gateway timeout pattern
 * confirmed live three times now (2026-09-11, twice on 2026-09-13): a one-off blip that a
 * second attempt 800ms later almost always clears. First used for the AI hub's own
 * queries (lib/ai/bridge.ts); this is the shared version for the page-load path
 * (getCanonicalGraph / getWholeBoardPmLayer / getLayout), which had no retry at all and
 * crashed the whole map — not just one panel — on the same kind of blip.
 *
 * Only ever wrap a read. A write retried blindly on "the server didn't answer in time"
 * can't tell "it never ran" from "it ran and the response was lost," and doubling it
 * silently is worse than surfacing the failure.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 800): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
