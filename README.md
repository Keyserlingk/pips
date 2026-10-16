# Custom Pips

A Pips-style domino logic puzzle: play generated puzzles, or design your own board and let the app generate the dominoes.

## Run locally

Requires Node 18+.

```bash
npm install
npm run dev        # → http://localhost:5173
```

Other scripts: `npm test` (engine tests), `npm run build` (static build in `dist/`), `npm run preview`.

## How it works

- **Play** – drag dominoes from the tray onto the board, tap to rotate. Every region must satisfy its badge:
  a number = sum equals, `<N` / `>N` = sum less/greater than, `=` all equal, `≠` all different.
- **Create** – draw the board cells, optionally paint regions and set constraints, then press **Generate**:
  - *Everything automatic* – regions, constraints and dominoes are generated.
  - *My regions, auto constraints* – your regions are kept.
  - *My regions & constraints* – searches for a domino set that satisfies your rules.
- Options: double-six or double-nine set, allow duplicate dominoes, require a unique solution.
- Puzzles are stored in the browser (`localStorage`); share them with **Copy link** or **Export JSON**.

## Project layout

```
src/model/    puzzle types, helpers, storage, share-link encoding
src/engine/   solver, tiling, random shapes, generator (runs in a Web Worker)
src/ui/       board, play, editor and home screens
src/styles/   themes.css (all colours) + app.css (layout)
```

## Themes

All colours are CSS variables in `src/styles/themes.css`. To add a theme, copy one of the
`[data-theme='…']` blocks, change the values, and add an entry to `src/styles/themes.ts`.
