# River Guide

A river-trip planning app: a library of rivers plus any number of trips on them.
Trips (itinerary, crew & crafts, meals, gear, shuttle, ledger, log) are saved
separately and each belongs to a river; the River tab shows map, rapids, camps,
hikes, geology, guide, almanac and rules for the river you pick. Built-in
rivers: Grand Canyon (full data), Smith River and Rogue River (starter records
- reach and put-in/take-out only; fill in the rest in the app).

Add or edit rivers in **River -> Rivers** (form editor, or paste/import river
JSON; "Copy JSON" exports one). Rivers you add or edit are stored with your
trips (localStorage, and the shared db when available).

## Layout

- `src/App.jsx` - the whole app (React, single file)
- `src/rivers.js` - river library (built-ins + `normalizeRiver`)
- `src/shell.html` - page shell: fonts, textures, all CSS, `<div id="root">`
- `data/rivers/*.json` - built-in river records
- `data/gear.json`, `data/general.json`, `data/trip.json` - gear catalog, safety reference, seeded Grand Canyon trip
- `build.mjs` - bundles `App.jsx` with esbuild, inlines it into the shell and wraps it in a full HTML document -> `index.html`
- `index.html` - **generated**; this is what GitHub Pages serves. Do not edit by hand.

## Build

    npm install
    npm run build

## River record shape

`name`, `reach`, `agency`, `miles: [start, end]`, `coords: [lat, lon]` (put-in, for
sunrise/sunset), `tz`, `days` (typical trip length), `access[]` (put-ins,
take-outs, hubs: `{name, mile?, road?, hub?, park?, note?}`), and optional
`rapids[]`, `camps[]`, `hikes[]`, `geology[]`, `guide[]`, `almanac{}`, `rules[]`,
`landmarks[]`, `clusters[]`, `notes{camp,hike}`, `hdiff{}`, `roads[]`. See
`data/rivers/grand-canyon.json`. Missing fields are filled in by `normalizeRiver`.

## Data notes

- Trips have a `river` field (river id); trips without one are Grand Canyon.
- The seed trip is written to localStorage once, guarded by the key
  `riverguide.v1.seed2`. If you change the seed trip's shape, bump that key.
- Access points get ids `r0, r1, ...` by position in `access[]`; trips refer to
  launch/take-out by those ids, so append rather than reorder.

## Grand Canyon 2026 trip data

`data/trip.json` (crew, boats, cars, gear with per-person quantities, menu, payments, day notes) and
`data/trips/gc2026-ref.json` (read-only Info tab: constraints, camp jobs, Ceiba Q&A, shopping list,
Crew Council agendas and minutes, education plan, and the sunrise-to-sunrise sky log shown on each
Itinerary day) were generated from the planning spreadsheet. Course logins from the sheet are
deliberately not copied. Seed key `riverguide.v1.seed5`: a never-edited seeded trip is replaced; an
edited one keeps its data and only gets the sheet's gear, menu, payments and day notes where empty.
Trip > Trip > "Reload planning-sheet data" replaces everything from the seed.
