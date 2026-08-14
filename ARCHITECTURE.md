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
  (`esm.sh` for supabase-js, jsDelivr for the Pretendard webfont).
- **Absolute import paths only**, rooted at the site root: `/app.js`,
  `/features/auth.js`, `/lib/dom.js`, `/supabaseClient.js`. GitHub Pages serves
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
  index.html     nav markup, loads /app.js as a module
  app.js         router + nav wiring (the shell). Owns page switching.
  supabaseClient.js  the single shared Supabase client (URL + publishable key)
  data.js        static seed data for the D-day tab (members, itineraries)
/lib             shared, dependency-free helpers (no feature logic, no DOM state)
  dom.js         el() element builder, svg() SVG builder
  format.js      num() (comma-tolerant), cssVar() (read a --app-* theme token)
/features        one module per tab; each renders into #screen and cleans up
  auth.js        Google auth/session + the profile-edit screen. Owns the session.
  timer.js       디데이 (D-day / rank progress bars) — the landing tab
  weight.js      체중 (weight chart, 연/주/일 buckets), reads from Supabase
  tier.js        게임 티어 (drag-and-drop tier list), realtime + poll
  timetable.js   시간표 (Everytime-style weekly class grid, public view / owner edit)
/migrations      applied SQL, one file per change (record only; run via Supabase)
style.css        all styles. Uses --app-* CSS custom properties for theming.
```

**Dependency direction:** `app.js → features/* → lib/* & supabaseClient.js`.
Two exceptions, both intentional and pre-existing:
- `features/timetable.js` imports auth helpers from `features/auth.js` (the
  de-facto "auth/session" module, which also owns profile editing —
  nickname/bio/MBTI live on its `renderProfile()` screen, reached by clicking
  your avatar in the nav).
- `features/timer.js` imports `current_rendered_page` from `/app.js` (a small
  circular edge; keep `app.js` at root so this keeps resolving).

There is no longer any feature→feature coupling.

## The app shell (`app.js`)

- Each tab is a numeric page id. `index.html` has `<button class="nav-buttons"
  id="...">`; clicking sets `current_rendered_page` and calls
  `myRenderFunction()`.
- `myRenderFunction()` first calls each feature's `cleanupX()` for the tabs that
  are *not* active (so timers / realtime channels / listeners are torn down),
  clears `#screen`, then calls the active tab's `renderX()`.
- Page ids → tabs: `3` dday(timer, the default landing page), `4` weight, `6`
  tier, `8` timetable. Ids `0`/`1`/`2`/`5`/`7` are retired (홈/미니게임/그림판/
  자산관리/프로필, all removed) — left unused rather than renumbering
  everything.
- Theme: **one light theme, no dark mode and no toggle.** Every colour is an
  `--app-*` custom property defined once on `:root` in `style.css`. Palette is
  Toss-inspired: near-white greys, a single blue accent (`--app-primary`
  #3182F6), filled surfaces rather than borders. `features/weight.js` reads
  these tokens at paint time via `cssVar()`, so renaming one breaks the chart.

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

## Auth (`features/auth.js`)

- `initAuth(onAuthChange)` runs once from `app.js` *before* the first render,
  resolving the session up front. It also subscribes to `onAuthStateChange`
  but only re-renders on an actual signed-in-user change (ignores the initial
  replay and hourly token refreshes).
- Others read the session via `getCurrentSession()` / `getCurrentPlayerName()`
  and start Google sign-in via `signInWithGoogle()`.
- `profiles` and `timetable` are public to *view*; editing (your own profile
  fields, or your own courses) is gated per-action inside the tab instead of
  gating the whole tab. No fully login-gated tab currently exists (자산관리 was
  the one that was; its frontend was removed, see below).

## Data model (Supabase, project `zzxlzczjseeudhwjnwdm`)

Public-read, RLS-guarded. Shared toys are world-readable; personal data is
per-user.

| Feature | Tables | Notes |
|---|---|---|
| auth/profile | `profiles` | display_name, avatar_url, nickname, bio, mbti; avatars in `avatars` storage bucket; own row editable. Still live: `timetable` reads names/avatars from it |
| tier | `tier_games` | public read; insert(unranked)/update(move) by anyone; images in `tier-games` bucket; realtime |
| weight | `weight_people`, `weight_records` | public read; writes are admin/SQL only |
| timetable | `timetable_courses` | public read (schedules are meant to be shared); insert/update/delete **own only** (`user_id = auth.uid()`); `days` is a `smallint[]` (multi-day courses), `start_minute`/`end_minute` step in 5s |

**Kept-but-unused backends.** These tables have no frontend on this site any
more, but were deliberately left intact (with their data) rather than dropped:

- `game_scores` — 미니게임's leaderboard, 263 rows across seven `game_id`s.
- `portfolio_snapshots`/`portfolio_holdings`/`portfolio_categories`/`portfolio_events`
  — 자산관리, per-user (`user_id = auth.uid()`); the plan is to rebuild that
  feature on a different site against this same Supabase backend.
- The `profiles` directory columns (`nickname`, `bio`, `mbti`) added by
  `20260713_profile_directory_fields.sql` — the 프로필 directory tab is gone,
  but the columns and the profile-edit screen in `auth.js` remain.

`board_posts`, `board_comments`, and `canvas_pixels` (게시판/그림판) were
dropped entirely — feature and data both removed, no backend kept.

Schema changes: write a `migrations/<date>_<name>.sql` file for the record AND
apply it to the project (via the Supabase MCP tools / dashboard). The SQL file
alone does nothing until applied.

## Charts

Hand-rolled, no chart lib: `weight.js` draws on a `<canvas>`, reading its
colors via `cssVar("--app-...")` so it stays in step with the theme tokens.

It has three fixed granularities (연/주/일) and no zoom or pan. Each view
buckets the same full history and plots one dot per bucket; a bucket's value is
the mean of its records and its x position the mean of their dates. Nothing is
smoothed, interpolated or extrapolated — if you add a trend line or a
projection, say so in the UI, because the tab's contract with the reader is
that every plotted point is measured data.

## Adding a new tab (checklist)

1. `features/<name>.js` exporting `render<Name>()` + `cleanup<Name>()`.
2. Build DOM with `el()`/`svg()` from `/lib`. Register any timer/listener/channel
   so `cleanup<Name>()` can release it.
3. `index.html`: add `<button class="nav-buttons" id="<n>">라벨</button>`.
4. `app.js`: import the two functions, add `cleanup` call for `!= n`, and a
   `render` call for `== n` in `myRenderFunction()`. The mobile nav scrolls
   horizontally (`.nav-tabs { overflow-x: auto }`), so no per-tab-count CSS is
   needed. If the tab needs to react to login/logout while it's open, add its
   page id to the whitelist in `app.js`'s `initAuth(...)` callback.
5. If it needs data: add tables + RLS (+ a `migrations/*.sql` record) and read
   through `/supabaseClient.js`.
6. `style.css`: add styles using the `--app-*` tokens (light theme only).

## Workflow notes

- Small trusted-friends site: commit and push to `main-v2` right after a change
  (that's the deploy). Verify observable changes in the browser preview first.
- The preview tab caches modules aggressively across a long session; if a tab
  looks stale, restart the preview server or re-fetch with `{cache:'reload'}`.
  It's a preview artifact, not the deployed behavior.
