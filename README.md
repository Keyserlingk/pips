# Custom Pips

A Pips-style domino logic puzzle: play generated puzzles, or design your own board and let the app generate the dominoes.

## Run locally

Requires Node 18+.

```bash
npm install
scripts/serve.sh             # or: npm run serve   → http://localhost:5173, reloads as you edit
scripts/serve.sh --preview   # the production build, as it will be published (port 4173)
scripts/serve.sh --phone     # also reachable from phones on this Wi-Fi (prints a QR code to scan)
```

Ctrl+C stops it. Without `--phone` only this computer can open it. With `--phone` it listens on the
Wi-Fi address only, not on VPNs or other networks this computer is on; open it at that address here too.
A development server is meant for trying things out: don't leave one running on networks you don't trust.

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
- Random puzzles are shared as a short **seed link** (`#/s/1.h.2k9f8a.1x7k2q`: generator version, level,
  seed, fingerprint); the receiver regenerates the puzzle. **Share ▾ → Copy full puzzle link** sends the
  whole puzzle instead. Bump `GENERATOR_VERSION` in `src/engine/version.ts` whenever the generator starts
  making different puzzles from the same seed (a test in `src/model/seedLink.test.ts` catches this).
- **History** keeps every solved game (not ones finished with Reveal) with its time and an optional 1–5 star
  rating, under a GitHub-style calendar of games per day; tap a game to revisit it. **📌 To do** sets a puzzle
  aside; solving it moves it to the history. Entries store a random puzzle's seed, a daily puzzle's date, or
  else the compressed puzzle, so they can always be reopened.
- **Share ▾ → Show QR code** shows the same link as a QR code. **📷 Scan QR code** on the home screen reads one
  with the camera and opens the puzzle on the device, so the app can pass puzzles on without internet.

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

## Android app

The Android app is the built site wrapped with [Capacitor](https://capacitorjs.com). It carries its
own copy of the site, so it works offline (duels still need internet). Links shared from the app
point to the public site, so friends can open them in a browser.

Needs the Android SDK (`ANDROID_HOME`) and JDK 21 (the scripts use
`/usr/lib/jvm/java-21-openjdk-amd64`; set `JAVA_HOME_21` to use another).

```bash
npm run android:build     # build the site, copy it into android/, build a debug APK
npm run android:install   # install it on a phone connected with USB debugging on
```

At most once a day the app asks GitHub for the latest release and, if its tag (`v1.2`) is newer than
the installed version, offers it in a banner (Download opens the release page; Later hides it for a
day). Development builds (`dev-…` versions) don't check.

The APK ends up in `android/app/build/outputs/apk/debug/app-debug.apk`. It is a separate app,
**Pips Dev** (orange icon, app ID `io.github.keyserlingk.pips.dev`), so it installs next to the release
app instead of over it. It keeps its own progress and never shows the update banner. Changes to the site reach
the app only when it is rebuilt and reinstalled. The icon and splash screen sources are in
`assets/` (regenerate with `npx @capacitor/assets generate --android`).

### Testing on the emulator

A virtual Pixel 7 (`Pips_Phone`, Android 16) is set up:

```bash
~/Android/Sdk/emulator/emulator -avd Pips_Phone &   # start it (a phone window opens)
npm run android:build && npm run android:install    # put the current code on it
adb emu kill                                         # shut it down
```

`npm run dev` (http://localhost:5173) is quicker for trying changes in a browser; `npm run dev -- --host`
also serves it to a phone on the same Wi-Fi.

## Releasing the app

```bash
scripts/release.sh 1.2              # or: npm run release -- 1.2
```

That's all. The script checks everything first, shows the release notes, and asks before publishing.
Then it pushes `main` if needed, creates the GitHub release `v1.2`, and waits (about 4 minutes) while
the **Test and build Android app** workflow runs the tests, builds the APK, signs it, and attaches
`pips-1.2.apk` to the release. Phones on an older version offer the update within about a day.

- **Release notes:** by default the commit titles since the last release. To write your own, pass a
  file: `scripts/release.sh 1.2 notes.md`. You can also edit them on GitHub afterwards.
- **Try it first:** `scripts/release.sh 1.2 --dry-run` shows what would happen and changes nothing.
- **Version numbers:** plain numbers (`1.2`, `1.10`, `2.0.1`), each higher than the last. The app
  ignores anything else, and an older number would never be offered as an update.
- **The script refuses when:** you're not on `main`, you have uncommitted changes, GitHub has commits you
  haven't pulled (`git pull`), or the version already exists or isn't newer than the last one.

### If the build fails

The release then exists but has no APK. The script prints a link to the failed run; the log shows why
(usually a failing test). Fix it, push, and either press **Re-run all jobs** on that page or delete the
release and its tag on GitHub and run the script again. A re-run attaches the APK when it passes.

### Every push to main

The same workflow also runs on every push to `main` (tests plus a signed APK, kept under the run's
**Artifacts** on GitHub as `pips-dev-<commit>.apk`), so you see a broken build before releasing.
These dev builds never show the update banner.

### The signing key

Releases are signed with `~/keys/pips-release.jks` (alias `pips`), stored on GitHub as four encrypted
secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_PASSWORD` (`gh secret list` shows they exist; values can't be read back).

- **Keep the key file and its password backed up** (a password manager). Every update must be signed
  with this same key: without it, no future version can install over the app.
- **Never commit it.** `*.jks` and `*.keystore` are in `.gitignore`.
- **New computer:** nothing to do for releases (GitHub holds the key). To put a key back on GitHub:
  `base64 -w0 ~/keys/pips-release.jks | gh secret set ANDROID_KEYSTORE_BASE64`.
- **v1.0 was signed with a different, temporary key.** Anyone still on 1.0 must uninstall it once before
  installing a newer version (which clears progress saved in 1.0). Everyone on 1.1 or later updates
  normally.
