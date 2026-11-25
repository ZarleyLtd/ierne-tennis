/**
 * Contextual-help copy for ierne-tennis.
 * Pages are keyed by body[data-page]. Topics are keyed by data-help.
 * Copy describes the feature, never a particular player, match, or score.
 */
window.IerneHelpCatalog = {
  pages: {
    home: {
      title: 'Home',
      body: 'The competitions running now. Arrows move between them. A league card shows who leads each group, a knockout card shows the draw, and a ladder card shows the top five.'
    },
    standings: {
      title: 'Standings',
      body: 'League tables for the league on show. Ranking is by points, then set difference, then game difference, then head-to-head between the tied entrants.'
    },
    ladder: {
      title: 'Ladder',
      body: 'Everyone on the ladder in order. Challenge someone a few places above you; win and you take their place. Open challenges show who is playing whom and the date to play by.'
    },
    fixtures: {
      title: 'Fixtures',
      body: 'Matches still to play, or still waiting for approval, in the competition named under the title. A V button opens the score form when you are allowed to enter that match.'
    },
    results: {
      title: 'Results',
      body: 'Scores already entered, set by set, for the competition on show. A score you can still change is a button.'
    },
    rules: {
      title: 'Rules',
      body: 'Club rules, plus the match format and points for each competition running now.'
    },
    error: {
      title: 'Page not found',
      body: 'This address does not match a page. Go home, or open another page from the menu.'
    },
    'admin-comps': {
      title: 'Manage comps',
      body: 'Create leagues, knockouts, double-eliminators and ladders. Set singles or doubles, the match format, league points, groups and entrants. Unlock Admin Mode from the menu first.'
    },
    'admin-players': {
      title: 'Manage players',
      body: 'Add a player, or open one to edit their name, gender and active flag. Unlock Admin Mode from the menu first.'
    },
    'admin-player': {
      title: 'Edit player',
      body: 'Change this player’s details and see the doubles pairs and comps they are in. Unlock Admin Mode from the menu first.'
    },
    'admin-fixtures': {
      title: 'Manage fixtures',
      body: 'Pick a comp, then generate its fixtures, add a match, or tap V to edit one. Ladder comps list their challenges here. Unlock Admin Mode from the menu first.'
    },
    'admin-accounts': {
      title: 'Accounts',
      body: 'Issue one-time registration codes, revoke unused codes, and choose who is an admin or an approver. Unlock Admin Mode from the menu first.'
    }
  },

  topics: {
    // ---------- Header, menu and footer ----------
    'chrome.logo': { title: 'Home', body: 'The club crest. Goes to the home page.' },
    'chrome.menu': { title: 'Menu', body: 'Opens the list of pages. On a wide screen the same links stay in the header.' },
    'chrome.navHome': { title: 'Home', body: 'Opens the home page and its competition cards.' },
    'chrome.navStandings': { title: 'Standings', body: 'Opens the league tables. Shown while a league is the competition on show.' },
    'chrome.navLadder': { title: 'Ladder', body: 'Opens the ladder. Shown while a ladder is the competition on show.' },
    'chrome.navFixtures': { title: 'Fixtures', body: 'Opens the matches still to play in the competition on show.' },
    'chrome.navResults': { title: 'Results', body: 'Opens the scores already entered in the competition on show.' },
    'chrome.navRules': { title: 'Rules', body: 'Opens the club rules and each competition’s format.' },
    'chrome.navManageComps': { title: 'Manage comps', body: 'Opens the admin screen for competitions, groups and entrants. Shown only while Admin Mode is unlocked.' },
    'chrome.navManagePlayers': { title: 'Manage players', body: 'Opens the admin list of players. Shown only while Admin Mode is unlocked.' },
    'chrome.navManageFixtures': { title: 'Manage fixtures', body: 'Opens the admin list of matches. Shown only while Admin Mode is unlocked.' },
    'chrome.navAccounts': { title: 'Accounts', body: 'Opens registration codes and accounts. Shown only while Admin Mode is unlocked.' },
    'chrome.connect': { title: 'Connect', body: 'Signs in with your handle and password. Signed-in players can enter their own scores and make ladder challenges.' },
    'chrome.account': { title: 'Signed in', body: 'The handle you are signed in as.' },
    'chrome.signOut': { title: 'Sign out', body: 'Signs this device out. You can still read everything without signing in.' },
    'chrome.adminToggle': { title: 'Admin Mode', body: 'Unlocks or locks the manage pages with the club admin secret. Admin accounts do not need the secret while signed in.' },
    'chrome.close': { title: 'Close', body: 'Closes this panel without saving.' },
    'chrome.compName': { title: 'Competition', body: 'The competition on show. Change it with the arrows on the home page.' },
    'chrome.groupFilter': { title: 'Group filter', body: 'Shows one group only. Tap the selected group again to show every group.' },
    'chrome.backToTop': { title: 'Back to top', body: 'Scrolls to the top of the page.' },
    'chrome.credit': { title: 'Created by JP', body: 'Who made this site. Tap the JP logo to watch it come apart into a J and a P and fold back together.' },
    'error.home': { title: 'Go home', body: 'Leaves this missing page and opens the home page.' },

    // ---------- Home ----------
    'home.prev': { title: 'Previous competition', body: 'Moves to the previous competition running now. The title and the card both change.' },
    'home.next': { title: 'Next competition', body: 'Moves to the next competition running now. The title and the card both change.' },
    'home.title': { title: 'Competition name', body: 'The competition in view. Fixtures, results, standings and the ladder follow this choice.' },
    'home.carousel': { title: 'Competition card', body: 'League leaders, a knockout draw, or the top of a ladder, depending on the competition. Use the arrows to change competition.' },
    'home.card': { title: 'Competition card', body: 'Leaders for a league, the draw for a knockout or double-eliminator, or the top five of a ladder.' },

    // ---------- Brackets ----------
    'bracket.prev': { title: 'Earlier round', body: 'Shows the previous round of this draw.' },
    'bracket.next': { title: 'Later round', body: 'Shows the next round of this draw.' },
    'bracket.stage': { title: 'Round', body: 'The round currently drawn. The arrows move to the rounds before and after it.' },
    'bracket.match': { title: 'Match', body: 'One match in this round. Each line shows a player or pair and the games they won in each set.' },

    // ---------- Standings ----------
    'leagues.group': { title: 'Group table', body: 'Standings for one group: played, won, lost, set difference, game difference and points.' },
    'leagues.row': { title: 'Table row', body: 'One player or pair. A row marked with an asterisk includes a score still waiting for approval; it already counts.' },
    'leagues.pending': { title: 'Pending results', body: 'At least one score in this table has been entered by a player and not approved yet. It still counts.' },
    'leagues.points': { title: 'Points', body: 'How this league awards points. Each competition can use its own scheme.' },

    // ---------- Ladder ----------
    'ladder.list': { title: 'Ladder', body: 'Everyone on the ladder, top first, with their wins and losses in ladder matches.' },
    'ladder.row': { title: 'Ladder place', body: 'A position, the player or pair in it, and any open challenge they are part of.' },
    'ladder.rules': { title: 'Ladder rules', body: 'How far up you may challenge and how long a challenge stays open. These are set for each ladder.' },
    'ladder.challenge': { title: 'Challenge', body: 'Challenges this player or pair. The match appears on the Fixtures page; win it and you take their place.' },
    'ladder.open': { title: 'Open challenge', body: 'A challenge waiting to be played, with the date to play by. Each entrant can be in one open challenge at a time.' },
    'ladder.challenges': { title: 'Open challenges', body: 'Ladder matches waiting to be played. Either side can enter the score after playing.' },
    'ladder.playBy': { title: 'Play by', body: 'The last day to play this challenge.' },
    'ladder.cancel': { title: 'Cancel challenge', body: 'Removes a challenge that has not been played. Nobody moves on the ladder.' },
    'ladder.adminRecord': { title: 'Record a challenge', body: 'Admins can record a challenge for any two entrants, for example one agreed in person.' },

    // ---------- Fixtures and results ----------
    'fixtures.week': { title: 'Round', body: 'Matches grouped by league week or by knockout round.' },
    'fixtures.match': { title: 'Match', body: 'The two players or pairs due to play. A V button means you can enter the score.' },
    'fixtures.enter': { title: 'Enter score', body: 'Opens the score form for this match. Players in the match, approvers and admins can use it.' },
    'fixtures.closed': { title: 'Match', body: 'You cannot enter this score: sign in as a player in the match, or wait until both sides of a knockout match are known.' },
    'results.score': { title: 'Score', body: 'The set scores, from the left-hand side’s view. Tap to edit while you still can.' },
    'results.scoreStatic': { title: 'Score', body: 'The set scores, from the left-hand side’s view. A number in brackets after 7-6 is the loser’s tiebreak points; [10-8] is a match tiebreak.' },

    // ---------- Result form ----------
    'result.dialog': { title: 'Score form', body: 'Enter the games in each set until one side wins the match, then Save.' },
    'result.date': { title: 'Match date', body: 'The day the match was played. Type it, or use the calendar button.' },
    'result.datePicker': { title: 'Calendar', body: 'Picks the match date from a calendar.' },
    'result.format': { title: 'Match format', body: 'How many sets this match is played over and how the deciding set is played.' },
    'result.sets': { title: 'Set scores', body: 'Tap the ball to add a game and the minus to remove one. The next set appears when a set is finished. A match tiebreak is scored in points to 10.' },
    'result.tiebreak': { title: 'Tiebreak points', body: 'Optional. The points in the tiebreak that decided a 7-6 set.' },
    'result.clear': { title: 'Clear result', body: 'Removes this score so the match shows as unplayed. You are asked to confirm first. In a knockout, a result stays once a player has played a later round (the score can still be corrected if the winner stays the same): clear that later result first.' },
    'result.save': { title: 'Save', body: 'Saves the score. A player’s score waits for approval; an approver’s or admin’s is approved at once.' },
    'result.cancel': { title: 'Cancel', body: 'Closes the form without saving.' },
    'result.approve': { title: 'Approve', body: 'Approves a score that a player entered. Only approvers and admins see this.' },
    'result.slip': { title: 'Score card photo', body: 'Adds an optional photo of the score card. Only people who can edit this result can see it.' },
    'result.slipTake': { title: 'Take photo', body: 'Opens the camera to photograph the score card.' },
    'result.slipGallery': { title: 'Choose photo', body: 'Picks an existing photo of the score card.' },
    'result.slipPhoto': { title: 'Photo', body: 'The score card photo for this match.' },
    'result.slipReplace': { title: 'Replace photo', body: 'Swaps the score card photo for a new one.' },
    'result.slipRemove': { title: 'Remove photo', body: 'Deletes the score card photo.' },
    'result.slipCancel': { title: 'Cancel', body: 'Closes the photo options.' },

    // ---------- Rules ----------
    'rules.body': { title: 'Rules', body: 'The club’s tennis rules and how results are entered.' },
    'rules.comp': { title: 'Competition format', body: 'The type, singles or doubles, match format and points for a competition running now.' },

    // ---------- Sign-in sheet ----------
    'sheet.connect': { title: 'Connect', body: 'Signs in with a handle and password. A signed-in player can enter their own scores. An admin account also unlocks the manage pages.' },
    'sheet.registerLink': { title: 'Register', body: 'Opens registration. You need a one-time code from an admin, and you pick yourself from the player list.' },
    'sheet.handle': { title: 'Handle', body: 'The name you sign in with: 3 to 20 lower-case letters or digits. It is not shown on the tables.' },
    'sheet.password': { title: 'Password', body: 'The password for this handle, at least 8 characters.' },
    'sheet.connectSubmit': { title: 'Connect', body: 'Signs in. A wrong handle or password stays on this panel with the reason.' },
    'sheet.forgot': { title: 'Forgot password', body: 'Opens the reset form. An admin must first give you a one-time reset code.' },
    'sheet.register': { title: 'Register', body: 'Creates an account from a one-time code, a new handle, a password and your player name.' },
    'sheet.regCode': { title: 'Registration code', body: 'The one-time code an admin gave you. It works once and expires after 30 days.' },
    'sheet.playerPick': { title: 'Your name', body: 'The player this account belongs to. Only players without an account are listed.' },
    'sheet.registerSubmit': { title: 'Register', body: 'Creates the account and signs you in.' },
    'sheet.reset': { title: 'Reset password', body: 'Sets a new password using a one-time code from an admin. The code lasts 24 hours.' },
    'sheet.resetCode': { title: 'Reset code', body: 'The one-time code from an admin. It lasts 24 hours and works once.' },
    'sheet.resetSubmit': { title: 'Update password', body: 'Saves the new password, then returns to Connect.' },
    'sheet.secret': { title: 'Admin secret', body: 'The club admin secret. It unlocks the manage pages on this device for 24 hours.' },
    'sheet.unlock': { title: 'Unlock Admin Mode', body: 'Turns on the manage pages for this browser tab.' },
    'sheet.unlockSubmit': { title: 'Unlock', body: 'Checks the secret and unlocks Admin Mode.' },
    'sheet.cancel': { title: 'Cancel', body: 'Closes this panel.' },
    'sheet.confirm': { title: 'Confirm', body: 'Choose whether to go ahead.' },

    // ---------- Manage comps ----------
    'adminComps.add': { title: 'Add comp', body: 'Starts a new competition.' },
    'adminComps.list': { title: 'Comps', body: 'Every competition, newest first. Current ones are highlighted. Tap one to edit it.' },
    'adminComps.row': { title: 'Comp', body: 'Opens this competition’s settings, groups and entrants.' },
    'adminComps.dialog': { title: 'Comp settings', body: 'Name, type, singles or doubles, match format and points. Save first, then add groups and entrants.' },
    'adminComps.name': { title: 'Name', body: 'The name shown on every page, for example “Summer League 2026”.' },
    'adminComps.type': { title: 'Type', body: 'League (groups and tables), knockout, double-eliminator, or ladder. Locked once entrants are added.' },
    'adminComps.format': { title: 'Format', body: 'Singles are entered by players. Doubles and mixed doubles are entered by pairs. Locked once entrants are added.' },
    'adminComps.current': { title: 'Current', body: 'Current competitions appear on the home page and drive the public pages. Several can be current at once.' },
    'adminComps.matchFormat': { title: 'Match format', body: 'The default for every match in this comp: number of sets, games per set, and whether the deciding set is a match tiebreak. Single fixtures can be changed on Manage Fixtures.' },
    'adminComps.points': { title: 'League points', body: 'Points for a win and a loss, a bonus for losing but winning a set, and points per set won. Pick a preset or set your own.' },
    'adminComps.ladder': { title: 'Ladder rules', body: 'How many places above themselves a player may challenge, and how many days a challenge stays open.' },
    'adminComps.ladderOrder': { title: 'Starting order', body: 'The ladder before any matches. Results are replayed from this order, so changing it changes current positions.' },
    'adminComps.pairs': { title: 'Make a pair', body: 'Doubles entrants are pairs. Make a pair once, then tick it in any doubles comp.' },
    'adminComps.players': { title: 'Entrants', body: 'Tick the players or pairs in this comp. Saved with Save Comp.' },
    'adminComps.addGroup': { title: 'Add group', body: 'Adds a group to this league. Each group plays its own round robin.' },
    'adminComps.group': { title: 'Group', body: 'Opens the group to rename it or change who is in it.' },
    'adminComps.groupId': { title: 'Group id', body: 'A short id such as 1 or a. Lower-case letters, numbers and hyphens.' },
    'adminComps.groupName': { title: 'Display name', body: 'The heading shown on the standings, for example “Group A”.' },
    'adminComps.groupOrder': { title: 'Order', body: 'Groups are listed from the lowest number up.' },
    'adminComps.groupPlayers': { title: 'Group entrants', body: 'Tick who plays in this group. Anyone already in another group is not listed.' },
    'adminComps.removeGroup': { title: 'Remove group', body: 'Deletes an empty group. Untick its entrants first.' },
    'adminComps.saveGroup': { title: 'Save group', body: 'Saves the group name and its entrants.' },
    'adminComps.knockoutStage': { title: 'Knockout stage', body: 'A knockout that follows this league. It appears on the league’s home card once it has matches.' },
    'adminComps.addKnockout': { title: 'Add knockout stage', body: 'Creates a knockout linked to this league, with the same format.' },
    'adminComps.delete': { title: 'Delete comp', body: 'Deletes the competition, its groups and fixtures. Refused while it has results.' },
    'adminComps.cancel': { title: 'Cancel', body: 'Closes without saving.' },
    'adminComps.save': { title: 'Save comp', body: 'Saves the settings and, for knockouts and ladders, the ticked entrants.' },

    // ---------- Manage fixtures ----------
    'adminFx.comp': { title: 'Comp', body: 'The competition whose fixtures are listed.' },
    'adminFx.add': { title: 'Add fixture', body: 'Adds one match by hand.' },
    'adminFx.generate': { title: 'Generate fixtures', body: 'Creates every match from the roster: a round robin for each league group, or a random draw for a knockout.' },
    'adminFx.regenerate': { title: 'Re-generate fixtures', body: 'Deletes all fixtures and makes a new set. Only offered while no match has been played.' },
    'adminFx.edit': { title: 'Edit fixture', body: 'Opens this match to change its round, sides or match length.' },
    'adminFx.dialog': { title: 'Fixture', body: 'The stage, round and the two sides of one match.' },
    'adminFx.stage': { title: 'Stage', body: 'Group matches count in the league table. Knockout matches do not.' },
    'adminFx.group': { title: 'Group', body: 'The league group this match belongs to.' },
    'adminFx.week': { title: 'Week', body: 'The league week. Fixtures are listed week by week.' },
    'adminFx.matchLength': { title: 'Match length', body: 'One set, best of three or best of five for this match. The rest of the format comes from the comp.' },
    'adminFx.round': { title: 'Round', body: 'The knockout round this match belongs to.' },
    'adminFx.customRound': { title: 'Round name', body: 'A name for a custom play-off round.' },
    'adminFx.player': { title: 'Side', body: 'A player or pair in the comp, or the winner or loser of an earlier knockout match.' },
    'adminFx.save': { title: 'Save fixture', body: 'Saves the match.' },
    'adminFx.delete': { title: 'Delete fixture', body: 'Deletes the match and any result. You are asked to confirm first.' },
    'adminFx.cancel': { title: 'Cancel', body: 'Closes without saving.' },

    // ---------- Players ----------
    'adminPlayers.add': { title: 'Add player', body: 'Opens a new player form.' },
    'adminPlayers.list': { title: 'Players', body: 'Everyone in the club’s tennis section. Tap a row to edit that player.' },
    'adminPlayers.row': { title: 'Player', body: 'Opens that player’s details, pairs and comps.' },
    'adminPlayer.back': { title: 'Players', body: 'Returns to the player list.' },
    'adminPlayer.name': { title: 'Name', body: 'The name shown on fixtures and tables. Each player’s name must be different.' },
    'adminPlayer.gender': { title: 'Gender', body: 'Optional. Used only to warn when a mixed doubles pair has two players of the same gender.' },
    'adminPlayer.active': { title: 'Active', body: 'Inactive players stay in old results but are left out of the pair builder.' },
    'adminPlayer.pairs': { title: 'Doubles pairs', body: 'The pairs this player is in. A pair that has never been entered in a comp can be deleted.' },
    'adminPlayer.deletePair': { title: 'Delete pair', body: 'Removes a pair that is in no comp and has no matches.' },
    'adminPlayer.comps': { title: 'Comps', body: 'The competitions this player is entered in, alone or as part of a pair. Tap one to open it.' },
    'adminPlayer.delete': { title: 'Delete player', body: 'Deletes the player. Refused while they are in a comp or have fixtures.' },
    'adminPlayer.cancel': { title: 'Cancel', body: 'Returns to the player list without saving.' },
    'adminPlayer.save': { title: 'Save player', body: 'Saves the name, gender and active flag.' },

    // ---------- Accounts ----------
    'accounts.note': { title: 'Note', body: 'An optional reminder of who the code is for. It is not the code.' },
    'accounts.issue': { title: 'Issue code', body: 'Creates a registration code. It is shown once, works once and expires after 30 days.' },
    'accounts.code': { title: 'New code', body: 'The code just issued. Copy or share it now; it cannot be looked up later.' },
    'accounts.copy': { title: 'Copy', body: 'Copies the code so you can paste it to the player.' },
    'accounts.share': { title: 'Share', body: 'Opens the device share sheet with the code. If sharing is unavailable, the code is copied instead.' },
    'accounts.invites': { title: 'Unused codes', body: 'Registration and reset codes not used yet. Revoke throws one away.' },
    'accounts.revoke': { title: 'Revoke', body: 'Cancels this unused code.' },
    'accounts.list': { title: 'Accounts', body: 'Handles that have registered. Tap one to change its rights or issue a password reset.' },
    'accounts.account': { title: 'Account', body: 'Opens that handle to make it an admin or approver, disable it, or issue a reset code.' },
    'accounts.dialog': { title: 'Account', body: 'An admin can use the manage pages while signed in. An approver can enter, edit and approve any score but cannot use the other admin tools.' },
    'accounts.admin': { title: 'Admin', body: 'Gives or removes admin rights.' },
    'accounts.approver': { title: 'Approver', body: 'Gives or removes approver rights. Scores an approver saves are approved at once.' },
    'accounts.reset': { title: 'Password reset', body: 'Issues a one-time reset code for this handle. It lasts 24 hours and is shown once.' },
    'accounts.disable': { title: 'Disable account', body: 'Stops this handle from signing in and signs it out everywhere.' }
  }
};
