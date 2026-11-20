# Ierne Tennis — product spec

Status: version 1 built and deployed, November 2026.

## Purpose

The tennis section needs the same kind of site the snooker section has: competitions, players, fixtures, results and tables, with players entering their own scores and trusted members approving them. It is themed for tennis, uses the Ierne crest as the home button, and drops snooker's handicaps and top breaks.

## Who uses it

| Role | How they get it | What they can do |
|---|---|---|
| Guest | Nobody signs in | Read every public page. |
| Player | Registers with a one-time code from an admin | Enter or correct the score of their own matches for 24 hours after it is first entered. Make ladder challenges. Their scores show as pending until approved. |
| Approver | An admin ticks Approver on their account | Enter, edit and approve any score. Their own entries are approved at once. No other admin tools. |
| Admin | The club admin secret (**Unlock Admin Mode**), or an account an admin has ticked Admin | Everything, including the manage pages. |

In doubles, either partner of a pair can enter the pair's score.

## Competitions

Each competition has:

- **Type**
  - League: groups, each a round robin, with a table.
  - Knockout: a single-elimination draw.
  - Double-eliminator: winners and losers brackets, a grand final and a reset if needed.
  - Ladder: a ranked list changed by challenges.
- **Format**: singles, doubles or mixed doubles. Doubles comps are entered by fixed pairs. A pair is made once and can be entered in any doubles comp. Gender is recorded on players only to warn when a mixed pair has two players of the same gender.
- **Match format**
  - Match length: one set, best of three or best of five.
  - Games per set: 4, 6 or 8 (an 8-game pro set).
  - Deciding set: a full set, or a match tiebreak to 10.
  - Each fixture copies the comp's format when it is made. A single fixture's match length can be changed on Manage Fixtures.
- **League points**
  - Points for a win.
  - Points for a loss.
  - A bonus for losing but winning a set.
  - Points for every set won.
  - Presets cover the common schemes: win 2 / loss 0; win 3 / loss with a set 1; one point per set.
- **Ladder rules**: how many places above themselves a player may challenge (default 3), and how many days a challenge stays open (default 14).
- **Current**: current comps appear on the home page. Several can be current at once. A league can have a linked knockout stage.

## Scoring

- Scores are entered set by set.
- A set is finished when one side reaches the set length with a two-game lead (6-4), wins 7-5, or wins 7-6 on a tiebreak. Tiebreak points are optional.
- A match tiebreak is first to 10, win by two. It counts as a set, and as one game in game difference.
- The match ends when one side has won the sets it needs. There are no draws.
- The browser checks scores as they are typed. The server checks them again and is the authority.
- Clearing a result removes the score and any score-card photo, after a confirmation.
- Results display as a set line from the left-hand side's view, for example `6-4 3-6 [10-8]` or `7-6(4) 6-2`. In a 7-6 set, the number in brackets is the loser's tiebreak points.

## Standings

Tables show played, won, lost, set difference, game difference and points. Ties are split by:

1. set difference
2. game difference
3. a head-to-head mini-league among the entrants still tied
4. name

Scores still waiting for approval count, and their rows are marked.

## Ladder

- Admins set the starting order. Anyone added later joins at the bottom.
- A player challenges someone up to the allowed number of places above them. Each entrant can be in one open challenge at a time.
- The challenge becomes a fixture with a play-by date. Either side enters the score as usual.
- If the challenger wins, they take the defender's place and everyone between moves down one. If the defender wins, nothing moves.
- Positions are recalculated from the starting order and every result, so editing or clearing a result always gives the right ladder.
- Admins can record a challenge for any two entrants and cancel unplayed challenges.

## Pages

**Public**

| Page | What it shows |
|---|---|
| Home | A carousel of the current competitions. A league card shows each group's leader, a knockout card shows the draw, and a ladder card shows the top five. |
| Standings | League tables and the points scheme. Shown in the menu when a league is on show. |
| Ladder | Positions, win/loss records, open challenges and Challenge buttons. Shown in the menu when a ladder is on show. |
| Fixtures | Matches to play. The V button opens the score form for people allowed to enter that match. Ladder challenges show their play-by date. |
| Results | Scores as set lines, winner in bold. Pending scores are marked in clay. |
| Rules | Placeholder for club rules, plus the format and points of every current competition, generated from the comp settings. |

**Admin**

| Page | What it does |
|---|---|
| Manage Comps | Create and edit comps. Groups, pair builder, entrants, linked knockout stage, ladder starting order. |
| Manage Players | Add and edit players (name, gender, active). See their pairs and comps. Delete unused pairs. |
| Manage Fixtures | Generate a round robin or a draw, add or edit fixtures, and list or cancel ladder challenges. |
| Accounts | Issue and revoke registration codes, issue reset codes, make admins or approvers, disable accounts. |

There are no bulk-load pages.

**Shared behaviour carried over from snooker**

- Contextual help: tap **?** then any control.
- Score-card photos stored privately.
- Entered-by and approved-by lines.
- The site installs as an app on Android and iOS.
- Shared confirm dialog, brief messages and the busy indicator.

## Look

- The Ierne crest is the home button.
- Court green is the accent and ball yellow-green the highlight; pending items are clay.
- The hero images are original court-line artwork, so there are no licensing questions. Club photos can replace `assets/images/court-hero.svg` and `court-banner.svg` later.
- App icons are the crest on court green.

## Technical design

- Static HTML, CSS and vanilla JS on GitHub Pages, with no build step.
- One Supabase Edge Function, `ierne-tennis-api`, over the `ierne_tennis` schema on the shared Apps project.
- Details are in `docs/SUPABASE_SETUP.md`.
- Every browser storage key, event name and cache is prefixed for tennis, so the app never interferes with ierne-snooker on the same origin.

## Later phases (not built)

1. **Player profile page**: record, comps, recent results and head-to-head against any opponent.
2. **Play-by deadlines**: per round or per fixture for leagues and knockouts, overdue flags, and an admin walkover. Ladder challenges already carry a play-by date, but nothing enforces it yet.
3. **Retired, walkover and no-show results**: the `result_type` column already exists for this.
4. **Other ideas**
   - Seeded knockout draws from standings or a rating.
   - A calendar (.ics) feed of a player's fixtures.
   - Contact details visible to signed-in members only.
   - Box leagues with promotion and relegation between seasons.
   - Court booking is deliberately out of scope.
