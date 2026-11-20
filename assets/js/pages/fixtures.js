// Fixtures Page — upcoming list + set-by-set result entry.
// The result dialog is shared with the Results page (results.js calls
// FixturesPage.openResultDialog with a row element carrying data-* attributes).

var FixturesPage = {
  /** Dispatched on successful Save from the result dialog (fixtures or results page). */
  RESULT_SAVED_EVENT: 'ierne-tennis-fixture-result-saved',

  /** A player may edit their own match until 24 hours after the result is first posted. */
  RESULT_EDIT_MS: 24 * 60 * 60 * 1000,

  MAX_TIEBREAK_POINTS: 40,

  _format: null,
  _sets: [],
  _dialogOpenedWithResult: false,
  _openResultPostedAt: '',
  _openMembersA: [],
  _openMembersB: [],
  _slipPendingUploaded: false,
  _slipHasCommitted: false,
  _slipSaveSucceeded: false,
  _slipSuppressDiscardOnClose: false,
  _resultSlipUploadInited: false,
  _resultDialogBindingsDone: false,

  // ---------- Roles -----------------------------------------------------------

  adminModeEvent: function () {
    return typeof AdminMode !== 'undefined' ? AdminMode.EVENT_NAME : 'ierne-tennis-admin-mode-changed';
  },

  isAdmin: function () {
    return typeof AdminMode !== 'undefined' && AdminMode.isUnlocked();
  },

  isApproverAccount: function () {
    if (this.isAdmin()) return false;
    if (typeof PlayerSession === 'undefined' || !PlayerSession.account) return false;
    var account = PlayerSession.account();
    return !!(account && account.isApprover);
  },

  canApproveResults: function () {
    return this.isAdmin() || this.isApproverAccount();
  },

  normalizePlayerId: function (id) {
    return String(id == null ? '' : id).trim().toLowerCase();
  },

  /** Player ids in a side, from a fixture or a comma list. */
  membersOf: function (raw) {
    if (Array.isArray(raw)) return raw.map(String);
    return String(raw || '')
      .split(',')
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  },

  /**
   * Admins and approvers may edit any result. A signed-in player may edit a
   * match they play in (either partner of a pair) within 24 hours of posting.
   */
  canEditFixture: function (membersA, membersB, resultPostedAt) {
    if (this.isAdmin() || this.isApproverAccount()) return true;
    if (typeof PlayerSession === 'undefined' || !PlayerSession.isSignedIn()) return false;
    var mine = this.normalizePlayerId(PlayerSession.playerId());
    if (!mine) return false;
    var self = this;
    var all = this.membersOf(membersA).concat(this.membersOf(membersB));
    var inMatch = all.some(function (id) {
      return self.normalizePlayerId(id) === mine;
    });
    if (!inMatch) return false;
    if (!resultPostedAt) return true;
    var posted = new Date(resultPostedAt).getTime();
    if (isNaN(posted)) return true;
    return Date.now() < posted + this.RESULT_EDIT_MS;
  },

  isUnapprovedResult: function (match) {
    if (!match || match.resultApproved !== false) return false;
    return !!(match.Result && String(match.Result).trim());
  },

  // ---------- Dialog labels -------------------------------------------------------

  formatEntryDateTime: function (postedAt) {
    var raw = String(postedAt || '').trim();
    if (!raw) return '';
    var dt = new Date(raw);
    if (isNaN(dt.getTime())) return '';
    var months =
      typeof Formatters !== 'undefined' && Formatters._monthShort
        ? Formatters._monthShort
        : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var hh = String(dt.getHours()).padStart(2, '0');
    var mm = String(dt.getMinutes()).padStart(2, '0');
    return dt.getDate() + ' ' + months[dt.getMonth()] + ' ' + dt.getFullYear() + ' at ' + hh + ':' + mm;
  },

  formatByLabel: function (verb, by, at) {
    by = String(by || '').trim();
    if (!by) return '';
    var when = this.formatEntryDateTime(at);
    return when ? verb + ' by ' + by + ' on ' + when : verb + ' by ' + by;
  },

  updateDialogEnteredBy: function (enteredBy, postedAt) {
    var el = document.getElementById('fixture-result-entered-by');
    if (!el) return;
    var text = this.formatByLabel('Entered', enteredBy, postedAt);
    el.textContent = text;
    el.hidden = !text;
  },

  updateDialogApprovedBy: function (approvedBy, approvedAt, isApproved) {
    var el = document.getElementById('fixture-result-approved-by');
    if (!el) return;
    var text = isApproved ? this.formatByLabel('Approved', approvedBy, approvedAt) : '';
    el.textContent = text;
    el.hidden = !text;
  },

  updateDialogApprove: function (show) {
    var btn = document.getElementById('fixture-result-approve');
    if (!btn) return;
    var visible = !!(show && this.canApproveResults());
    btn.hidden = !visible;
    btn.style.display = visible ? '' : 'none';
  },

  setResultDialogTitle: function (editing) {
    var titleEl = document.getElementById('fixture-result-title');
    if (titleEl) titleEl.textContent = editing ? 'Edit result' : 'Enter result';
  },

  setResultDialogPlayerLabels: function (nameA, nameB) {
    var labelA = document.getElementById('fixture-result-label-a');
    var labelB = document.getElementById('fixture-result-label-b');
    if (labelA) labelA.textContent = String(nameA == null ? '' : nameA);
    if (labelB) labelB.textContent = String(nameB == null ? '' : nameB);
  },

  showDialogMessage: function (text, kind) {
    var msg = document.getElementById('fixture-result-msg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.hidden = !text;
    msg.classList.remove('msg--warning', 'msg--success');
    if (text && kind) msg.classList.add('msg--' + kind);
  },

  // ---------- Match date ------------------------------------------------------------

  localISODate: function () {
    var d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  },

  /** Match date from the dialog as YYYY-MM-DD (empty if invalid or blank). */
  resultDialogMatchDateISO: function () {
    var dateEl = document.getElementById('fixture-result-date');
    var pickerEl = document.getElementById('fixture-result-date-picker');
    var raw = dateEl ? String(dateEl.value || '').trim() : '';
    if (typeof Formatters === 'undefined' || !Formatters.parseMatchDateToISO) return '';
    if (raw) return Formatters.parseMatchDateToISO(raw);
    if (pickerEl && pickerEl.value) return Formatters.parseMatchDateToISO(pickerEl.value);
    return '';
  },

  /** Set the dialog date control from an ISO date, or today when blank. */
  setResultDialogMatchDate: function (isoOrEmpty) {
    var dateEl = document.getElementById('fixture-result-date');
    var pickerEl = document.getElementById('fixture-result-date-picker');
    var iso = isoOrEmpty && String(isoOrEmpty).trim() ? String(isoOrEmpty).trim() : this.localISODate();
    if (pickerEl) pickerEl.value = iso;
    if (!dateEl) return;
    if (typeof Formatters !== 'undefined' && Formatters.formatMatchDateDisplay) {
      dateEl.value = Formatters.formatMatchDateDisplay(iso) || iso;
      return;
    }
    dateEl.value = iso;
  },

  normalizeResultDialogMatchDate: function () {
    var dateEl = document.getElementById('fixture-result-date');
    var pickerEl = document.getElementById('fixture-result-date-picker');
    if (!dateEl) return;
    var iso = this.resultDialogMatchDateISO();
    if (!iso) return;
    if (typeof Formatters !== 'undefined' && Formatters.formatMatchDateDisplay) {
      dateEl.value = Formatters.formatMatchDateDisplay(iso);
    }
    if (pickerEl) pickerEl.value = iso;
  },

  applyResultDialogPickerDate: function () {
    var pickerEl = document.getElementById('fixture-result-date-picker');
    if (pickerEl && pickerEl.value) this.setResultDialogMatchDate(pickerEl.value);
  },

  // ---------- Player names in lists -------------------------------------------------

  makePlayerNameEl: function (name, align) {
    var el = document.createElement('span');
    el.className = 'fixture-player-name';
    el.textContent = name;
    el.style.flex = '1';
    el.style.textAlign = align === 'left' ? 'left' : 'right';
    return el;
  },

  // ---------- Set-by-set score entry ------------------------------------------------

  ballSvg: function () {
    return (
      '<svg class="tennis-ball-svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10.5" fill="#d4e157" stroke="#9aa82a" stroke-width="1"/>' +
      '<path d="M4.2 5.2c3.4 2.6 3.4 11 0 13.6M19.8 5.2c-3.4 2.6-3.4 11 0 13.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M8 12h8M12 8v8" stroke="#1f6b45" stroke-width="2.2" stroke-linecap="round"/>' +
      '</svg>'
    );
  },

  emptySet: function () {
    return { a: 0, b: 0, tbA: null, tbB: null };
  },

  /** Which set rows to show: every finished set plus the next one, until the match is decided. */
  visibleSetCount: function () {
    var format = this._format;
    var n = TennisScore.maxSets(format);
    var tally = { a: 0, b: 0 };
    for (var i = 0; i < n; i++) {
      if (!this._sets[i]) this._sets[i] = this.emptySet();
      var w = TennisScore.setWinner(this._sets[i], format, i);
      if (w !== 'a' && w !== 'b') return i + 1;
      tally[w]++;
      if (tally.a === format.setsToWin || tally.b === format.setsToWin) return i + 1;
    }
    return n;
  },

  /**
   * Each side may reach one game more than the set length (7 in a 6-game set),
   * whatever order the games are tapped in. Only a level 7-7 is blocked here;
   * other impossible scores (such as 7-2) are reported when saving.
   */
  maxGamesFor: function (set, side) {
    var gps = this._format.gamesPerSet;
    var other = side === 'a' ? set.b : set.a;
    return other >= gps + 1 ? gps : gps + 1;
  },

  adjustSet: function (index, side, delta) {
    var set = this._sets[index];
    if (!set || (side !== 'a' && side !== 'b')) return;
    if (TennisScore.isMatchTiebreakSet(this._format, index)) {
      var key = side === 'a' ? 'tbA' : 'tbB';
      var cur = set[key] == null ? 0 : set[key];
      var nextPts = cur + delta;
      if (nextPts < 0 || nextPts > this.MAX_TIEBREAK_POINTS) return;
      set[key] = nextPts;
      if (set.tbA == null) set.tbA = 0;
      if (set.tbB == null) set.tbB = 0;
    } else {
      var next = set[side] + delta;
      if (next < 0 || next > this.maxGamesFor(set, side)) return;
      set[side] = next;
      var otherSide = side === 'a' ? 'b' : 'a';
      var otherMax = this.maxGamesFor(set, otherSide);
      if (set[otherSide] > otherMax) set[otherSide] = otherMax;
      if (!TennisScore.isTiebreakScore(set, this._format)) {
        set.tbA = null;
        set.tbB = null;
      }
    }
    this.renderSets();
  },

  setTiebreakPoints: function (index, side, raw) {
    var set = this._sets[index];
    if (!set) return;
    var n = parseInt(raw, 10);
    var val = raw === '' || isNaN(n) || n < 0 ? null : Math.min(n, this.MAX_TIEBREAK_POINTS);
    set[side === 'a' ? 'tbA' : 'tbB'] = val;
    this.renderSummary();
  },

  stepperHtml: function (index, side, value, label) {
    return (
      '<div class="tennis-stepper" data-side="' + side + '">' +
      '<button type="button" class="tennis-stepper__btn tennis-stepper__btn--dec" data-set-index="' + index +
      '" data-side="' + side + '" data-step="-1" data-help="result.sets" aria-label="Decrease ' + label + '">−</button>' +
      '<span class="tennis-stepper__num" aria-live="polite">' + value + '</span>' +
      '<button type="button" class="tennis-stepper__btn tennis-stepper__btn--inc" data-set-index="' + index +
      '" data-side="' + side + '" data-step="1" data-help="result.sets" aria-label="Increase ' + label + '">' +
      this.ballSvg() + '</button>' +
      '</div>'
    );
  },

  renderSets: function () {
    var host = document.getElementById('tennis-score-sets');
    if (!host || !this._format) return;
    var count = this.visibleSetCount();
    var html = '';
    for (var i = 0; i < count; i++) {
      var set = this._sets[i];
      var mtb = TennisScore.isMatchTiebreakSet(this._format, i);
      var label = mtb ? 'Match tiebreak' : 'Set ' + (i + 1);
      var aVal = mtb ? (set.tbA == null ? 0 : set.tbA) : set.a;
      var bVal = mtb ? (set.tbB == null ? 0 : set.tbB) : set.b;
      var w = TennisScore.setWinner(set, this._format, i);
      html +=
        '<div class="tennis-set' + (w === 'a' || w === 'b' ? ' tennis-set--done' : '') + '" data-set-index="' + i + '">' +
        '<div class="tennis-set__label">' + label + (mtb ? '<small>first to 10</small>' : '') + '</div>' +
        this.stepperHtml(i, 'a', aVal, (mtb ? 'points' : 'games') + ' for the first side in ' + label) +
        this.stepperHtml(i, 'b', bVal, (mtb ? 'points' : 'games') + ' for the second side in ' + label);
      if (!mtb && TennisScore.isTiebreakScore(set, this._format)) {
        html +=
          '<div class="tennis-set__tb" data-help="result.tiebreak">' +
          '<span>Tiebreak <small>(optional)</small></span>' +
          '<input type="number" inputmode="numeric" min="0" max="40" class="tennis-set__tb-input" data-set-index="' + i +
          '" data-side="a" value="' + (set.tbA == null ? '' : set.tbA) + '" aria-label="Tiebreak points, first side" />' +
          '<span>–</span>' +
          '<input type="number" inputmode="numeric" min="0" max="40" class="tennis-set__tb-input" data-set-index="' + i +
          '" data-side="b" value="' + (set.tbB == null ? '' : set.tbB) + '" aria-label="Tiebreak points, second side" />' +
          '</div>';
      }
      html += '</div>';
    }
    host.innerHTML = html;
    this.renderSummary();
  },

  renderSummary: function () {
    var summary = TennisScore.summarize(this._sets, this._format);
    var labelA = document.getElementById('fixture-result-label-a');
    var labelB = document.getElementById('fixture-result-label-b');
    [labelA, labelB].forEach(function (el) {
      if (el) el.classList.remove('fixture-result-player-name--winner', 'fixture-result-player-name--loser');
    });
    if (summary.winner && labelA && labelB) {
      (summary.winner === 'a' ? labelA : labelB).classList.add('fixture-result-player-name--winner');
      (summary.winner === 'a' ? labelB : labelA).classList.add('fixture-result-player-name--loser');
    }
    var line = document.getElementById('tennis-score-line');
    if (line) {
      var payload = TennisScore.toPayload(this._sets, this._format);
      var sets = payload.map(function (s) {
        return s.a == null ? { a: s.tbA > s.tbB ? 1 : 0, b: s.tbB > s.tbA ? 1 : 0, tbA: s.tbA, tbB: s.tbB, mtb: true } : s;
      });
      line.textContent = summary.winner ? 'Score: ' + TennisScore.formatSetLine(sets) : '';
    }
    // Scores pass through impossible states while being tapped in (7-0 on the
    // way to 7-6), so errors are only reported on Save. Clear any old one here.
    var msg = document.getElementById('fixture-result-msg');
    if (msg && msg.classList.contains('msg--warning')) this.showDialogMessage('');
  },

  loadSetsIntoDialog: function (sets) {
    var self = this;
    this._sets = (sets || []).map(function (s, i) {
      if (s.mtb || TennisScore.isMatchTiebreakSet(self._format, i)) {
        return { a: s.a || 0, b: s.b || 0, tbA: s.tbA == null ? 0 : s.tbA, tbB: s.tbB == null ? 0 : s.tbB };
      }
      return { a: s.a || 0, b: s.b || 0, tbA: s.tbA == null ? null : s.tbA, tbB: s.tbB == null ? null : s.tbB };
    });
    if (!this._sets.length) this._sets = [this.emptySet()];
  },

  // ---------- Result slip -----------------------------------------------------------

  initResultSlipUpload: function () {
    if (this._resultSlipUploadInited) return;
    var btn = document.getElementById('fixture-result-slip-btn');
    if (!btn || typeof ResultSlipUpload === 'undefined') return;
    var self = this;
    ResultSlipUpload.init(btn, {
      onPhotoSelected: function (base64, mimeType, previewUrl) {
        self.handleResultSlipPhotoSelected(base64, mimeType, previewUrl);
      },
      onRemoveRequested: function () {
        self.handleResultSlipRemoveRequested();
      },
    });
    this._resultSlipUploadInited = true;
  },

  resetResultSlipSession: function () {
    this._slipPendingUploaded = false;
    this._slipHasCommitted = false;
    this._slipSaveSucceeded = false;
    if (typeof ResultSlipUpload !== 'undefined') {
      ResultSlipUpload.clearImage();
      ResultSlipUpload.setBusy(false);
    }
  },

  loadResultSlipForDialog: function (fixtureId) {
    var self = this;
    if (!fixtureId || typeof ApiClient === 'undefined') return Promise.resolve();
    return ApiClient.post('getResultSlip', { fixtureId: fixtureId })
      .then(function (res) {
        if (res && res.hasImage && res.imageUrl && typeof ResultSlipUpload !== 'undefined') {
          self._slipHasCommitted = true;
          ResultSlipUpload.setImage(res.imageUrl);
        }
      })
      .catch(function (err) {
        console.warn('Could not load result slip:', err);
      });
  },

  slipBrief: function (text, anchor) {
    if (typeof window.BriefMessage !== 'undefined' && window.BriefMessage.show) {
      window.BriefMessage.show(text, anchor, { durationMs: 1200 });
    }
  },

  handleResultSlipPhotoSelected: function (base64, mimeType) {
    var fixtureId = (document.getElementById('fixture-result-fixture-id') || {}).value || '';
    var btn = document.getElementById('fixture-result-slip-btn');
    if (!fixtureId) {
      this.slipBrief('Missing fixture', btn);
      return;
    }
    var self = this;
    if (typeof ResultSlipUpload !== 'undefined') ResultSlipUpload.setBusy(true);
    ApiClient.post('uploadResultSlip', { fixtureId: fixtureId, base64: base64, mimeType: mimeType || 'image/jpeg' })
      .then(function (res) {
        self._slipPendingUploaded = true;
        if (typeof ResultSlipUpload !== 'undefined') {
          if (res && res.imageUrl) ResultSlipUpload.setImage(res.imageUrl);
          ResultSlipUpload.setBusy(false);
        }
        self.slipBrief('Photo uploaded', btn);
      })
      .catch(function (err) {
        if (typeof ResultSlipUpload !== 'undefined') {
          if (self._slipHasCommitted) self.loadResultSlipForDialog(fixtureId);
          else ResultSlipUpload.clearImage();
          ResultSlipUpload.setBusy(false);
        }
        self.slipBrief((err && err.message) || 'Upload failed', btn);
      });
  },

  handleResultSlipRemoveRequested: function () {
    var fixtureId = (document.getElementById('fixture-result-fixture-id') || {}).value || '';
    var btn = document.getElementById('fixture-result-slip-btn');
    var self = this;
    if (!fixtureId) return;
    if (typeof ResultSlipUpload !== 'undefined') ResultSlipUpload.setBusy(true);
    var action = this._slipHasCommitted ? 'removeResultSlip' : 'discardResultSlipSession';
    ApiClient.post(action, { fixtureId: fixtureId })
      .then(function () {
        self._slipPendingUploaded = false;
        self._slipHasCommitted = false;
        if (typeof ResultSlipUpload !== 'undefined') {
          ResultSlipUpload.clearImage();
          ResultSlipUpload.setBusy(false);
        }
        self.slipBrief('Photo removed', btn);
      })
      .catch(function (err) {
        if (typeof ResultSlipUpload !== 'undefined') ResultSlipUpload.setBusy(false);
        self.slipBrief((err && err.message) || 'Could not remove photo', btn);
      });
  },

  discardResultSlipSessionIfNeeded: function () {
    if (!this._slipPendingUploaded) return Promise.resolve();
    var fixtureId = (document.getElementById('fixture-result-fixture-id') || {}).value || '';
    var self = this;
    if (!fixtureId || typeof ApiClient === 'undefined') {
      this._slipPendingUploaded = false;
      return Promise.resolve();
    }
    return ApiClient.post('discardResultSlipSession', { fixtureId: fixtureId })
      .catch(function (err) {
        console.warn('Could not discard pending result slip:', err);
      })
      .then(function () {
        self._slipPendingUploaded = false;
      });
  },

  commitResultSlipIfNeeded: function (fixtureId) {
    if (!this._slipPendingUploaded || !fixtureId) return Promise.resolve();
    var self = this;
    return ApiClient.post('commitResultSlip', { fixtureId: fixtureId }).then(function () {
      self._slipPendingUploaded = false;
      self._slipHasCommitted = true;
    });
  },

  // ---------- Page --------------------------------------------------------------------

  fixtureGroup: function (row) {
    return String(row['Group'] || '').trim();
  },

  selectedLeague: function () {
    if (typeof LeagueGroupFilter !== 'undefined') return LeagueGroupFilter.selected();
    return 'All';
  },

  init: async function () {
    var container = document.getElementById('fixtures-list');
    if (!container) return;
    var self = this;
    function rerender() {
      self.render().catch(function (e) {
        console.error(e);
      });
    }
    window.addEventListener(this.adminModeEvent(), rerender);
    window.addEventListener(
      typeof PlayerSession !== 'undefined' ? PlayerSession.EVENT_NAME : 'ierne-tennis-player-session-changed',
      rerender
    );
    if (typeof CurrentCompetition !== 'undefined') {
      if (typeof NavCompetition !== 'undefined') NavCompetition.syncFromSession();
      window.addEventListener(CurrentCompetition.EVENT_NAME, function () {
        self.refreshFilterAndRender().catch(function (e) {
          console.error(e);
        });
      });
    }
    if (typeof LeagueGroupFilter !== 'undefined') LeagueGroupFilter.bindChange(rerender);
    this.bindResultDialog();

    if (typeof CurrentCompetition !== 'undefined') {
      await CurrentCompetition.whenReady(function () {
        return self.refreshFilterAndRender();
      });
    } else {
      await this.render();
    }
  },

  unplayedLeagueFixtures: function (fixtures) {
    return (fixtures || []).filter(function (r) {
      var notPlayed = !r['Result'] || String(r['Result']).trim() === '';
      if (String(r.Stage || '').toLowerCase() !== 'group') return false;
      return notPlayed && r['Game Week'] && r['Player A'] && r['Player B'];
    });
  },

  knockoutFixturesWithParticipants: function (fixtures) {
    return (fixtures || []).filter(function (r) {
      return r['Game Week'] && r['Player A'] && r['Player B'];
    });
  },

  /**
   * When the league has no unplayed fixtures but a linked knockout already has
   * matches, show that knockout as the now-showing competition.
   */
  maybePromoteToAssociatedKnockout: async function () {
    if (typeof CurrentCompetition === 'undefined') return false;
    var comp = CurrentCompetition.get();
    if (!comp || !CurrentCompetition.isLeague()) return false;
    var ko = CurrentCompetition.findAssociatedKnockout(comp);
    if (!ko) return false;
    try {
      var leagueResult = await ApiClient.get({ action: 'getFixtures', comp: comp.compId });
      if (this.unplayedLeagueFixtures(leagueResult.fixtures || []).length > 0) return false;
      var koResult = await ApiClient.get({ action: 'getFixtures', comp: ko.compId });
      if (this.knockoutFixturesWithParticipants(koResult.fixtures || []).length === 0) return false;
      return CurrentCompetition.setCompId(ko.compId, { allowKnockoutStage: true });
    } catch (e) {
      console.error('maybePromoteToAssociatedKnockout failed:', e);
      return false;
    }
  },

  refreshFilterAndRender: async function () {
    var promoted = await this.maybePromoteToAssociatedKnockout();
    if (promoted) return;
    if (typeof LeagueGroupFilter !== 'undefined') await LeagueGroupFilter.sync();
    return this.render();
  },

  bindResultDialog: function () {
    if (this._resultDialogBindingsDone) return;
    var dlg = document.getElementById('fixture-result-dialog');
    if (!dlg) return;
    this._resultDialogBindingsDone = true;
    var self = this;

    function showError(err) {
      self.showDialogMessage((err && err.message) || String(err), 'warning');
    }

    dlg.addEventListener('click', function (e) {
      var btn = e.target.closest('.tennis-stepper__btn');
      if (!btn || !dlg.contains(btn)) return;
      self.adjustSet(
        parseInt(btn.getAttribute('data-set-index'), 10),
        btn.getAttribute('data-side'),
        parseInt(btn.getAttribute('data-step'), 10)
      );
    });
    dlg.addEventListener('input', function (e) {
      var input = e.target.closest('.tennis-set__tb-input');
      if (!input) return;
      self.setTiebreakPoints(parseInt(input.getAttribute('data-set-index'), 10), input.getAttribute('data-side'), input.value);
    });

    var approveBtn = document.getElementById('fixture-result-approve');
    if (approveBtn) {
      approveBtn.addEventListener('click', function () {
        self.approveResultDialog().catch(showError);
      });
    }
    var clearBtn = document.getElementById('fixture-result-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        self.clearResultFromDialog().catch(showError);
      });
    }
    var cancelBtn = document.getElementById('fixture-result-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        dlg.close();
      });
    }
    dlg.addEventListener('close', function () {
      if (self._slipSuppressDiscardOnClose) return;
      if (self._slipSaveSucceeded) {
        self._slipSaveSucceeded = false;
        return;
      }
      self.discardResultSlipSessionIfNeeded();
    });

    var form = document.getElementById('fixture-result-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        self.submitResultDialog().catch(showError);
      });
    }
    var dateEl = document.getElementById('fixture-result-date');
    if (dateEl) {
      dateEl.addEventListener('change', function () {
        self.normalizeResultDialogMatchDate();
      });
      dateEl.addEventListener('blur', function () {
        self.normalizeResultDialogMatchDate();
      });
    }
    var pickerEl = document.getElementById('fixture-result-date-picker');
    if (pickerEl) {
      pickerEl.addEventListener('change', function () {
        self.applyResultDialogPickerDate();
      });
    }
  },

  focusResultDialogRoot: function () {
    var titleEl = document.getElementById('fixture-result-title');
    if (!titleEl) return;
    titleEl.setAttribute('tabindex', '-1');
    titleEl.focus({ preventScroll: true });
  },

  render: async function () {
    var container = document.getElementById('fixtures-list');
    if (!container) return;
    if (typeof CurrentCompetition !== 'undefined' && !CurrentCompetition.getCompId()) {
      container.innerHTML = '<p><em>No competitions are running at the moment.</em></p>';
      return;
    }
    try {
      var params = { action: 'getFixtures' };
      if (typeof CurrentCompetition !== 'undefined') Object.assign(params, CurrentCompetition.apiParams());
      else params.competitionType = 'league';
      var result = await ApiClient.get(params);
      var data = result.fixtures || [];

      var isKnockout = typeof CurrentCompetition !== 'undefined' && CurrentCompetition.isKnockout();
      var isLadder = typeof CurrentCompetition !== 'undefined' && CurrentCompetition.isLadder();
      var group = this.selectedLeague();

      var upcoming = data.filter(function (r) {
        var played = !!(r['Result'] && String(r['Result']).trim());
        var unapproved = played && r.resultApproved === false;
        var hasParticipants = r['Game Week'] && r['Player A'] && r['Player B'];
        if ((played && !unapproved) || !hasParticipants) return false;
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
        return FixturesPage.fixtureGroup(r) === group;
      });

      if (upcoming.length === 0) {
        container.innerHTML = isLadder
          ? '<p><em>No open challenges. Challenge someone from the Ladder page.</em></p>'
          : '<p><em>No upcoming fixtures found.</em></p>';
        return;
      }

      var opts = { isKnockout: isKnockout, isLadder: isLadder, fixtures: data };
      var grouped;
      if (isKnockout && typeof KnockoutRounds !== 'undefined') {
        opts.winnersByCode = KnockoutRounds.buildRoundWinnersMap(data);
        opts.losersByCode = KnockoutRounds.buildRoundLosersMap ? KnockoutRounds.buildRoundLosersMap(data) : {};
        opts.winnerIdsByCode = KnockoutRounds.buildRoundWinnerIdsMap ? KnockoutRounds.buildRoundWinnerIdsMap(data) : {};
        var koGroup = KnockoutRounds.groupForList(upcoming, data);
        grouped = { grouped: koGroup.grouped, orderedWeeks: koGroup.orderedKeys };
        opts.sectionLabels = koGroup.labels;
      } else if (isLadder) {
        grouped = { grouped: { challenges: upcoming }, orderedWeeks: ['challenges'] };
        opts.sectionLabels = { challenges: 'Open challenges' };
      } else {
        grouped = this.groupByGameWeek(upcoming);
      }
      this.renderGroups(container, grouped.grouped, grouped.orderedWeeks, opts);
    } catch (error) {
      console.error('Failed to load fixtures:', error);
      container.innerHTML = '<p><em>Error loading fixtures.</em></p>';
    }
  },

  groupByGameWeek: function (fixtures) {
    var grouped = {};
    var orderedWeeks = [];
    fixtures.forEach(function (f) {
      var week = String(f['Game Week']).trim();
      if (!grouped[week]) {
        grouped[week] = [];
        orderedWeeks.push(week);
      }
      grouped[week].push(f);
    });
    return { grouped: grouped, orderedWeeks: orderedWeeks };
  },

  knockoutWeekLabel: function (week, roundName) {
    if (typeof KnockoutRounds !== 'undefined') return KnockoutRounds.labelFor(week, roundName);
    return week;
  },

  sectionHeading: function (week, options) {
    if (options.sectionLabels && options.sectionLabels[week]) return options.sectionLabels[week];
    if (options.isKnockout) return this.knockoutWeekLabel(week);
    var num = parseInt(week, 10);
    return isNaN(num) ? week : 'Week ' + week;
  },

  knockoutPlayerLabel: function (match, slot, winnersByCode, losersByCode, fixtures) {
    if (typeof KnockoutRounds !== 'undefined') {
      return KnockoutRounds.resolvedPlayerName(match, slot, winnersByCode, losersByCode, fixtures);
    }
    return slot === 'a' ? match['Player A'] || '' : match['Player B'] || '';
  },

  /** True when both sides are known (not still waiting on an earlier round). */
  fixtureResultReady: function (match, isKnockout, winnersByCode, losersByCode) {
    if (typeof KnockoutRounds !== 'undefined' && KnockoutRounds.isByeFixture && KnockoutRounds.isByeFixture(match)) {
      return false;
    }
    if (!isKnockout || typeof KnockoutRounds === 'undefined') return true;
    winnersByCode = winnersByCode || {};
    losersByCode = losersByCode || {};
    function slotReady(slot) {
      var id = slot === 'a' ? match.playerAId : match.playerBId;
      if (KnockoutRounds.isLoserOfPlayerId && KnockoutRounds.isLoserOfPlayerId(id)) {
        var lCode = KnockoutRounds.roundCodeFromLoserOfId(id);
        return !!(lCode && losersByCode[lCode]);
      }
      if (!KnockoutRounds.isWinnerOfPlayerId(id)) return true;
      var code = KnockoutRounds.roundCodeFromWinnerOfId(id);
      return !!(code && winnersByCode[code]);
    }
    var labelA = String(this.knockoutPlayerLabel(match, 'a', winnersByCode, losersByCode)).trim();
    var labelB = String(this.knockoutPlayerLabel(match, 'b', winnersByCode, losersByCode)).trim();
    return slotReady('a') && slotReady('b') && !!labelA && !!labelB;
  },

  /**
   * Stores everything the result dialog needs on a row element, so the
   * Results page can reuse openResultDialog.
   */
  setRowDataAttributes: function (div, match, nameA, nameB) {
    div.setAttribute('data-fixture-id', String(match.fixtureId || '').trim());
    div.setAttribute('data-player-a-name', nameA);
    div.setAttribute('data-player-b-name', nameB);
    div.setAttribute('data-side-a-members', this.membersOf(match.sideAPlayerIds).join(','));
    div.setAttribute('data-side-b-members', this.membersOf(match.sideBPlayerIds).join(','));
    div.setAttribute('data-match-date', match['Match Date'] || '');
    div.setAttribute('data-result-posted-at', match.resultPostedAt || '');
    div.setAttribute(
      'data-format',
      JSON.stringify({ setsToWin: match.setsToWin, gamesPerSet: match.gamesPerSet, finalSet: match.finalSet })
    );
    div.setAttribute('data-sets', JSON.stringify(match.sets || []));
    var enteredBy = String(match.resultEnteredBy || '').trim();
    if (enteredBy) div.setAttribute('data-result-entered-by', enteredBy);
    var approvedBy = String(match.resultApprovedBy || '').trim();
    if (approvedBy) div.setAttribute('data-result-approved-by', approvedBy);
    if (match.resultApprovedAt) div.setAttribute('data-result-approved-at', match.resultApprovedAt);
    if (this.isUnapprovedResult(match)) div.setAttribute('data-result-approved', 'false');
    if (match.scoreA != null && match.scoreB != null) div.setAttribute('data-had-result', '1');
  },

  renderGroups: function (container, grouped, orderedWeeks, options) {
    var self = this;
    options = options || {};
    var isKnockout = !!options.isKnockout;
    var winnersByCode = options.winnersByCode || {};
    var losersByCode = options.losersByCode || {};
    container.innerHTML = '';

    orderedWeeks.forEach(function (week) {
      var h3 = document.createElement('h3');
      h3.className = 'fixture-week-heading';
      h3.textContent = self.sectionHeading(week, options);
      h3.setAttribute('data-help', options.isLadder ? 'ladder.challenges' : 'fixtures.week');
      container.appendChild(h3);

      grouped[week].forEach(function (match) {
        var div = document.createElement('div');
        div.className = 'fixture-row';
        div.setAttribute('data-help', 'fixtures.match');

        var fid = String(match.fixtureId || '').trim();
        var nameA = match['Player A'] || '';
        var nameB = match['Player B'] || '';
        if (isKnockout) {
          nameA = self.knockoutPlayerLabel(match, 'a', winnersByCode, losersByCode, options.fixtures);
          nameB = self.knockoutPlayerLabel(match, 'b', winnersByCode, losersByCode, options.fixtures);
        }
        self.setRowDataAttributes(div, match, nameA, nameB);
        var unapproved = self.isUnapprovedResult(match);
        var resultReady = self.fixtureResultReady(match, isKnockout, winnersByCode, losersByCode);
        div.setAttribute('data-result-ready', resultReady ? 'true' : 'false');

        var center;
        var canEdit = self.canEditFixture(match.sideAPlayerIds, match.sideBPlayerIds, match.resultPostedAt || '');
        if (canEdit && fid && resultReady) {
          center = document.createElement('button');
          center.type = 'button';
          center.className = 'fixture-vs-btn';
          center.textContent = 'V';
          center.setAttribute('data-help', 'fixtures.enter');
          center.setAttribute('aria-label', 'Enter result for ' + nameA + ' vs ' + nameB);
          center.addEventListener('click', function () {
            self.openResultDialog(div);
          });
        } else {
          center = document.createElement('span');
          center.className = 'fixture-vs-static';
          center.setAttribute('data-help', 'fixtures.closed');
          center.textContent = 'V';
          if (self.isAdmin() && fid && !resultReady) {
            center.setAttribute('title', 'Result entry is available once both sides are known');
          }
        }
        if (unapproved) {
          center.classList.add('is-unapproved');
          if (center.tagName === 'BUTTON') {
            center.setAttribute('aria-label', 'Unapproved result for ' + nameA + ' vs ' + nameB);
          }
        }
        center.style.flex = '0 0 auto';

        div.appendChild(self.makePlayerNameEl(nameA, 'right'));
        div.appendChild(center);
        div.appendChild(self.makePlayerNameEl(nameB, 'left'));
        container.appendChild(div);

        if (options.isLadder && match.playBy) {
          var sub = document.createElement('p');
          sub.className = 'fixture-play-by';
          sub.setAttribute('data-help', 'ladder.playBy');
          var when =
            typeof Formatters !== 'undefined' && Formatters.formatMatchDateDisplay
              ? Formatters.formatMatchDateDisplay(match.playBy)
              : match.playBy;
          sub.textContent = 'Play by ' + when;
          container.appendChild(sub);
        }
      });
    });
  },

  // ---------- Dialog open / save --------------------------------------------------

  openResultDialog: function (rowEl) {
    var dlg = document.getElementById('fixture-result-dialog');
    if (!dlg || !rowEl) return;
    if (rowEl.getAttribute('data-result-ready') === 'false') return;

    var fid = String(rowEl.getAttribute('data-fixture-id') || '').trim();
    this._openMembersA = this.membersOf(rowEl.getAttribute('data-side-a-members'));
    this._openMembersB = this.membersOf(rowEl.getAttribute('data-side-b-members'));
    this._openResultPostedAt = rowEl.getAttribute('data-result-posted-at') || '';
    if (!this.canEditFixture(this._openMembersA, this._openMembersB, this._openResultPostedAt)) return;

    var format;
    var sets;
    try {
      format = JSON.parse(rowEl.getAttribute('data-format') || '{}');
      sets = JSON.parse(rowEl.getAttribute('data-sets') || '[]');
    } catch (_e) {
      format = {};
      sets = [];
    }
    this._format = TennisScore.normalizeFormat(format);
    this.loadSetsIntoDialog(sets);

    document.getElementById('fixture-result-fixture-id').value = fid;
    this.updateDialogEnteredBy(rowEl.getAttribute('data-result-entered-by'), this._openResultPostedAt);
    this.updateDialogApprovedBy(
      rowEl.getAttribute('data-result-approved-by'),
      rowEl.getAttribute('data-result-approved-at'),
      rowEl.getAttribute('data-result-approved') !== 'false'
    );
    this.updateDialogApprove(rowEl.getAttribute('data-result-approved') === 'false');
    var prevDate = rowEl.getAttribute('data-match-date');
    this.setResultDialogMatchDate(prevDate && String(prevDate).trim() ? prevDate : '');
    this.setResultDialogPlayerLabels(rowEl.getAttribute('data-player-a-name'), rowEl.getAttribute('data-player-b-name'));

    var hadResult = rowEl.getAttribute('data-had-result');
    this._dialogOpenedWithResult = hadResult === '1' || hadResult === 'true';
    this.setResultDialogTitle(this._dialogOpenedWithResult);
    var clearBtn = document.getElementById('fixture-result-clear');
    if (clearBtn) clearBtn.hidden = !this._dialogOpenedWithResult;
    var formatEl = document.getElementById('fixture-result-format');
    if (formatEl) formatEl.textContent = TennisScore.describeFormat(this._format);

    this.showDialogMessage('');
    this.renderSets();
    this.initResultSlipUpload();
    this.resetResultSlipSession();

    var self = this;
    function openDlg() {
      if (!dlg.open && typeof dlg.showModal === 'function') dlg.showModal();
      window.setTimeout(function () {
        self.focusResultDialogRoot();
      }, 0);
    }
    if (!fid) {
      openDlg();
      return;
    }
    this.loadResultSlipForDialog(fid).then(openDlg, openDlg);
  },

  approveResultDialog: async function () {
    var dlg = document.getElementById('fixture-result-dialog');
    var fixtureId = document.getElementById('fixture-result-fixture-id').value;
    if (!fixtureId) throw new Error('Missing fixture');
    if (!this.canApproveResults()) throw new Error('Only an approver or an admin can approve this result.');
    this.showDialogMessage('Approving…');
    await ApiClient.post('approveFixtureResult', { fixtureId: fixtureId });
    this._slipSaveSucceeded = true;
    if (dlg) dlg.close();
    window.dispatchEvent(new CustomEvent(this.RESULT_SAVED_EVENT, { detail: { fixtureId: fixtureId } }));
    if (document.getElementById('fixtures-list')) await this.render();
  },

  /**
   * The confirm overlay cannot sit above a modal <dialog>, so the result
   * dialog closes while the question is asked and reopens if cancelled.
   */
  confirmClearingResult: async function () {
    var dlg = document.getElementById('fixture-result-dialog');
    var wasOpen = !!(dlg && dlg.open);
    this._slipSuppressDiscardOnClose = true;
    if (wasOpen) dlg.close();
    var ok = false;
    try {
      ok = await ConfirmDialog.show({
        title: 'Clear this result?',
        message: 'The score and any result slip photo for this match will be removed. The match will show as unplayed.',
        confirmLabel: 'Clear result',
        cancelLabel: 'Keep it',
        danger: true,
      });
    } finally {
      this._slipSuppressDiscardOnClose = false;
    }
    if (!ok && wasOpen && typeof dlg.showModal === 'function') {
      dlg.showModal();
      this.focusResultDialogRoot();
    }
    return ok;
  },

  clearResultFromDialog: async function () {
    var fixtureId = document.getElementById('fixture-result-fixture-id').value;
    if (!fixtureId) throw new Error('Missing fixture');
    if (!this.canEditFixture(this._openMembersA, this._openMembersB, this._openResultPostedAt || '')) {
      throw new Error('This result can no longer be changed by you.');
    }
    if (!(await this.confirmClearingResult())) return;
    await WorkingIndicator.withWorking(
      ApiClient.post('updateFixtureResult', { fixtureId: fixtureId, sets: [] }),
      'Clearing result…'
    );
    this._slipPendingUploaded = false;
    this._slipHasCommitted = false;
    this._slipSaveSucceeded = true;
    var dlg = document.getElementById('fixture-result-dialog');
    if (dlg && dlg.open) dlg.close();
    window.dispatchEvent(new CustomEvent(this.RESULT_SAVED_EVENT, { detail: { fixtureId: fixtureId } }));
    if (document.getElementById('fixtures-list')) await this.render();
  },

  submitResultDialog: async function () {
    var dlg = document.getElementById('fixture-result-dialog');
    var fixtureId = document.getElementById('fixture-result-fixture-id').value;
    var matchDate = this.resultDialogMatchDateISO();
    if (!fixtureId) throw new Error('Missing fixture');
    if (!matchDate) throw new Error('Enter a valid match date (e.g. 31 Jan 2026).');
    if (!this.canEditFixture(this._openMembersA, this._openMembersB, this._openResultPostedAt || '')) {
      throw new Error(
        'This result can only be changed within 24 hours of being posted, and only by a player in the match, an approver, or an admin.'
      );
    }
    var summary = TennisScore.summarize(this._sets, this._format);
    if (summary.error) throw new Error(summary.error);
    if (!summary.complete) {
      throw new Error('Enter each set until one side has won the match.');
    }
    var sets = TennisScore.toPayload(this._sets, this._format);
    var self = this;
    // The busy overlay sits beneath the modal dialog, so say it inside the dialog too.
    this.showDialogMessage('Saving…');
    await WorkingIndicator.withWorking(
      (async function () {
        await ApiClient.post('updateFixtureResult', { fixtureId: fixtureId, sets: sets, matchDate: matchDate });
        await self.commitResultSlipIfNeeded(fixtureId);
      })(),
      'Saving result…'
    );
    this._slipSaveSucceeded = true;
    this.showDialogMessage('Saved.', 'success');
    if (dlg) dlg.close();
    window.dispatchEvent(new CustomEvent(this.RESULT_SAVED_EVENT, { detail: { fixtureId: fixtureId } }));
    if (document.getElementById('fixtures-list')) await this.render();
  },
};
