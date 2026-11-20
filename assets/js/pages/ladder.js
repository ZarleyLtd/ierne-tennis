// Ladder Page — positions, records and open challenges for a ladder comp.
// Positions are computed by the server (getLadder) by replaying results, so
// this page only displays them and offers Challenge / Cancel actions.

var LadderPage = {
  _comp: null,
  _rows: [],

  root: function () {
    return document.getElementById('ladder-root');
  },

  esc: function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  isAdmin: function () {
    return typeof AdminMode !== 'undefined' && AdminMode.isUnlocked();
  },

  myPlayerId: function () {
    if (typeof PlayerSession === 'undefined' || !PlayerSession.isSignedIn()) return '';
    return String(PlayerSession.playerId() || '').trim().toLowerCase();
  },

  /** The ladder row the signed-in player plays in (alone or as part of a pair). */
  myRow: function () {
    var me = this.myPlayerId();
    if (!me) return null;
    return (
      this._rows.find(function (r) {
        return (r.memberIds || []).some(function (id) {
          return String(id).toLowerCase() === me;
        });
      }) || null
    );
  },

  canChallenge: function (target) {
    var mine = this.myRow();
    if (!mine || !target || mine.entrantId === target.entrantId) return false;
    if (mine.openChallenge || target.openChallenge) return false;
    var range = (this._comp && this._comp.ladderChallengeRange) || 3;
    return target.position < mine.position && mine.position - target.position <= range;
  },

  /** Ladder to show: the now-showing comp when it is a ladder, else the first current ladder. */
  ladderCompId: function () {
    if (typeof CurrentCompetition === 'undefined') return null;
    if (CurrentCompetition.isLadder()) return CurrentCompetition.getCompId();
    var url = null;
    try {
      url = new URLSearchParams(window.location.search).get('comp');
    } catch (_e) {
      /* ignore */
    }
    var comps = CurrentCompetition.allComps();
    var fromUrl = comps.find(function (c) {
      return String(c.compId) === String(url) && CurrentCompetition.isLadderComp(c);
    });
    if (fromUrl) return fromUrl.compId;
    var current = CurrentCompetition.currentComps().find(function (c) {
      return CurrentCompetition.isLadderComp(c);
    });
    return current ? current.compId : null;
  },

  init: async function () {
    if (!this.root()) return;
    var self = this;
    function reload() {
      self.load().catch(function (e) {
        console.error(e);
      });
    }
    window.addEventListener(
      typeof AdminMode !== 'undefined' ? AdminMode.EVENT_NAME : 'ierne-tennis-admin-mode-changed',
      reload
    );
    window.addEventListener(
      typeof PlayerSession !== 'undefined' ? PlayerSession.EVENT_NAME : 'ierne-tennis-player-session-changed',
      reload
    );
    if (typeof CurrentCompetition !== 'undefined') {
      window.addEventListener(CurrentCompetition.EVENT_NAME, reload);
      await CurrentCompetition.whenReady(function () {
        return self.load();
      });
    }
    this.root().addEventListener('click', function (e) {
      var challenge = e.target.closest('[data-challenge]');
      if (challenge) {
        self.challenge(challenge.getAttribute('data-challenge'), challenge).catch(function (err) {
          self.brief((err && err.message) || 'Could not send the challenge', challenge);
        });
        return;
      }
      var cancel = e.target.closest('[data-cancel-challenge]');
      if (cancel) {
        self.cancelChallenge(cancel.getAttribute('data-cancel-challenge'), cancel).catch(function (err) {
          self.brief((err && err.message) || 'Could not cancel the challenge', cancel);
        });
        return;
      }
      var record = e.target.closest('#ladder-admin-record');
      if (record) {
        self.adminRecordChallenge(record).catch(function (err) {
          self.brief((err && err.message) || 'Could not record the challenge', record);
        });
      }
    });
  },

  brief: function (text, anchor) {
    if (typeof window.BriefMessage !== 'undefined' && window.BriefMessage.show) {
      window.BriefMessage.show(text, anchor, { durationMs: 1600 });
    }
  },

  load: async function () {
    var root = this.root();
    var compId = this.ladderCompId();
    var label = document.getElementById('page-competition-name');
    if (!compId) {
      if (label) label.textContent = '';
      root.innerHTML = '<p class="align-center"><em>No ladder is running at the moment.</em></p>';
      return;
    }
    try {
      var res = await ApiClient.get({ action: 'getLadder', comp: compId });
      this._comp = res.competition || null;
      this._rows = res.rows || [];
      if (label && this._comp) label.textContent = this._comp.name;
      this.render();
    } catch (err) {
      console.error('Failed to load ladder:', err);
      root.innerHTML = '<p class="align-center"><em>Error loading the ladder.</em></p>';
    }
  },

  formatDate: function (iso) {
    if (!iso) return '';
    return typeof Formatters !== 'undefined' && Formatters.formatMatchDateDisplay
      ? Formatters.formatMatchDateDisplay(iso)
      : iso;
  },

  render: function () {
    var root = this.root();
    var self = this;
    var comp = this._comp || {};
    var html =
      '<p class="ladder-rules" data-help="ladder.rules">Challenge anyone up to ' +
      (comp.ladderChallengeRange || 3) +
      ' places above you. Win and you take their place. Challenges must be played within ' +
      (comp.ladderChallengeDays || 14) +
      ' days.</p>';

    if (!this._rows.length) {
      root.innerHTML = html + '<p class="align-center"><em>Nobody is on this ladder yet.</em></p>';
      return;
    }

    var mine = this.myRow();
    html += '<ol class="ladder-list">';
    this._rows.forEach(function (r) {
      var isMe = mine && mine.entrantId === r.entrantId;
      html += '<li class="ladder-row' + (isMe ? ' ladder-row--me' : '') + '" data-help="ladder.row">';
      html += '<span class="ladder-row__pos">' + r.position + '</span>';
      html += '<span class="ladder-row__main"><span class="ladder-row__name">' + self.esc(r.name) + '</span>';
      html += '<span class="ladder-row__record">' + r.won + 'W ' + r.lost + 'L</span>';
      if (r.openChallenge) {
        var c = r.openChallenge;
        html +=
          '<span class="ladder-row__challenge" data-help="ladder.open">' +
          (c.role === 'challenger' ? 'Challenging ' : 'Challenged by ') +
          self.esc(c.opponentName) +
          (c.playBy ? ' · play by ' + self.esc(self.formatDate(c.playBy)) : '') +
          '</span>';
      }
      html += '</span>';
      if (self.canChallenge(r)) {
        html +=
          '<button type="button" class="ladder-row__btn" data-challenge="' + self.esc(r.entrantId) +
          '" data-help="ladder.challenge">Challenge</button>';
      } else if (r.openChallenge && r.openChallenge.role === 'challenger' && self.isAdmin()) {
        html +=
          '<button type="button" class="ladder-row__btn ladder-row__btn--cancel" data-cancel-challenge="' +
          self.esc(r.openChallenge.fixtureId) + '" data-help="ladder.cancel">Cancel</button>';
      }
      html += '</li>';
    });
    html += '</ol>';

    if (this.isAdmin()) {
      var options = this._rows
        .map(function (r) {
          return '<option value="' + self.esc(r.entrantId) + '">' + r.position + '. ' + self.esc(r.name) + '</option>';
        })
        .join('');
      html +=
        '<div class="ladder-admin" data-help="ladder.adminRecord">' +
        '<h3>Record a challenge</h3>' +
        '<label>Challenger <select id="ladder-admin-challenger">' + options + '</select></label>' +
        '<label>Defender <select id="ladder-admin-defender">' + options + '</select></label>' +
        '<button type="button" class="btn" id="ladder-admin-record">Record challenge</button>' +
        '</div>';
    }
    root.innerHTML = html;
  },

  rowById: function (entrantId) {
    return this._rows.find(function (r) {
      return r.entrantId === entrantId;
    });
  },

  challenge: async function (defenderId, anchor) {
    var target = this.rowById(defenderId);
    if (!target) return;
    var days = (this._comp && this._comp.ladderChallengeDays) || 14;
    var ok = await ConfirmDialog.show({
      title: 'Challenge ' + target.name + '?',
      message: 'You will have ' + days + ' days to play the match. If you win, you take position ' + target.position + '.',
      confirmLabel: 'Send challenge',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    await WorkingIndicator.withWorking(
      ApiClient.post('createChallenge', { compId: this._comp.compId, defenderId: defenderId }),
      'Sending challenge…'
    );
    await this.load();
    this.brief('Challenge sent. It is on the Fixtures page.', document.querySelector('.ladder-row--me') || anchor);
  },

  cancelChallenge: async function (fixtureId, anchor) {
    var ok = await ConfirmDialog.show({
      title: 'Cancel this challenge?',
      message: 'The match will be removed and nobody moves on the ladder.',
      confirmLabel: 'Cancel challenge',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    await WorkingIndicator.withWorking(ApiClient.post('cancelChallenge', { fixtureId: fixtureId }), 'Cancelling…');
    await this.load();
    this.brief('Challenge cancelled', this.root());
  },

  adminRecordChallenge: async function (anchor) {
    var challengerId = (document.getElementById('ladder-admin-challenger') || {}).value;
    var defenderId = (document.getElementById('ladder-admin-defender') || {}).value;
    if (!challengerId || !defenderId || challengerId === defenderId) {
      this.brief('Choose two different entrants', anchor);
      return;
    }
    await WorkingIndicator.withWorking(
      ApiClient.post('createChallenge', { compId: this._comp.compId, challengerId: challengerId, defenderId: defenderId }),
      'Recording challenge…'
    );
    await this.load();
    this.brief('Challenge recorded', this.root());
  },
};

// Rules page — club rules text plus each current competition's format and points.
var RulesPage = {
  init: async function () {
    var host = document.getElementById('rules-format');
    if (!host || typeof CurrentCompetition === 'undefined') return;
    await CurrentCompetition.whenReady(function () {
      RulesPage.render(host);
    });
  },

  typeLabel: function (comp) {
    var t = CurrentCompetition.normalizeCompetitionType(comp);
    if (t === 'double-eliminator') return 'Double-eliminator';
    if (t === 'knockout') return 'Knockout';
    if (t === 'ladder') return 'Ladder';
    return 'League';
  },

  formatLabel: function (comp) {
    if (comp.format === 'doubles') return 'doubles';
    if (comp.format === 'mixed') return 'mixed doubles';
    return 'singles';
  },

  render: function (host) {
    var comps = CurrentCompetition.currentComps();
    if (!comps.length) {
      host.innerHTML = '<p><em>No competitions are running at the moment.</em></p>';
      return;
    }
    var html = '';
    comps.forEach(function (c) {
      html += '<section class="rules-comp" data-help="rules.comp"><h3>' + LadderPage.esc(c.name) + '</h3><ul>';
      html += '<li>' + RulesPage.typeLabel(c) + ', ' + RulesPage.formatLabel(c) + '.</li>';
      html += '<li>' + TennisScore.describeFormat(c) + '.</li>';
      if (CurrentCompetition.normalizeCompetitionType(c) === 'league') {
        html += '<li>' + StandingsPage.pointsSummary(c) + ' Ties are split by set difference, then game difference, then head-to-head.</li>';
      }
      if (CurrentCompetition.isLadderComp(c)) {
        html +=
          '<li>Challenge up to ' + c.ladderChallengeRange + ' places above you; play within ' +
          c.ladderChallengeDays + ' days. The challenger takes the defender’s place on a win.</li>';
      }
      html += '</ul></section>';
    });
    host.innerHTML = html;
  },
};
