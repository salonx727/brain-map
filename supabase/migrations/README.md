# Supabase migrations

`0001_canonical_layer.sql` (2026-09-03) — the canonical read model only:
`canonical_snapshots` / `canonical_nodes` / `canonical_connections` / `canonical_sync_state`,
plus the `publish_canonical_snapshot` function that is the sole write path onto them.
Written only by `src/lib/canonical/publisher.ts`, running locally, never by the Next.js
app. `canonical_snapshots.diagnostics` carries the full `Diagnostic[]` for that candidate so
the Supabase-backed read path (`src/lib/canonical/supabaseReader.ts`, read by
`getCanonicalGraph.ts` only) can render Phase 3's Global Diagnostics Tray identically to the
local dev path. Includes an explicit `revoke`/`grant execute` on both functions — a
`security definer` function bypasses RLS on the tables it touches, so the real gate against
an anon-key caller is the EXECUTE grant, not the table policies; Supabase's own bootstrap
grants EXECUTE on every new function to `anon`/`authenticated` by default, so this has to be
revoked explicitly.

**Applied and live** (2026-09-03, provisioned project, verified via
`src/lib/canonical/liveSupabase.integration.test.ts` — 6/6 passing with real credentials,
plus a manual pass in `scripts/verify-live-supabase.ts`): publish, duplicate-hash no-op,
invalid-candidate rejection with rollback, RLS-denied anon writes, RLS-denied anon RPC calls,
and a running (unrebuilt) Next.js process picking up a new snapshot with zero redeploy all
confirmed against the real database, not just unit tests. `npm run sync:coyote` is the
manual sync entrypoint; a scheduled/bot-triggered mechanism is still an open call.

`0002_pm_layer.sql` (2026-09-03) — the writable PM layer: `pm_people`, `pm_nodes`
(custom sub-nodes/functions, never canonical), `pm_items` (todos + blockers), `pm_notes`
(notes + decisions), `pm_references` (Figma/wireframe/UI-slot links), `pm_files`
(upload metadata; bytes live in the private `pm-files` Storage bucket), `pm_layouts` /
`pm_layout_positions` (position + colour only — no lock column, layout lock is
session-only per Shawn's ruling and never persisted), `pm_node_links` (connections with
at least one PM-created endpoint, enforced by a trigger, not app code). Same RLS shape
as 0001: anon reads everything, writes everything through the service-role credential
only, applied server-side in `src/app/actions/pm.ts` via `src/lib/pm/pmWriter.ts`. No
canonical COYOTE content, no hard-coded Modules/Stages enums — taxonomy stays unruled.
Never shares a table with `0001_canonical_layer.sql`; `pm_nodes`/other `node_key`
columns reference a canonical or PM key as plain text, never a cross-schema DB FK.

**Applied and live** (2026-09-03, same provisioned project, verified via
`src/lib/pm/pmLayer.integration.test.ts` — 11/11 passing with real credentials):
todo/blocker create + status update, note/decision create, reference links, PM sub-node
creation under a canonical parent, PM-node-link creation, the canonical-canonical-link
trigger rejection, layout position upsert (confirmed no `locked` field), Master TODO as
a filtered query (no new table), a real Storage upload through UNSORTED → assign-to-node,
and RLS-denied direct anon writes on `pm_people`/`pm_items`. Test-created rows were
removed after verification; the one seeded `pm_layouts` "Default" row was kept — it's
real data going forward, not test residue.

`0003_ui_slots.sql` · `0004_pm_node_display_ref.sql` ·
`0005_canonical_connections_backward_flag.sql` · `0006_pm_node_state.sql`
(2026-09-05 → 09-07) — see each file's own header for what it does and why.

**Applied and live** (2026-09-07, all four, same project, `scripts/apply-migration.mjs`):
the full suite passes against the real database afterwards — 100/100, including both
live-Supabase integration files.

**Why they sat unapplied for two days, since it cost a debugging session to find:** they
were written, committed, and covered by tests, and nothing anywhere failed loudly enough
to say so. `0005` adds `canonical_connections.backward`, which `supabaseReader.ts`
selects by name — and that read is one of three in a `Promise.all` whose error branch
returns `{ nodes: [], connections: [] }`. So a single missing column emptied the entire
graph, **nodes included**, and both `/` and `/v2` rendered a blank map that looked like a
map with nothing on it rather than a map that could not be read. The `sourceError` was
carried correctly the whole time; the pages showed it, but the AI hub's `buildAiContext`
was dropping it, which is fixed in the same commit as this note.

**The lesson worth keeping:** this file is the only record of what is actually applied,
and it is hand-maintained. An entry missing here is indistinguishable from a migration
that was never written. Add the "Applied and live" line in the same session you run the
migration, not later.
