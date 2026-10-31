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

## Duels across strict networks (TURN relay)

Duels connect the two browsers directly. When a network blocks that (common on mobile
data and some ISPs), they fall back to a Cloudflare TURN relay. The relay logins come from a
small Cloudflare Worker in `turn-worker/`, so the API token never reaches the browser.

The Worker also caps relay traffic: every 15 minutes it reads this month's TURN usage from
Cloudflare's analytics, and once it passes `CAP_GB` (500 GB, in `turn-worker/wrangler.toml`; the
first 1,000 GB a month are free) it stops handing out relay logins until next month and emails
you once, through [Resend](https://resend.com).

One-time setup:

1. **Cloudflare TURN key:** in the Cloudflare dashboard, open **Realtime → TURN Server** and create
   a key. Note the **Key ID** and **API token**.
2. **Analytics token:** under **My Profile → API Tokens**, create a custom token with the
   permission **Account → Account Analytics → Read**. Also note your **Account ID** (shown on the
   dashboard home page).
3. **Resend:** sign up free at resend.com and create an API key. Alerts go to the address you
   signed up with.
4. **Deploy the Worker** (opens a browser login the first time):
   ```bash
   cd turn-worker
   npx wrangler kv namespace create USAGE      # paste the printed id into wrangler.toml
   npx wrangler deploy
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_ANALYTICS_TOKEN
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put NOTIFY_EMAIL
   ```
5. Put the Worker address that `wrangler deploy` printed into `.env`:
   `VITE_TURN_URL=https://pips-turn.<your-subdomain>.workers.dev`, then commit and push.

The Worker only answers requests from the sites listed in `ALLOWED_ORIGINS` in
`turn-worker/wrangler.toml`. Without `VITE_TURN_URL`, duels use direct connections only.
