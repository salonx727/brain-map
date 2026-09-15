<!--
  PROPOSED AMENDMENT TO §15 — generated 2026-09-13 from X_09-09_0900_Coyote.md
  47 blockers, each given a stable id. Text, order, subheadings and the
  classification table are unchanged — only the "**BLK-NNN** · " prefix is added.

  Ids are permanent once ruled. They carry no section number on purpose, so a future
  resequencing fold cannot orphan the state attached to them.

  Replace §15 in COYOTE with everything below this comment block.
-->

## §15 — Open Build Items

### Launch Blockers — Must resolve before any user onboards

- **BLK-001** · dropQueue uses Pool A connection — fix one line in drop_engine.js
- **BLK-002** · RAMP worker appointment-complete subscription — remove from ramp_worker.js
- **BLK-003** · workers_index.js — register session_close_worker, remove stale registrations
- **BLK-004** · ~SKINZ_DEPLOY_ENABLED env flag — add to skinz_cron.js, set false pre-launch~ → MOVED TO V2 PREP (LOCK-260604-019). Flag stays false; no longer a V1 launch blocker. V1 co-brand = manual partner upload to Stage/SET/Build Station.
- **BLK-005** · Signup intake rate limiter — Redis counter on onboarding endpoint
- **BLK-006** · /api/sync/intents endpoint — implement server-side sync route

### High-Risk — Resolve before Day 14

- **BLK-007** · tag_attribution_chains.scoring_eligible field
- **BLK-008** · Overnight-batch workers: set to 8
- **BLK-009** · note_save conflict detection: restore ±15 min
- **BLK-010** · Low-priority queue: shift start to midnight EST

### Remaining Pre-Launch Build

- **BLK-011** · Ghost Notes S2 route: implement cache-first read
- **BLK-012** · RAMP mobile UI: post confirmation tap on device screen
- **BLK-013** · skinz_cron.js: batched deployment 500/min + rollback
- **BLK-014** · DLQ alert routing: Twilio SMS or email to on-call
- **BLK-015** · session-close step failures: wire to deferred_queue_log
- **BLK-016** · Launch day runbook: define who controls each operational lever
- **BLK-017** · Vish API integration · Phase 0/1 · STATUS: PLANNED

### V1 Founding Window Build (Pre-Launch)

- **BLK-018** · founder_registry table + seed with 169 Founders
- **BLK-019** · referral_key table + key issuance service
- **BLK-020** · Branded Referral Key metadata embedded in referral links
- **BLK-021** · Tribe Convergence detection at signup
- **BLK-022** · Tribe Alignment screen + permanent attribution write
- **BLK-023** · founding_window:status Redis key + automatic Day 120 flip

### V1 / V2 Classification Updates (Jul 27, 2026)

|Item                    |Prior classification|New classification                        |Basis          |
|------------------------|--------------------|------------------------------------------|---------------|
|THE WIRE                |V2                  |V1                                        |LOCK-260727-022|
|NEXUS                   |Unclassified        |V1 (2D) / V2 (3D)                         |LOCK-260727-023|
|SKINZ automated morphing|V2+                 |V2+ — unchanged                           |LOCK-260604-019|
|Care Card RCS delivery  |Unspecified         |V1                                        |LOCK-260727-027|
|Node value scoring      |Unspecified         |V1 (behavioral KPIs) / V2 (economic layer)|LOCK-260727-031|
|Referral Gratitude Gate |Unspecified         |V1                                        |LOCK-260727-028|

### V1 Build Additions (Jul 27, 2026 — not yet in code)

- **BLK-024** · THE WIRE / SIGNAL v2 — hierarchical broadcast, permission ceiling per tier (gated by Q-IDENTITY-AUTH-SPEC)
- **BLK-025** · NEXUS V1 — 2D own-downline overnight snapshot, tap-node stats, SKINZ tribe color per node
- **BLK-026** · Identity architecture — UUID anchor, E.164 phone surface, phone+name disambiguation, claimed/unclaimed client node states
- **BLK-027** · Care Card / Cube split — RCS primary, MMS fallback, single hyperlink, zero promotional content in-message
- **BLK-028** · Referral Gratitude Gate — GHOST NOTES brief lock at new-client arrival; referring-client appointment unlock
- **BLK-029** · Node value scoring — behavioral KPI baseline, daily recalculation, configurable weighting, partner-custom KPI mode

### V2 Open Items

- **BLK-030** · OFFGRID headline build (full native app, tiered sync, Path A AI pre-gen, per-technician inventory, Stripe Connect offline, expanded /api/sync/intents, provisional booking, regional parents)
- **BLK-031** · Multi-tenant sublease model · booth rental infrastructure
- **BLK-032** · MUSE V2: hierarchy dashboard + individual KPI
- **BLK-033** · CO-OP MODE dual attribution schema
- **BLK-034** · TAG creative gravity scoring — 6 months with Table of Eight data
- **BLK-035** · Performance-based commission tiers
- **BLK-036** · SKINZ international deployment windows
- **BLK-037** · Tokenization + Rewards (container built, mechanic ships V2)
- **BLK-038** · NEXUS V2 — 3D, real-time, full platform view, brand-scope traversal
- **BLK-039** · Node value scoring — economic layer (behavioral baseline ships V1)
- **BLK-040** · Care Card product-highlight surface on salon tablet at checkout
- **BLK-041** · Magic Selfie Loop pipeline (pending Q-SELFIE-PLACEMENT)
- **BLK-042** · RAMP V3 Build Station counter (pending Q-BUILD-STATION-COUNTER)
- **BLK-043** · MICROSITE cube spec (§03d, pending Q-MICROSITE-CUBE-SECTION)
- **BLK-044** · TAG human-momentum capture fields
- **BLK-045** · Oracle Face live cognition surface build
- **BLK-046** · Salon OS control-panel labeling pass
- **BLK-047** · §03d cube spec absorption of Oracle Face visual model

-----

