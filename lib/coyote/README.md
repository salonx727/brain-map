# COYOTE resolver + parser (Phase 2 — implemented)

Server-only. `resolver.ts` resolves the current COYOTE file the same way
`context/coyote-index.md` does (newest by mtime, excluding patch/undersized files — never
a hardcoded filename). `parser.ts` turns the raw text into `CanonicalNode[]` +
`Diagnostic[]` — pure, no I/O. `nodeRegistry.ts` holds the fixed `node_key` identity list
(`engine:E01`–`E11`, `screen:S0`–`S5`, `microsite:main` reserved/unimplemented).

No client boundary, API route, or Supabase wiring yet — that's Phase 3+. Nothing in this
folder may be imported by a client component.
