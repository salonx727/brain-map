# brain-map

Salon X — Brain Work Surface. A Next.js port of the single-file
`salonx_brain_surface.html` prototype: a pan-and-zoom map of the eleven canon
engines and two intake nodes, with a derived 3D wire field.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run verify   # drives a real browser: write, reload, then read
```

## Layout

| Path | What lives there |
| --- | --- |
| `app/globals.css` | canon tokens and every component style |
| `lib/seed.ts` | the transcribed sheet: shapes and starting positions only |
| `lib/adapter.ts` | Supabase rows in, the surface's own model out |
| `lib/brain.tsx` | every write intent, one Server Action each |
| `app/actions/pm.ts` | the only place the service-role credential exists |
| `lib/graph.ts` | counts, collision, free-slot placement |
| `components/BrainSurface.tsx` | the flat map: pan, zoom, drag, lock |
| `components/ControlPanel.tsx` | the five tabs on a card |
| `components/Field3D.tsx` | the derived 3D field |

## Where the map comes from

Nothing is held in the browser. The surface is read per request from the
canonical COYOTE mirror plus the PM layer, and every edit goes back the same
way — one Server Action per kind of change, never a whole-model blob, because a
to-do, a wire and a position are separate rows with separate lifetimes.

That split decides what a card will let you do:

- **A canonical card is COYOTE's.** Its name and ref are read, never written,
  and it has no delete. To-dos, files, wires, colour and position attach to it
  freely — those are PM rows that point at the node, not the node itself.
- **A wire needs at least one PM endpoint.** Two canonical engines are joined by
  COYOTE or not at all, and a database trigger enforces it. A COYOTE-declared
  edge shows as CANON and has no remove button.
- **Removing a card is permanent.** It clears the node's items, notes and files,
  including the bytes in Storage, so there is no undo offered — the two-tap
  confirm is the guard.

## Rulings this port keeps

- **An arrangement stays put.** A dragged card writes its position when the
  finger lifts. If the map cannot be read, the surface says so and changes
  nothing — it never silently substitutes the seed.
- **No Control X.** §37's minus-only dismissal is platform canon for client
  surfaces; this internal tool does not inherit it. A tap opens a card.
- **The card name holds a constant screen size.** Below 55% zoom everything
  else fades out rather than shrinking, so the overview stays readable.
- **Files are stored, and stored privately.** Bytes go to a bucket with no anon
  read policy and reach the browser only through a signed link, minted per page
  load. The prototype's session-only data URLs are gone.

## Fixed in the port

Four defects in the original prototype were called but never defined, or
declared but never wired:

- `other()` — threw on every frame once a node was focused in the 3D field
- `showWire()` — undefined, so SHOW ON FIELD threw
- `.slot` / `.intake` / `.thumb` / `.minus` — emitted by the script with no CSS
- `l.back` — never set, so the one backward edge (§35.8 `badge_awarded`) was
  counted as forward. Setting it changes the derived field layout, which is now
  acyclic as the code comment intends.
