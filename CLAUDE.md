# CLAUDE.md

PaengClub: static site (GitHub Pages) + Supabase, for a small group of friends.

**Read `ARCHITECTURE.md` before non-trivial work** — it maps the whole codebase.

Must-knows:
- **No build step / no framework.** Plain ES modules loaded directly. Don't add
  JSX/TS/bundlers/npm imports; CDN (esm.sh, jsDelivr) only.
- **Absolute imports** rooted at site root: `/app.js`, `/features/x.js`,
  `/lib/x.js`, `/supabaseClient.js`.
- Layout: `app.js` (shell/router) + `supabaseClient.js` + `data.js` at root;
  shared helpers in `/lib` (`dom.js` = `el()`/`svg()`, `format.js` =
  `num()`/`cssVar()`); one tab per module in `/features`; SQL in `/migrations`.
- Each `/features/*` exports `renderX()` (mount into `#screen`) + `cleanupX()`
  (release timers/listeners/realtime channels). The shell calls them by numeric
  page id. Build DOM with `el()`/`svg()`, never innerHTML strings.
- Theme via `--app-*` CSS vars + `data-bs-theme`; support light + dark.
- Schema changes: add a `migrations/*.sql` record **and** apply it to Supabase.
- Workflow: commit + push to `main-v2` right after a change (that's the deploy).
  Verify observable changes in the browser preview first. Never bust a module's
  cache with a `?v=` query (breaks `app.js ⇄ features/timer.js` identity).
