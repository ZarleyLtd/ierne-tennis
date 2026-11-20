# Ierne Tennis project map

## Goal

A light, static site for the tennis section of the club: leagues, knockouts, double-eliminators and ladders, in singles, doubles and mixed doubles. Players enter their own scores from their phones; approvers and admins check them.

## Folders

- `/` — the pages: `index`, `standings`, `ladder`, `fixtures`, `results`, `rules`, `404` and the `admin-*` pages.
- `/components/` — header, footer and scripts, copied into every page.
- `/assets/css/` — `style.css` (theme), `tennis.css` (tennis UI), `fixture-features.css` (result dialog), `admin-panel.css`, plus the synced shared UI styles.
- `/assets/js/` — config → utils → components → pages → `main.js`. See `assets/js/README.md`.
- `/assets/images/` — the Ierne crest and the original court artwork.
- `/assets/icons/` — app icons (crest on court green).
- `/supabase/` — the schema migration and the `ierne-tennis-api` Edge Function.
- `/scripts/` — `smoke-test.mjs`, an end-to-end check of the live API.
- `/docs/` — `SPEC.md` (product spec), `SUPABASE_SETUP.md` (backend runbook and API), `UI_CONTEXTUAL_HELP.md`, `plans/`.

## Pages

| Page | Shows |
|---|---|
| Home | A carousel of the current competitions: league leaders, knockout draws, ladder top five. |
| Standings | League tables (shown when a league is on show). |
| Ladder | Ladder positions, records and challenges (shown when a ladder is on show). |
| Fixtures | Matches to play; the V button opens the set-by-set score form. |
| Results | Scores as set lines; editable while the rules allow. |
| Rules | Club rules plus each current competition's format and points. |
| Manage Comps | Type, singles or doubles, match format, points, ladder rules, groups, pairs and entrants. |
| Manage Players | Players, gender for mixed doubles, active flag, pairs and comps. |
| Manage Fixtures | Generate or edit fixtures; list and cancel ladder challenges. |
| Accounts | Registration codes and admin / approver rights. |

## Changing the backend

Edit only `assets/js/config/app-config.js`. For schema or API changes, see `docs/SUPABASE_SETUP.md`.

## Out of bounds

- No JS frameworks and no build step.
- No absolute paths, `localhost` URLs or drive letters in shipped files.
- No duplicated JS: shared logic goes in `utils/` or `components/`.
