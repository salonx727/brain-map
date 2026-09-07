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
| `lib/seed.ts` | the transcribed sheet: 13 nodes, 21 edges, sample content |
| `lib/store.ts` | localStorage persistence |
| `lib/graph.ts` | counts, collision, free-slot placement, image intake |
| `components/BrainSurface.tsx` | the flat map: pan, zoom, drag, lock |
| `components/ControlPanel.tsx` | the five tabs on a card |
| `components/Field3D.tsx` | the derived 3D field |

## Rulings this port keeps

- **An arrangement stays put.** Only an explicit RESET undoes it. If a stored
  layout cannot be read, the surface says so and changes nothing — it never
  silently substitutes the seed.
- **No Control X.** §37's minus-only dismissal is platform canon for client
  surfaces; this internal tool does not inherit it. A tap opens a card.
- **The card name holds a constant screen size.** Below 55% zoom everything
  else fades out rather than shrinking, so the overview stays readable.
- **Images are deliberately not stored.** Filenames and sizes persist; the
  pictures do not, because a few phone photos would exhaust the quota and evict
  the arrangement.

## Fixed in the port

Four defects in the original prototype were called but never defined, or
declared but never wired:

- `other()` — threw on every frame once a node was focused in the 3D field
- `showWire()` — undefined, so SHOW ON FIELD threw
- `.slot` / `.intake` / `.thumb` / `.minus` — emitted by the script with no CSS
- `l.back` — never set, so the one backward edge (§35.8 `badge_awarded`) was
  counted as forward. Setting it changes the derived field layout, which is now
  acyclic as the code comment intends.
