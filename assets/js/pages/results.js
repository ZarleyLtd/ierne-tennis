// Results Page — match results with set scores. The score opens the shared
// result dialog (FixturesPage) for anyone allowed to edit it.

var ResultsPage = {
  _listenersBound: false,

  adminModeEvent: function () {
    return typeof AdminMode !== 'undefined' ? AdminMode.EVENT_NAME : 'ierne-tennis-admin-mode-changed';
  },

  fixtureGroup: function (row) {
    return String(row['Group'] || '').trim();
  },

  selectedLeague: function () {
    if (typeof LeagueGroupFilter !== 'undefined') return LeagueGroupFilter.selected();
    return 'All';
  },

  refreshAndLoad: async function () {
    if (typeof LeagueGroupFilter !== 'undefined') await LeagueGroupFilter.sync();
    return this.loadResults();
  },

  init: async function () {
    var container = document.getElementById('results-list');
    if (!container) return;
    var self = this;
    function reload() {
      self.loadResults().catch(function (e) {
        console.error(e);
      });
    }

    if (!this._listenersBound) {
      this._listenersBound = true;
      window.addEventListener(this.adminModeEvent(), reload);
      window.addEventListener(
        typeof PlayerSession !== 'undefined' ? PlayerSession.EVENT_NAME : 'ierne-tennis-player-session-changed',
        reload
      );
      if (typeof CurrentCompetition !== 'undefined') {
        if (typeof NavCompetition !== 'undefined') NavCompetition.syncFromSession();
        window.addEventListener(CurrentCompetition.EVENT_NAME, function () {
          self.refreshAndLoad().catch(function (e) {
            console.error(e);
          });
        });
      }
      if (typeof FixturesPage !== 'undefined') window.addEventListener(FixturesPage.RESULT_SAVED_EVENT, reload);
      if (typeof LeagueGroupFilter !== 'undefined') LeagueGroupFilter.bindChange(reload);
    }
    if (typeof FixturesPage !== 'undefined') FixturesPage.bindResultDialog();

    if (typeof CurrentCompetition !== 'undefined') {
      await CurrentCompetition.whenReady(function () {
        return self.refreshAndLoad();
      });
    } else {
      await this.loadResults();
    }
  },

  loadResults: async function () {
    var container = document.getElementById('results-list');
    if (!container) return;
    try {
      var params = { action: 'getFixtures' };
      if (typeof CurrentCompetition !== 'undefined') Object.assign(params, CurrentCompetition.apiParams());
      else params.competitionType = 'league';
      var result = await ApiClient.get(params);
      var data = result.fixtures || [];

      var isKnockout = typeof CurrentCompetition !== 'undefined' && CurrentCompetition.isKnockout();
      var isLadder = typeof CurrentCompetition !== 'undefined' && CurrentCompetition.isLadder();
      var group = this.selectedLeague();

      var rows = data.filter(function (r) {
        var has = r['Game Week'] && r['Player A'] && r['Player B'] && r['Result'] && String(r['Result']).trim() !== '';
        if (!has) return false;
        if (typeof KnockoutRounds !== 'undefined' && KnockoutRounds.isByeFixture && KnockoutRounds.isByeFixture(r)) {
          return false;
        }
        if (
          String(r['Game Week'] || '').trim() === 'GF-R' &&
          typeof KnockoutRounds !== 'undefined' &&
          KnockoutRounds.shouldShowGrandFinalReset &&
          !KnockoutRounds.shouldShowGrandFinalReset(data)
        ) {
          return false;
        }
        var stage = String(r.Stage || '').toLowerCase();
        if (!isKnockout && stage === 'knockout') return false;
        if (isKnockout || isLadder || group === 'All') return true;
        return ResultsPage.fixtureGroup(r) === group;
      });

      if (rows.length === 0) {
        container.innerHTML = '<p><em>No results available yet.</em></p>';
        return;
      }

      var opts = { isKnockout: isKnockout, isLadder: isLadder, fixtures: data };
      var grouped;
      if (isKnockout && typeof KnockoutRounds !== 'undefined') {
        opts.winnersByCode = KnockoutRounds.buildRoundWinnersMap(data);
        opts.losersByCode = KnockoutRounds.buildRoundLosersMap ? KnockoutRounds.buildRoundLosersMap(data) : {};
        var koGroup = KnockoutRounds.groupForList(rows, data);
        grouped = { grouped: koGroup.grouped, orderedWeeks: koGroup.orderedKeys };
        opts.sectionLabels = koGroup.labels;
      } else if (isLadder) {
        rows.sort(function (x, y) {
          return String(y.resultPostedAt || '').localeCompare(String(x.resultPostedAt || ''));
        });
        grouped = { grouped: { ladder: rows }, orderedWeeks: ['ladder'] };
        opts.sectionLabels = { ladder: 'Ladder matches (newest first)' };
      } else {
        grouped = FixturesPage.groupByGameWeek(rows);
      }
      this.renderGroups(container, grouped.grouped, grouped.orderedWeeks, opts);
    } catch (error) {
      console.error('Failed to load results:', error);
      container.innerHTML = '<p><em>Error loading results.</em></p>';
    }
  },

  renderGroups: function (container, grouped, orderedWeeks, options) {
    options = options || {};
    var isKnockout = !!options.isKnockout;
    var winnersByCode = options.winnersByCode || {};
    var losersByCode = options.losersByCode || {};
    container.innerHTML = '';

    orderedWeeks.forEach(function (week) {
      var h3 = document.createElement('h3');
      h3.className = 'fixture-week-heading';
      h3.textContent = FixturesPage.sectionHeading(week, options);
      h3.setAttribute('data-help', 'fixtures.week');
      container.appendChild(h3);

      grouped[week].forEach(function (match) {
        var div = document.createElement('div');
        div.className = 'fixture-row result-row';
        div.setAttribute('data-help', 'fixtures.match');

        var fid = String(match.fixtureId || '').trim();
        var nameA = match['Player A'] || '';
        var nameB = match['Player B'] || '';
        if (isKnockout) {
          nameA = FixturesPage.knockoutPlayerLabel(match, 'a', winnersByCode, losersByCode, options.fixtures);
          nameB = FixturesPage.knockoutPlayerLabel(match, 'b', winnersByCode, losersByCode, options.fixtures);
        }
        FixturesPage.setRowDataAttributes(div, match, nameA, nameB);
        var unapproved = FixturesPage.isUnapprovedResult(match);
        var aWon = Number(match.scoreA) > Number(match.scoreB);
        var line = match.setLine || String(match['Result'] || '').trim();

        var playerA = FixturesPage.makePlayerNameEl(nameA, 'right');
        var playerB = FixturesPage.makePlayerNameEl(nameB, 'left');
        (aWon ? playerA : playerB).classList.add('fixture-player-name--winner');

        var resultEl;
        var canEdit = FixturesPage.canEditFixture(match.sideAPlayerIds, match.sideBPlayerIds, match.resultPostedAt || '');
        if (canEdit && fid) {
          resultEl = document.createElement('button');
          resultEl.type = 'button';
          resultEl.className = 'results-score-btn';
          resultEl.setAttribute('data-help', 'results.score');
          resultEl.setAttribute('aria-label', 'Edit result ' + line + ': ' + nameA + ' vs ' + nameB);
          resultEl.addEventListener('click', function () {
            FixturesPage.openResultDialog(div);
          });
        } else {
          resultEl = document.createElement('span');
          resultEl.className = 'results-score';
          resultEl.setAttribute('data-help', 'results.scoreStatic');
        }
        resultEl.textContent = line;
        if (unapproved) {
          resultEl.classList.add('is-unapproved');
          if (resultEl.tagName === 'BUTTON') {
            resultEl.setAttribute('aria-label', 'Unapproved result ' + line + ': ' + nameA + ' vs ' + nameB);
          }
        }

        div.appendChild(playerA);
        div.appendChild(resultEl);
        div.appendChild(playerB);
        var wrap = document.createElement('div');
        wrap.className = 'fixture-row-wrap';
        wrap.appendChild(div);
        container.appendChild(wrap);
      });
    });
  },
};
