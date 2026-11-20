// Standings Page — league tables for the now-showing league competition.

var StandingsPage = {
  init: async function () {
    if (!document.getElementById('leagues-standings-root')) return;
    const self = this;
    if (typeof CurrentCompetition === 'undefined') {
      return this.loadStandings({ competitionType: 'league' });
    }
    window.addEventListener(CurrentCompetition.EVENT_NAME, function () {
      self.loadStandings().catch(function (e) {
        console.error(e);
      });
    });
    await CurrentCompetition.whenReady(function () {
      return self.loadStandings();
    });
  },

  /** Standings belong to a league, even when the now-showing comp is its knockout stage. */
  leagueApiParams: function () {
    if (typeof CurrentCompetition === 'undefined') return { competitionType: 'league' };
    var comp = CurrentCompetition.get();
    if (comp && CurrentCompetition.isLeague()) return { comp: comp.compId };
    if (comp && CurrentCompetition.isLeagueKnockoutStage(comp)) {
      var parentId = String(comp.parentCompId || '').trim();
      if (parentId) return { comp: parentId };
    }
    var leagues = (CurrentCompetition.currentComps() || []).filter(function (c) {
      return CurrentCompetition.normalizeCompetitionType(c) === 'league';
    });
    if (leagues.length) return { comp: leagues[0].compId };
    return { competitionType: 'league' };
  },

  pointsSummary: function (comp) {
    if (!comp) return '';
    var parts = ['Win ' + comp.winPoints, 'loss ' + comp.lossPoints];
    if (comp.lossWithSetBonus) parts.push('+' + comp.lossWithSetBonus + ' for a loss with a set won');
    if (comp.setPoints) parts.push('+' + comp.setPoints + ' per set won');
    return 'Points: ' + parts.join(', ') + '.';
  },

  loadStandings: async function (params) {
    const root = document.getElementById('leagues-standings-root');
    try {
      const result = await ApiClient.get(Object.assign({ action: 'getStandings' }, params || this.leagueApiParams()));
      const groups = (result.groups || []).filter(function (grp) {
        return String(grp.groupId) !== 'ko';
      });
      var label = document.getElementById('page-competition-name');
      if (label && result.competition && result.competition.name) label.textContent = result.competition.name;
      var pts = document.getElementById('standings-points-note');
      if (pts) pts.textContent = this.pointsSummary(result.competition);
      this.renderGroups(root, groups);
    } catch (error) {
      console.error('Failed to load standings:', error);
      if (root) {
        root.innerHTML =
          '<p class="align-center"><em>' +
          (/No current league/i.test(String(error && error.message)) ? 'No league is running at the moment.' : 'Error loading standings.') +
          '</em></p>';
      }
    }
  },

  renderGroups: function (root, groups) {
    root.innerHTML = '';
    if (!groups.length) {
      root.innerHTML = '<p class="align-center"><em>No groups for this competition.</em></p>';
      return;
    }
    groups.forEach(function (grp) {
      const wrapper = document.createElement('div');
      wrapper.className = 'standings-wrapper';
      wrapper.setAttribute('data-help', 'leagues.group');
      const heading = document.createElement('h3');
      heading.className = 'standings-heading';
      heading.textContent = grp.name || 'Group ' + (grp.groupId || '');
      const tableHost = document.createElement('div');
      tableHost.className = 'standings-table-wrap';
      wrapper.appendChild(heading);
      wrapper.appendChild(tableHost);
      root.appendChild(wrapper);
      const rows = grp.rows || [];
      LeagueStandings.render(tableHost, rows);
      if (rows.some(function (r) { return r && r.unapproved; })) {
        const note = document.createElement('p');
        note.className = 'standings-pending-note';
        note.setAttribute('data-help', 'leagues.pending');
        note.textContent = '* some results are pending approval';
        wrapper.appendChild(note);
      }
    });
  },
};
