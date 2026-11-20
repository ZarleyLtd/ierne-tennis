# Supabase backend: setup and operations

The site reads and writes through one Edge Function, `ierne-tennis-api`, on the shared CursorSites **Apps** project (ref `yzyipxvlsoxfphwobfkb`). Data lives in the Postgres schema `ierne_tennis`.

```
Browser (static HTML)
   |  GET ?action=…            POST data={action, data, adminToken?, sessionToken?}
   v
Edge Function: ierne-tennis-api   (supabase/functions/ierne-tennis-api/)
   |  direct Postgres connection (SUPABASE_DB_URL)
   v
schema ierne_tennis
   ├─ players               people (name, optional gender, active)
   ├─ entrants             what plays: single | pair | placeholder (wo:/lo:) | bye
   ├─ competitions         type, format, match format, points scheme, ladder settings
   ├─ competition_groups   league groups; knockout and ladder comps use group 'ko'
   ├─ competition_entrants roster: comp + entrant + group (+ seed, ladder start position)
   ├─ fixtures             sides, round, match format, sets won, games, set_scores, approval, slip
   ├─ accounts / invites / sessions
   views
   ├─ entrants_v           entrant display names ("Byrne / Kelly" for pairs)
   ├─ fixture_results_v    group-stage results from each entrant's side
   ├─ league_standings_v   P/W/L, set and game difference, points from the comp's scheme
   └─ head_to_head_v       the same per pair of entrants, for tiebreaks
storage bucket ierne-tennis-result-slips (private; signed URLs only)
```

The schema is not on the project's exposed schemas list, and RLS is on with no policies, so anonymous clients cannot read it. The function connects directly with `SUPABASE_DB_URL`.

## Shared project rules

This project is shared with other apps. Follow the `shared-supabase` skill:

- Never run `supabase db push`.
- Put each schema change in a new timestamped file in `supabase/migrations/`, touching only `ierne_tennis`.
- Apply it with the Supabase MCP `apply_migration`. If MCP is unavailable, run `supabase db query --linked -f <file>` (this does not record it in the shared migration history; the committed file is the record).
- Deploy the function after any change under `supabase/functions/ierne-tennis-api/`:

```
supabase functions deploy ierne-tennis-api --no-verify-jwt --use-api
```

## Secrets

| Secret | Purpose |
|---|---|
| `IERNE_TENNIS_ADMIN_SECRET` | The club admin secret typed into **Unlock Admin Mode**. Rotating it signs out every PIN session. Set with `supabase secrets set IERNE_TENNIS_ADMIN_SECRET=<value>`. |
| `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Provided by the platform. |

## Scores

- `score_a` / `score_b` are **sets won**, so knockout advancement works exactly as in the snooker app.
- `games_a` / `games_b` are total games; a match tiebreak counts as one game.
- `set_scores` is a list such as `[{"a":6,"b":4},{"a":6,"b":7,"tbA":5,"tbB":7},{"a":1,"b":0,"tbA":10,"tbB":8,"mtb":true}]`.
- Each fixture carries its own `sets_to_win` (1–3), `games_per_set` (4, 6, 8) and `final_set` (`full` or `match_tiebreak`), copied from the comp when the fixture is made. `scoring.ts` validates every save.

## Standings

Points per match come from the competition: `win_points`, or `loss_points` plus `loss_with_set_bonus` when the loser won a set, plus `set_points` for every set won. The function then orders each group by:

1. points
2. set difference
3. game difference
4. head-to-head among the entrants still tied (points, then sets, then games)
5. name

## Ladder

Positions are never stored. `ladder.ts` replays the start order (`ladder_start_position`), later joiners (added at the bottom when they join) and completed ladder results in the order they were posted. Side A of a ladder fixture is the challenger; a challenger win moves them into the defender's place.

## API

GET requests take no custom headers. POST requests are `application/x-www-form-urlencoded` with one field `data` containing `{ "action", "data", "adminToken"?, "sessionToken"? }`. Errors return `{ success: false, error }` with a 4xx or 5xx status.

### GET actions

| Action | Params | Returns |
|---|---|---|
| `getCompetitions` | – | `competitions[]`: `compId, name, competitionType, format, isCurrent, parentCompId, startsOn, endsOn, setsToWin, gamesPerSet, finalSet, winPoints, lossPoints, lossWithSetBonus, setPoints, ladderChallengeRange, ladderChallengeDays` |
| `getCompetitionGroups` | `compId` | `competition`, `groups[]` with `playerCount` (entrants) |
| `getFixtures` | `comp` or `competitionType` | `fixtures[]`: `fixtureId, "Game Week", Group, Stage, "Player A", "Player B", playerAId, playerBId, sideAPlayerIds, sideBPlayerIds, "Match Date", Result (set line), scoreA, scoreB, gamesA, gamesB, sets, setLine, setsToWin, gamesPerSet, finalSet, roundName, resultEnteredBy, resultApproved, resultApprovedBy, resultApprovedAt, resultPostedAt, challengedAt, playBy` |
| `getStandings` | `comp` or `competitionType` | `competition`, `groups[]` with `rows[]`: `entrantId, "Player Name", P, W, L, "Sets +/-", "Games +/-", Pts, unapproved` |
| `getPlayers` | none | people: `playerId, playerName, gender, active, compCount, matchCount, claimed` |
| `getPlayers` | `comp`, optional `group` | the comp's entrants: `playerId` (= entrant id), `playerName`, `kind`, `memberIds`, `groupId`, `seed`, `ladderStartPosition` |
| `getEntrants` | optional `kind` (`pair` or `single`) | `entrants[]`: `entrantId, kind, name, memberIds, compCount, matchCount` |
| `getPlayerComps` | `playerId` | comps the person is in, alone or in a pair |
| `getLadder` | `comp` (defaults to the current ladder) | `competition`, `rows[]`: `position, entrantId, name, memberIds, won, lost, openChallenge` |

### POST actions

| Action | Who | `data` |
|---|---|---|
| `register` | public | `inviteCode, handle, password, playerId` |
| `connect` | public | `handle, password` → `sessionToken, account` |
| `resetPassword` | public | `handle, resetCode, newPassword` |
| `signOut`, `whoAmI` | session | none (session token on the envelope) |
| `updateFixtureResult` | admin, approver, or a player in the match within 24 h | `fixtureId, sets[], matchDate?`. An empty `sets` clears the result. |
| `getResultSlip`, `uploadResultSlip`, `commitResultSlip`, `discardResultSlipSession`, `removeResultSlip` | as above | `fixtureId` (+ `base64, mimeType` to upload) |
| `createChallenge` | a signed-in player on the ladder, or an admin | `compId, defenderId`; admins may add `challengerId` |
| `approveFixtureResult` | admin or approver | `fixtureId` |
| `adminLogin` | public | `pin` → `token, expiresAt` (24 h) |
| `upsertCompetition` | admin | `compId, name, competitionType, format, isCurrent, parentCompId?, startsOn?, endsOn?, setsToWin, gamesPerSet, finalSet, winPoints, lossPoints, lossWithSetBonus, setPoints, ladderChallengeRange, ladderChallengeDays`. Unplayed fixtures follow a match-format change. |
| `deleteCompetition` | admin | `compId`. Refused while it has results or child comps. |
| `upsertCompetitionGroup`, `deleteCompetitionGroup` | admin | `compId, groupId, name?, displayOrder?` |
| `upsertCompetitionEntrant` (alias `upsertCompetitionPlayer`) | admin | `compId`, one of `entrantId` / `playerId` / `player1Id + player2Id`, `groupId` (leagues), `seed?`, `ladderStartPosition?`, or `remove: true`. Singles comps take singles, doubles comps take pairs, and a player can be in a comp only once. |
| `upsertPlayer` | admin | `playerId?, playerName, gender?, active?` |
| `deletePlayer` | admin | `playerId`. Refused while they are in a comp or fixture. |
| `upsertPair`, `deletePair` | admin | `player1Id, player2Id` / `entrantId` |
| `upsertFixture` | admin | `fixtureId?, compId, stage (group/knockout/ladder), roundLabel, roundName?, groupId?, playerAId, playerBId, matchDate?, playBy?, sortOrder?, setsToWin?, gamesPerSet?, finalSet?`. Never changes a result. |
| `generateFixtures` | admin | `compId, regenerate?`. Leagues get a round robin per group; knockouts and double-eliminators get a random draw with byes. Ladders are refused. |
| `deleteFixture` | admin | `fixtureId` |
| `cancelChallenge` | admin | `fixtureId` of an unplayed ladder challenge |
| `setLadderStartPositions` | admin | `compId, order[]` (entrant ids, top first) |
| `issueInvite`, `listInvites`, `revokeInvite`, `listAccounts`, `disableAccount`, `setAccountAdmin`, `setAccountApprover` | admin | as in the snooker app |

## Setting up from scratch

1. `supabase link --project-ref yzyipxvlsoxfphwobfkb`
2. Apply `supabase/migrations/20261120220000_create_ierne_tennis_schema.sql` (see the shared project rules above).
3. `supabase secrets set IERNE_TENNIS_ADMIN_SECRET=<value>`
4. `supabase functions deploy ierne-tennis-api --no-verify-jwt --use-api`
5. Check `assets/js/config/app-config.js` points at `https://yzyipxvlsoxfphwobfkb.functions.supabase.co/ierne-tennis-api`.
6. Run `node scripts/smoke-test.mjs` with `IERNE_TENNIS_ADMIN_SECRET` set.
