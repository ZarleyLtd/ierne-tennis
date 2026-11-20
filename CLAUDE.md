# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Ierne Tennis: the tennis section's site for leagues, knockouts, double-eliminators and ladders, in singles, doubles and mixed doubles. It is a static HTML/CSS/vanilla-JS site (no framework, no build step) backed by one Supabase Edge Function over Postgres. It was forked from `ierne-snooker` and keeps its shape. `docs/SPEC.md` is the product spec. `PROJECT_MAP.md`, `assets/js/README.md`, `components/README.md` and `docs/SUPABASE_SETUP.md` are the project's own docs; keep them in sync when changing what they describe.

## Commands

There is no build, lint or unit-test suite.

- **Dev server:** `python -m http.server 4322` (or any static server) from the repo root, then open http://localhost:4322/. Pages call the live Edge Function in `app-config.js`; there is no local backend. Serve over HTTP, because `main.js` skips service-worker registration on `file:`.
- **API smoke test:** `node scripts/smoke-test.mjs` with `IERNE_TENNIS_ADMIN_SECRET` set. It creates throwaway "ZZ Test" data on the live API, checks scoring, standings, brackets, the ladder and account roles, then deletes it all.
- **Deploy the function** after **any** change under `supabase/functions/ierne-tennis-api/`: `supabase functions deploy ierne-tennis-api --no-verify-jwt --use-api`.
- **Schema changes:** follow the `shared-supabase` skill. Never run `supabase db push`. Add a timestamped file under `supabase/migrations/`, then apply it with the Supabase MCP `apply_migration`, or with `supabase db query --linked -f <file>` when MCP is unavailable.

## Architecture

**Request flow:** browser page → `ApiClient` (`assets/js/utils/api-client.js`) → Edge Function `ierne-tennis-api` (`supabase/functions/ierne-tennis-api/index.ts`) → direct Postgres connection to schema `ierne_tennis`. The schema is not exposed to PostgREST; never call supabase-js/PostgREST from the browser. The function URL lives only in `assets/js/config/app-config.js`.

**Function modules:**
- `index.ts`: router, auth gates, every handler.
- `accounts.ts`: handles, passwords, invites and sessions.
- `scoring.ts`: set validation and the set line ("6-4 3-6 [10-7]").
- `brackets.ts`: round robin, knockout and double-eliminator generation, unchanged from snooker.
- `ladder.ts`: ladder positions, computed by replaying results.

**CORS constraint:** the function does not rely on preflight. Reads are `ApiClient.get({ action, ... })` (GET, no custom headers). Writes are `ApiClient.post(action, data)`: `application/x-www-form-urlencoded` with one `data` field holding JSON `{ action, data, adminToken?, sessionToken? }`.

**Auth tiers** (see `dispatchPost`):
- `PUBLIC_POST_ACTIONS`: register, connect, resetPassword, signOut, whoAmI.
- `PLAYER_RESULT_ACTIONS`: results, result-slip photos and `createChallenge`. Allowed for admins and approvers, or a player in the match (either partner of a pair) within 24 hours of the result first being posted. Player-entered scores stay pending until approved.
- `ADMIN_POST_ACTIONS`: need the HMAC `adminToken` from `adminLogin` (secret `IERNE_TENNIS_ADMIN_SECRET`) or an `is_admin` account. `approveFixtureResult` also accepts approvers.

New GET actions go in the GET switch; new POST actions go in the right set and in the switch. Document both in `docs/SUPABASE_SETUP.md`.

**Data model:**
- A **player** is a person.
- An **entrant** is what plays: a single (id = player id), a pair (`pr:<a>+<b>`), a bracket placeholder (`wo:`/`lo:` + round code) or the `bye`.
- `competitions` carry the type (`league` | `knockout` | `double-eliminator` | `ladder`), format (`singles` | `doubles` | `mixed`), match format, points scheme and ladder settings.
- `competition_entrants` holds each roster. Knockout and ladder comps use the internal group `ko`.
- `fixtures.side_a_id` / `side_b_id` point at entrants. `score_a` / `score_b` hold **sets won** and `set_scores` (jsonb) holds the set detail.
- Standings come from `league_standings_v` using each comp's points. The function then breaks ties: set difference, game difference, head-to-head, name.

**Payload naming:** fixture and roster payloads keep snooker's keys (`playerAId`, `"Player A"`, `playerId`, `playerName`) so the frontend changed less. In those payloads the keys carry the **entrant** id and display name. `sideAPlayerIds` / `sideBPlayerIds` list the people on each side.

**Frontend JS:** plain scripts that define globals, not ES modules. Pages load scripts in strict order: config → utils → components → pages → `main.js`. `main.js` routes by root element id. To add a page, create `pages/*.js` with `init()` defined with `var`, add a route in `main.js`, and add the script tags. Scoring rules in the browser live in `utils/tennis-score.js` and mirror `scoring.ts`.

**HTML components:** no templating. `components/header.html`, `footer.html` and `scripts.html` are copied into every root page. Edit the component first, then copy the change into each page.

**Shared UI:** brief message, confirm dialog and working indicator are synced from `cursor-sites-shared/ui/`; never edit the copies here. The confirm overlay cannot sit above a modal `<dialog>`, so close the dialog, ask, and reopen on cancel (see `FixturesPage.confirmClearingResult`).

**Contextual help:** the **?** button engine is `components/contextual-help.js`, and its catalog is `utils/help-catalog.js`. New controls need a `data-help` key and a catalog entry.

**PWA:** `sw.js` precaches the public shell under `ierne-tennis-shell-vN`. Bump the version when shell files change. It only deletes its own old caches, because sibling apps share the `zarleyltd.github.io` origin.

**Same-origin isolation:** every storage key and event is prefixed `ierneTennis` / `ierne-tennis-` so this app never collides with ierne-snooker on GitHub Pages.

## Conventions

- Header or footer changes: edit `components/` first, then every `.html` page.
- JS changes: shared `utils/` first, then `components/`, then `pages/`.
- To change the backend endpoint, edit only `assets/js/config/app-config.js`.
- Use relative paths only. No `localhost` URLs and no drive-letter paths in shipped files.
- Never use `window.confirm`; use `ConfirmDialog`. Wrap work over ~500 ms in `WorkingIndicator`.
- Images: original artwork lives in `assets/images/` (`court-hero.svg`, `court-banner.svg`). Club photos can replace them later; keep the same file names or update the hero `<img>` in each page.
- Edison tickets: follow the shared rules in `C:\CursorSites\CLAUDE.md`.
