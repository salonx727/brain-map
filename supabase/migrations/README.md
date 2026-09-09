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

`0007_publish_force_flag.sql` (2026-09-07) — adds `p_force` to `publish_canonical_snapshot`
so a parser change can republish a byte-identical source. See the file's own header.

`0008_ai_bridge.sql` (2026-09-08) — `ai_threads` / `ai_messages`, the queue that lets the
map's AI hub talk to the CommandOS agent, plus `claim_ai_message()`. Unlike every other
table here, **neither grants anything to anon**: they hold instructions for a machine
rather than a picture of a graph, and the map has no authentication in front of it yet, so
all access goes through Server Actions holding the service-role key. `claim_ai_message()`
uses `for update skip locked` so two bridge processes cannot answer the same message twice.

**Applied and live** (2026-09-08, same project, `scripts/apply-migration.mjs`): verified
end to end with the bridge running — `scripts/verify-brain-chat.mjs` (a vault question
answered with file-and-line citations), `scripts/verify-brain-file.mjs` (a file uploaded
in the browser, read off disk by the agent), and `scripts/verify-brain-supabase.mjs` (the
agent reading the live snapshot back out of Postgres). Probe rows removed afterwards with
`scripts/purge-bridge-probes.ts`.

`0009_ruling_layer.sql` (2026-09-09) — `pm_rulings`, the queue every map-drawn card lands
in, plus `retire_pm_node_into_canonical()`. Shawn's ruling that day: a card created on the
map never reaches canon on its own; it opens a ruling on his owner card, he rules it in the
brain and writes COYOTE himself, and once the sync publishes the canonical node a human
confirms the match and the PM row is folded into it. The function re-points
items/notes/references/files/positions/state/children onto the canonical key, deletes links
that would become canonical-to-canonical (0002's endpoint trigger is correct to refuse
those — COYOTE declares them), then deletes the `pm_nodes` row. It reads `canonical_nodes`
to validate the target and writes no canonical table. Matching is a suggested label match
plus a confirming tap, never automatic: COYOTE carries no map-generated identifier because
Shawn rules in his own language, and a wrong retirement would delete real work.

**Applied and live** (2026-09-09, same project, `scripts/apply-migration.mjs`): 129/129 pass
afterwards, including both live-Supabase files, and `scripts/verify-ruling-flow.mjs` confirms
end to end against a running server that a drawn card opens a ruling, wears the marker, is
offered the four §35 intent fields, appears in the queue on Shawn's card, offers no APPROVE
button, and withdraws its ruling when the card is removed.

**One thing the backfill exposed, worth keeping:** `purge-test-rows.ts` and
`purge-placeholder-cards.ts` delete `pm_nodes` directly rather than through
`pmWriter.deletePmNode`, so neither knew to withdraw a ruling. The first run after this
migration put 25 rulings for long-deleted test cards straight into Shawn's queue — the one
list in this app that a person works through by hand, so junk there costs real turns. Both
scripts now clear `pm_rulings` too. Any future script that deletes a `pm_nodes` row must do
the same.

`0010_connection_rulings.sql` (2026-09-09) — the same ruling flow, extended from cards to
**wires**, plus `canonical_connections.evidence_class`.

Shawn's operator that afternoon: a wire drawn on the map is an assertion about §35, so it
goes to Shawn exactly as a card does. Four things follow from that, and each is in the
migration:

- `pm_node_links.relation` — which §35 field the wire asserts (`downstream` / `reads` /
  `emits` / `trigger`). Picked in the UI, never defaulted. The four fields do not all run
  the same way (DOWNSTREAM and EMITS are written on the source's card, READS and TRIGGER on
  the target's), so `lib/pm/coyoteText.ts` mirrors `lib/coyote/extractors/connections.ts`
  exactly when it writes the paste-ready block. A block headed with the wrong engine would
  parse back as a *backwards edge* on the next sync — the app causing a canon error through
  a person, which no amount of read-only discipline elsewhere would undo.
- `pm_rulings.kind` (`node` | `link`) with `from_node_key` / `to_node_key` / `relation` /
  `link_id`, and `node_key` made nullable. The one-pending-per-node index is now filtered to
  `kind = 'node'`, with a matching one-pending-per-edge index for links.
- **0002's endpoint trigger is narrowed, not dropped.** Engine-to-engine still cannot be
  written freely — it is allowed only while an open ruling covers that exact edge. §35
  remains the sole author of engine-to-engine data flow; what changed is that a human can
  now propose one and have Shawn rule on it, instead of the database refusing the row and
  the map silently losing the observation.
- `propose_connection()` and `retire_link_ruling()` — link and ruling created and destroyed
  together, in one statement each. `retire_pm_node_into_canonical()` no longer deletes a
  typed wire that would become engine-to-engine on retirement; it opens a new link ruling
  for it, because that wire is a claim somebody made and deleting it silently loses it.

**Wire retirement is automatic; card retirement still is not, and that asymmetry is
deliberate.** A card matches on a label Shawn rewrote in his own words, so it needs a
confirming tap. An edge matches on two node keys, which are exact, so `sync-coyote.ts`
retires it as soon as canon carries it — no queue entry survives a ruling he already made.

`evidence_class` (`declared` | `inferred`) records *how* the parser derived a canonical
edge: `declared` when the source's own DOWNSTREAM/EMITS/TRIGGER names the target,
`inferred` when only the target's READS names the source. On the current COYOTE that is 19
declared and 3 inferred (TAG→SIGNAL, TAG→AFTERBURNER, AFTERBURNER→NEXUS). It is drawn
differently in the field and **does not gate retirement** — Shawn's operator, 2026-09-09:
for "does canon already carry this connection", the two do the same work.

**Applied and live** (2026-09-09, same project, `scripts/apply-migration.mjs`): 143/143 pass
afterwards including both live-Supabase files, `npm run sync:coyote -- --force` republished
cleanly reporting 19 declared / 3 inferred, and `scripts/verify-connection-ruling.mjs`
confirms end to end that an engine-to-engine wire is offered (marked RULING rather than
refused), that the roster is unreachable until a relation is picked, that the ruling reaches
Shawn's card carrying a §35 block headed with the *source* engine for a DOWNSTREAM, and that
REJECT withdraws both the ruling and the wire.

**The 0009 lesson repeated itself immediately, in a place that had not been checked:**
`pmLayer.integration.test.ts`'s own `afterAll` also deletes `pm_nodes` directly, so every
`npm test` run had been leaving five rulings behind for cards it had just deleted. Fifteen
had accumulated across three runs. The cleanup now clears `pm_rulings` too, and
`scripts/purge-orphan-rulings.ts` exists to find any that get past it —
`scripts/peek-rulings.ts` shows the queue with orphans marked. **Any code path that deletes
a `pm_nodes` row must withdraw its rulings, including test cleanup.** Both kinds: a card's
own ruling is keyed on `node_key`, a wire's is keyed on the two endpoints and has no
`node_key` at all, so one delete cannot reach both.

**And a third instance of the same shape, found the same afternoon by looking at a
production screenshot rather than at a test:** a real card ("Blink") had gone from the
queue. `deletePmNode` cleared items, notes, references, files, links, state and the ruling —
but never `pm_layout_positions`, so every card ever deleted through the app left its
position behind. Five had accumulated since 09-08. Nothing renders them, which is exactly
why nothing caught them. Fixed in `pmWriter.deletePmNode`, asserted directly against the
table in the integration test (the read layer does not expose positions per node, so the
leak was invisible through it), and `scripts/purge-orphan-positions.ts` clears the backlog.
`scripts/verify-ruling-flow.mjs` had a matching hazard: it identified the card it had just
created as `.node.awaiting.last()`, which is DOM order, not creation order — so it could
delete one of Shawn's real cards while its own survived, and every count it prints would
still balance. It now diffs against the keys captured before the ADD and refuses to delete
anything that was already there.

**The lesson worth keeping:** this file is the only record of what is actually applied,
and it is hand-maintained. An entry missing here is indistinguishable from a migration
that was never written. Add the "Applied and live" line in the same session you run the
migration, not later.
