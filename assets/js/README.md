# JavaScript module structure

Plain scripts that define globals (no ES modules, no bundler).

```
assets/js/
├── config/
│   └── app-config.js          # Edge Function URL (the only place it is set)
├── utils/
│   ├── api-client.js          # fetch wrapper for ierne-tennis-api (simple CORS)
│   ├── current-competition.js # the "now showing" competition (league, knockout, DE or ladder)
│   ├── nav-competition.js     # shows Standings / Ladder / group filter for that competition
│   ├── admin-mode.js          # Unlock Admin Mode + admin nav visibility
│   ├── player-session.js      # Connect / Register / Reset and the signed-in account
│   ├── tennis-score.js        # set validation and set lines (mirrors scoring.ts)
│   ├── knockout-rounds.js     # knockout and double-eliminator round codes and labels
│   ├── knockout-bracket.js    # bracket drawing for the home card
│   ├── league-group-filter.js # group radio filter on Fixtures / Results
│   ├── formatters.js          # dates and padding helpers
│   ├── image-compress.js      # score-card photo compression (~100 KB JPEG)
│   ├── image-loader.js        # lazy image fade-in
│   ├── nav-active.js          # active nav item
│   ├── player-slug.js         # player id from a name
│   ├── help-catalog.js        # contextual help copy
│   ├── brief-message.js       # synced from cursor-sites-shared/ui
│   ├── confirm-dialog.js      # synced from cursor-sites-shared/ui
│   └── working-indicator.js   # synced from cursor-sites-shared/ui
├── components/
│   ├── contextual-help.js     # the ? button engine
│   ├── league-standings.js    # standings table
│   └── result-slip-upload.js  # score-card photo button and sheet
├── pages/
│   ├── index.js               # home carousel: league leaders, brackets, ladder top five
│   ├── standings.js           # league tables (StandingsPage)
│   ├── ladder.js              # ladder page (LadderPage) and rules summary (RulesPage)
│   ├── fixtures.js            # fixtures list and the shared set-by-set result dialog
│   ├── results.js             # results list
│   ├── admin-competitions.js  # comps, format, points, groups, pairs, rosters, ladder order
│   ├── admin-fixtures.js      # fixture CRUD, generation, ladder challenge list
│   ├── admin-players.js       # player list
│   ├── admin-player.js        # one player: name, gender, active, pairs, comps
│   └── admin-accounts.js      # registration codes and account roles
└── main.js                    # router: runs the module whose root element is on the page
```

## Load order

1. `config/app-config.js`
2. `utils/*.js`
3. `components/*.js`
4. `pages/*.js`
5. `main.js` (deferred)

## API access

```js
ApiClient.get({ action: 'getFixtures', comp: 'summer-league' });
ApiClient.post('updateFixtureResult', { fixtureId, sets: [{ a: 6, b: 4 }, { a: 6, b: 3 }] });
```

Fixture rows keep snooker's keys (`'Game Week'`, `'Player A'`, `playerAId`); in this app they carry entrant ids and names (a player or a pair). See `../../docs/SUPABASE_SETUP.md` for every action.

## Adding a page

1. Create `pages/my-page.js` defining `var MyPage = { init: function () { … } }`. Use `var`: the router looks modules up on `window`.
2. Add `['my-root-element-id', 'MyPage']` to the routes in `main.js`.
3. Add the script tag to the page in the load order above.
