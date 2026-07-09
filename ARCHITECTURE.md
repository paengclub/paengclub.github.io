# PaengClub — Architecture

Small single-page site for a group of friends (military-service D-day tracker
plus a handful of shared toys). Static frontend on GitHub Pages, Supabase for
data/auth. **No build step, no framework, no bundler** — the browser loads
plain ES modules directly.

Read this file first; it's meant to let you (human or LLM) understand the whole
codebase without reading every file.

## Hard constraints (don't break these)

- **No build/bundler.** Files are served as-is. Don't add JSX, TypeScript, npm
  imports, or anything that needs compiling. Third-party libs come from a CDN
  (`esm.sh` for supabase-js, jsDelivr for Bootstrap CSS).
- **Absolute import paths only**, rooted at the site root: `/app.js`,
  `/features/board.js`, `/lib/dom.js`, `/supabaseClient.js`. GitHub Pages serves
  this repo at the domain root, so `/features/x.js` resolves to
  `https://paengclub.github.io/features/x.js`. (Local dev: `python -m
  http.server` from the repo root — see `.claude/launch.json`.)
- **GitHub Pages caches assets ~10 min** (`max-age=600`). After deploy, a hard
  refresh may be needed; never "fix" a stale-cache symptom by adding a `?v=`
  query to a module URL — that breaks the `app.js ⇄ timer.js` module identity
  (a real bug we already hit once).

## Layers / directory layout

```
/                app shell + top-level singletons
  index.html     nav markup, theme toggle, loads /app.js as a module
  app.js         router + theme + nav wiring (the shell). Owns page switching.
  supabaseClient.js  the single shared Supabase client (URL + publishable key)
  data.js        static seed data for the D-day tab (members, itineraries)
/lib             shared, dependency-free helpers (no feature logic, no DOM state)
  dom.js         el() element builder, svg() SVG builder
  format.js      num() (comma-tolerant), cssVar() (read a --app-* theme token)
/features        one module per tab; each renders into #screen and cleans up
  board.js       게시판 (board) + Google auth + profile.  ALSO owns the session.
  canvas.js      그림판 (shared pixel board), realtime + reconcile
  games.js       미니게임 (reaction / taprush / memory / tetris) + leaderboard
  weight.js      체중 (weight chart), reads from Supabase
  portfolio.js   자산관리 (asset dashboard: 현황 / 리밸런싱), login-gated
  tier.js        게임 티어 (drag-and-drop tier list), realtime + poll
  timer.js       디데이 (D-day / rank progress bars for each member)
/migrations      applied SQL, one file per change (record only; run via Supabase)
style.css        all styles. Uses --app-* CSS custom properties for theming.
```

**Dependency direction:** `app.js → features/* → lib/* & supabaseClient.js`.
Two exceptions, both intentional and pre-existing:
- `features/games.js` and `features/portfolio.js` import auth helpers from
  `features/board.js` (board is the de-facto "auth/session" module).
- `features/timer.js` imports `current_rendered_page` from `/app.js` (a small
  circular edge; keep `app.js` at root so this keeps resolving).

## The app shell (`app.js`)

- Each tab is a numeric page id. `index.html` has `<button class="nav-buttons"
  id="0..6">`; clicking sets `current_rendered_page` and calls
  `myRenderFunction()`.
- `myRenderFunction()` first calls each feature's `cleanupX()` for the tabs that
  are *not* active (so timers / realtime channels / listeners are torn down),
  clears `#screen`, then calls the active tab's `renderX()`.
- Page ids → tabs: `0` board, `1` games, `2` canvas, `3` dday(timer), `4`
  weight, `5` portfolio, `6` tier.
- Theme: `initTheme()` follows `prefers-color-scheme`; the floating button
  toggles `data-bs-theme` on `<html>`. All colors come from `--app-*` tokens in
  `style.css` (light values in `:root`, dark in `[data-bs-theme="dark"]`).

## Per-feature contract

Every feature module exports:
- `renderX()` — build the tab's UI into `#screen` (id `"screen"`). May be async
  (loads from Supabase). Idempotent: it clears/rebuilds its own DOM.
- `cleanupX()` — release everything global the tab created: `setInterval`/
  timeouts, `window` listeners, `requestAnimationFrame` loops, and Supabase
  realtime channels (`supabase.removeChannel(...)`). Called by the shell when
  leaving the tab. **If you add a timer/listener/channel, release it here** — a
  leak keeps running on other tabs.

Build DOM with `el()` / `svg()` from `/lib/dom.js` (not innerHTML strings).

## Auth (`features/board.js`)

- `initBoardAuth(onAuthChange)` runs once from `app.js` *before* the first
  render, resolving the session up front so the board paints once. It also
  subscribes to `onAuthStateChange` but only re-renders on an actual
  signed-in-user change (ignores the initial replay and hourly token refreshes).
- Others read the session via `getCurrentSession()` / `getCurrentPlayerName()`
  and start Google sign-in via `signInWithGoogle()`.
- Login-gated tabs (only `portfolio`) show a login card when
  `getCurrentSession()` is null.

## Data model (Supabase, project `zzxlzczjseeudhwjnwdm`)

Public-read, RLS-guarded. Shared toys are world-readable; personal data is
per-user.

| Feature | Tables | Notes |
|---|---|---|
| auth/profile | `profiles` | display_name, avatar_url; avatars in `avatars` storage bucket |
| board | `board_posts`, `board_comments` | public read; insert/update/delete by author (`auth.uid()`) |
| canvas | `canvas_pixels` (PK `x,y`) | public read + write within bounds; in `supabase_realtime` |
| games | `game_scores` | public read + insert; `game_id ∈ {reaction,taprush,memory,tetris}` |
| tier | `tier_games` | public read; insert(unranked)/update(move) by anyone; images in `tier-games` bucket; realtime |
| portfolio | `portfolio_snapshots`, `portfolio_holdings`, `portfolio_categories`, `portfolio_events` | **per-user** (`user_id = auth.uid()`), login required |
| weight | `weight_people`, `weight_records` | public read; writes are admin/SQL only |

Schema changes: write a `migrations/<date>_<name>.sql` file for the record AND
apply it to the project (via the Supabase MCP tools / dashboard). The SQL file
alone does nothing until applied.

## Charts

Hand-rolled, no chart lib:
- `weight.js` and `games.js` (tetris) draw on a `<canvas>`; theme colors read via
  `cssVar("--app-...")`.
- `portfolio.js` builds inline SVG (donuts / lines / stacked bars) with `svg()`.

## Adding a new tab (checklist)

1. `features/<name>.js` exporting `render<Name>()` + `cleanup<Name>()`.
2. Build DOM with `el()`/`svg()` from `/lib`. Register any timer/listener/channel
   so `cleanup<Name>()` can release it.
3. `index.html`: add `<button class="nav-buttons" id="<n>">라벨</button>`.
4. `app.js`: import the two functions, add `cleanup` call for `!= n`, and a
   `render` call for `== n` in `myRenderFunction()`. If the mobile nav grid is
   count-specific, bump `grid-template-columns: repeat(N, ...)` in `style.css`.
5. If it needs data: add tables + RLS (+ a `migrations/*.sql` record) and read
   through `/supabaseClient.js`.
6. `style.css`: add styles; support light + dark via `--app-*` tokens.

## Workflow notes

- Small trusted-friends site: commit and push to `main-v2` right after a change
  (that's the deploy). Verify observable changes in the browser preview first.
- The preview tab caches modules aggressively across a long session; if a tab
  looks stale, restart the preview server or re-fetch with `{cache:'reload'}`.
  It's a preview artifact, not the deployed behavior.
