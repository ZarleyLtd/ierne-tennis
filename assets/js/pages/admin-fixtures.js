// Admin — group + knockout fixtures: grouped list + modal add/edit.

var AdminFixturesPage = (function () {
  var KNOCKOUT_GROUP_ID = 'ko';

  function playerGroup(p) {
    if (!p) return '';
    return p.group != null ? p.group : p.groupId;
  }

  var self = {
    competitions: [],
    groups: [],
    compPlayers: [],
    fixturesLoaded: [],
    currentCompType: 'league',
    _internalMatchNum: 1,
    _isEditMode: false,
    el: {},

    adminEvt: function () {
      return typeof AdminMode !== 'undefined' ? AdminMode.EVENT_NAME : 'ierne-tennis-admin-mode-changed';
    },

    cacheEls: function () {
      this.el.root = document.getElementById('adminFixturesRoot');
      this.el.gate = document.getElementById('adminFixturesGate');
      this.el.panel = document.getElementById('adminFixturesPanel');
      this.el.compSelect = document.getElementById('adminFxComp');
      this.el.list = document.getElementById('adminFxList');
      this.el.addBtn = document.getElementById('adminFxAddBtn');
      this.el.msg = document.getElementById('adminFxMsg');
      this.el.dialog = document.getElementById('admin-fixture-dialog');
      this.el.form = document.getElementById('adminFxDialogForm');
      this.el.fixtureId = document.getElementById('adminFxFixtureId');
      this.el.stage = document.getElementById('adminFxStage');
      this.el.groupFields = document.getElementById('adminFxGroupFields');
      this.el.koFields = document.getElementById('adminFxKoFields');
      this.el.group = document.getElementById('adminFxGroup');
      this.el.week = document.getElementById('adminFxWeek');
      this.el.setsLeague = document.getElementById('adminFxSetsToWinLeague');
      this.el.setsKo = document.getElementById('adminFxSetsToWinKo');
      this.el.ladderHint = document.getElementById('adminFxLadderHint');
      this.el.round = document.getElementById('adminFxRound');
      this.el.customRoundWrap = document.getElementById('adminFxCustomRoundWrap');
      this.el.customRoundName = document.getElementById('adminFxCustomRoundName');
      this.el.coherenceWarn = document.getElementById('adminFxCoherenceWarn');
      this.el.pa = document.getElementById('adminFxPa');
      this.el.pb = document.getElementById('adminFxPb');
      this.el.deleteBtn = document.getElementById('adminFxDeleteBtn');
      this.el.dialogMsg = document.getElementById('adminFxDialogMsg');
    },

    normalizeCompType: function (raw) {
      var t = String(raw || 'league').trim().toLowerCase();
      if (t === 'knockout') return 'knockout';
      if (t === 'double-eliminator' || t === 'double_eliminator' || t === 'doubleelim') {
        return 'double-eliminator';
      }
      if (t === 'ladder') return 'ladder';
      return 'league';
    },

    isLadderComp: function () {
      return this.normalizeCompType(this.currentCompType) === 'ladder';
    },

    currentComp: function () {
      var cid = this.currentCompId();
      return (
        (this.competitions || []).find(function (x) {
          return String(x.compId) === String(cid);
        }) || null
      );
    },

    /**
     * The confirm overlay cannot sit above an open modal <dialog>, so the
     * fixture dialog closes while the question is asked and reopens on cancel.
     */
    confirmOverDialog: function (opts) {
      var dlg = this.el.dialog;
      var wasOpen = !!(dlg && dlg.open);
      if (wasOpen) dlg.close();
      return ConfirmDialog.show(opts).then(function (ok) {
        if (!ok && wasOpen && typeof dlg.showModal === 'function') dlg.showModal();
        return ok;
      });
    },

    isBracketCompType: function (t) {
      var n = this.normalizeCompType(t);
      return n === 'knockout' || n === 'double-eliminator';
    },

    isPlaceholderPlayerId: function (playerId) {
      return (
        KnockoutRounds.isWinnerOfPlayerId(playerId) ||
        (KnockoutRounds.isLoserOfPlayerId && KnockoutRounds.isLoserOfPlayerId(playerId)) ||
        String(playerId || '').trim().toLowerCase() === 'bye'
      );
    },

    flash: function (text, isErr) {
      if (!this.el.msg) return;
      this.el.msg.textContent = text || '';
      this.el.msg.className = 'msg' + (isErr ? ' msg--warning' : ' msg--success');
      this.el.msg.hidden = !text;
    },

    dialogFlash: function (text, isErr) {
      if (!this.el.dialogMsg) return;
      this.el.dialogMsg.textContent = text || '';
      this.el.dialogMsg.className = 'msg' + (isErr ? ' msg--warning' : ' msg--success');
      this.el.dialogMsg.hidden = !text;
    },

    syncGate: function () {
      var ok = typeof AdminMode !== 'undefined' && AdminMode.isUnlocked();
      if (this.el.gate) this.el.gate.hidden = ok;
      if (this.el.panel) this.el.panel.hidden = !ok;
      if (ok) this.loadMeta();
    },

    groupById: function (id) {
      var gid = String(id == null ? '' : id);
      for (var i = 0; i < (this.groups || []).length; i++) {
        if (String(this.groups[i].groupId) === gid) return this.groups[i];
      }
      return null;
    },

    groupDisplayOrder: function (groupId) {
      var G = this.groupById(groupId);
      return G && G.displayOrder != null ? Number(G.displayOrder) : 0;
    },

    displayFixturePlayerName: function (f, slot) {
      var id = slot === 'b' ? f.playerBId : f.playerAId;
      var fallback = slot === 'b' ? f['Player B'] : f['Player A'];
      var fixtures = this.fixturesLoaded || [];
      if (KnockoutRounds.isWinnerOfPlayerId(id)) {
        return KnockoutRounds.winnerOfDisplayLabel(
          KnockoutRounds.roundCodeFromWinnerOfId(id),
          fixtures
        );
      }
      if (KnockoutRounds.isLoserOfPlayerId && KnockoutRounds.isLoserOfPlayerId(id)) {
        return KnockoutRounds.loserOfDisplayLabel(
          KnockoutRounds.roundCodeFromLoserOfId(id),
          fixtures
        );
      }
      return fallback || '';
    },

    fillCompSelect: function () {
      var ss = this.el.compSelect;
      if (!ss) return;
      ss.innerHTML = '';
      var cur = null;
      (this.competitions || []).forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.compId;
        o.textContent = c.name;
        if (c.isCurrent) cur = c.compId;
        ss.appendChild(o);
      });
      if (cur && ss.querySelector('option[value="' + cur + '"]')) ss.value = cur;
      else if (ss.options.length) ss.selectedIndex = 0;
    },

    groupsForGroupSelect: function () {
      return (this.groups || []).filter(function (G) {
        return String(G.groupId) !== KNOCKOUT_GROUP_ID;
      });
    },

    fillGroupSelect: function (selectedGroupId) {
      var ls = this.el.group;
      if (!ls) return;
      var keep = selectedGroupId != null ? String(selectedGroupId) : ls.value;
      ls.innerHTML = '';
      this.groupsForGroupSelect().forEach(function (G) {
        var o = document.createElement('option');
        o.value = G.groupId;
        o.textContent = G.name;
        ls.appendChild(o);
      });
      if (keep && ls.querySelector('option[value="' + keep + '"]')) ls.value = keep;
      else if (ls.options.length) ls.selectedIndex = 0;
    },

    knockoutPlayerCount: function () {
      var me = this;
      return (this.compPlayers || []).filter(function (p) {
        return p && p.playerId && !me.isPlaceholderPlayerId(p.playerId);
      }).length;
    },

    fillRoundSelect: function (selectedStageId) {
      var rs = this.el.round;
      if (!rs) return;
      var keep = selectedStageId != null ? String(selectedStageId) : rs.value;
      rs.innerHTML = '';
      var compType = this.currentCompType || 'knockout';
      (KnockoutRounds.adminStagesForPlayerCount(this.knockoutPlayerCount(), compType) || []).forEach(
        function (stage) {
          var o = document.createElement('option');
          o.value = stage.id;
          o.textContent = stage.label;
          rs.appendChild(o);
        }
      );
      if (keep && rs.querySelector('option[value="' + keep + '"]')) rs.value = keep;
      else if (rs.options.length) rs.selectedIndex = 0;
      this.syncCustomRoundFields();
    },

    syncCustomRoundFields: function () {
      var isCp = KnockoutRounds.isCustomPlayoffStage(this.el.round && this.el.round.value);
      if (this.el.customRoundWrap) this.el.customRoundWrap.hidden = !isCp;
      if (this.el.customRoundName) this.el.customRoundName.required = !!isCp;
    },

    usedMatchNumbersForStage: function (stageId, excludeFixtureId) {
      var used = {};
      (this.fixturesLoaded || []).forEach(function (f) {
        if (excludeFixtureId && String(f.fixtureId) === String(excludeFixtureId)) return;
        if (f['Stage'] !== 'knockout') return;
        var parsed = KnockoutRounds.parseStageMatch(f['Game Week']);
        if (parsed.stageId === stageId && parsed.matchNum) {
          used[parsed.matchNum] = true;
        }
      });
      return used;
    },

    nextAvailableMatchNum: function (stageId, excludeFixtureId) {
      var stage = (KnockoutRounds.adminStages(this.currentCompType) || []).find(function (s) {
        return s.id === stageId;
      });
      if (!stage) return 1;
      var used = this.usedMatchNumbersForStage(stageId, excludeFixtureId);
      for (var n = 1; n <= stage.matchCount; n++) {
        if (!used[n]) return n;
      }
      return stage.matchCount;
    },

    assignInternalMatchNum: function (excludeFixtureId) {
      var stageId = this.el.round && this.el.round.value;
      if (!stageId) {
        this._internalMatchNum = 1;
        return;
      }
      this._internalMatchNum = this.nextAvailableMatchNum(stageId, excludeFixtureId);
    },

    currentCompId: function () {
      return this.el.compSelect && this.el.compSelect.value;
    },

    compTypeFromList: function (compId) {
      var cid = compId != null ? compId : this.currentCompId();
      var c = (this.competitions || []).find(function (x) {
        return String(x.compId) === String(cid);
      });
      if (!c) return 'league';
      return this.normalizeCompType(c.competitionType || 'league');
    },

    isKnockoutComp: function () {
      return this.isBracketCompType(this.currentCompType);
    },

    loadCompGroups: function () {
      var me = this;
      var cid = me.currentCompId();
      if (!cid) {
        me.groups = [];
        me.currentCompType = 'league';
        me.fillGroupSelect();
        return Promise.resolve();
      }
      return ApiClient.get({ action: 'getCompetitionGroups', compId: cid }).then(function (r) {
        var groups = r.groups || [];
        var fromApi = r.competition
          ? me.normalizeCompType(r.competition.competitionType || 'league')
          : me.compTypeFromList(cid);
        me.currentCompType = fromApi;
        var isKoComp = me.isBracketCompType(fromApi);
        if (!isKoComp) {
          groups = groups.filter(function (g) {
            return String(g.groupId) !== KNOCKOUT_GROUP_ID;
          });
        }
        me.groups = groups;
        me.fillGroupSelect();
        me.fillRoundSelect();
      });
    },

    syncStageOptions: function () {
      if (!this.el.stage) return;
      var koComp = this.isKnockoutComp();
      var stageEl = this.el.stage;
      var stageWrap = stageEl.closest('p');
      stageEl.innerHTML = '';
      if (koComp) {
        var koOpt = document.createElement('option');
        koOpt.value = 'knockout';
        koOpt.textContent = 'Knockout';
        stageEl.appendChild(koOpt);
        stageEl.value = 'knockout';
        if (stageWrap) stageWrap.hidden = true;
      } else {
        [
          { value: 'group', label: 'Group' },
          { value: 'knockout', label: 'Knockout' },
        ].forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          stageEl.appendChild(o);
        });
        if (stageWrap) stageWrap.hidden = false;
      }
    },

    loadMeta: function () {
      var me = this;
      if (typeof AdminMode === 'undefined' || !AdminMode.isUnlocked()) return;
      ApiClient.get({ action: 'getCompetitions' })
        .then(function (r) {
          me.competitions = r.competitions || [];
          me.fillCompSelect();
          me.fillRoundSelect();
          return me.loadCompGroups();
        })
        .then(function () {
          return me.reloadFixtures();
        })
        .catch(function (e) {
          me.flash(e.message || String(e), true);
        });
    },

    reloadCompPlayers: function () {
      var me = this;
      var cid = me.currentCompId();
      if (!cid) {
        me.compPlayers = [];
        return Promise.resolve();
      }
      return ApiClient.get({ action: 'getPlayers', comp: cid }).then(function (r) {
        me.compPlayers = r.players || [];
      });
    },

    reloadFixtures: function () {
      var me = this;
      var cid = me.currentCompId();
      if (!cid) return Promise.resolve();
      return Promise.all([
        ApiClient.get({ action: 'getFixtures', comp: cid }),
        me.reloadCompPlayers(),
      ]).then(function (rs) {
        me.fixturesLoaded = rs[0].fixtures || [];
        me.renderList();
        me.updateCoherenceWarning();
      });
    },

    fixtureCoherenceIssues: function () {
      var me = this;
      if (!me.isKnockoutComp()) return [];
      var isDe = me.normalizeCompType(me.currentCompType) === 'double-eliminator';

      var roster = {};
      (me.compPlayers || []).forEach(function (p) {
        if (p && p.playerId && !me.isPlaceholderPlayerId(p.playerId)) {
          roster[p.playerId] = p.playerName || p.playerId;
        }
      });

      var appearances = {};
      (me.fixturesLoaded || []).forEach(function (f) {
        if (f['Stage'] !== 'knockout') return;
        ['playerAId', 'playerBId'].forEach(function (key) {
          var pid = f[key];
          if (!pid || me.isPlaceholderPlayerId(pid)) return;
          appearances[pid] = (appearances[pid] || 0) + 1;
        });
      });

      var issues = [];
      Object.keys(roster).forEach(function (pid) {
        if (!appearances[pid]) {
          issues.push(roster[pid] + ' is not in any fixture');
        }
      });
      if (!isDe) {
        Object.keys(appearances).forEach(function (pid) {
          if (appearances[pid] > 1) {
            issues.push((roster[pid] || pid) + ' appears in more than one fixture');
          }
        });
      }
      return issues;
    },

    updateCoherenceWarning: function () {
      var el = this.el.coherenceWarn;
      if (!el) return;
      if (!this.isKnockoutComp()) {
        el.hidden = true;
        el.textContent = '';
        return;
      }
      var issues = this.fixtureCoherenceIssues();
      if (!issues.length) {
        el.hidden = true;
        el.textContent = '';
        return;
      }
      el.hidden = false;
      el.textContent = 'Fixtures are incoherent: ' + issues.join('; ') + '.';
    },

    sortedFixturesForDisplay: function () {
      var me = this;
      var groupFx = [];
      var koFx = [];
      (this.fixturesLoaded || []).forEach(function (f) {
        if (f['Stage'] === 'knockout') koFx.push(f);
        else if (f['Stage'] === 'group') groupFx.push(f);
      });

      groupFx.sort(function (a, b) {
        var la = me.groupDisplayOrder(a['Group']);
        var lb = me.groupDisplayOrder(b['Group']);
        if (la !== lb) return la - lb;
        var wa = parseInt(String(a['Game Week']).trim(), 10);
        var wb = parseInt(String(b['Game Week']).trim(), 10);
        if (!Number.isFinite(wa)) wa = 0;
        if (!Number.isFinite(wb)) wb = 0;
        if (wa !== wb) return wa - wb;
        var na = me.displayFixturePlayerName(a, 'a');
        var nb = me.displayFixturePlayerName(b, 'a');
        return na.localeCompare(nb);
      });

      koFx.sort(function (a, b) {
        var sa = KnockoutRounds.sortKeyFor(a['Game Week']);
        var sb = KnockoutRounds.sortKeyFor(b['Game Week']);
        if (sa !== sb) return sa - sb;
        return me.displayFixturePlayerName(a, 'a').localeCompare(me.displayFixturePlayerName(b, 'a'));
      });

      return groupFx.concat(koFx);
    },

    isByePlayerId: function (playerId) {
      return String(playerId || '').trim().toLowerCase() === 'bye';
    },

    fixtureHasRealResult: function (f) {
      if (!f) return false;
      // Bye pads (structural, unscored) are never "played" matches.
      if (this.isByePlayerId(f.playerAId) || this.isByePlayerId(f.playerBId)) {
        return false;
      }
      var scoreA = f.scoreA;
      var scoreB = f.scoreB;
      // Important: Number(null) === 0, so require scores to be present explicitly.
      if (scoreA == null || scoreB == null) return false;
      if (!Number.isFinite(Number(scoreA)) || !Number.isFinite(Number(scoreB))) {
        return false;
      }
      return true;
    },

    canRegenerateFixtures: function () {
      var items = this.fixturesLoaded || [];
      if (!items.length) return false;
      var me = this;
      for (var i = 0; i < items.length; i++) {
        if (me.fixtureHasRealResult(items[i])) return false;
      }
      return true;
    },

    appendGenerateButton: function (parent, regenerate) {
      var me = this;
      var genBtn = document.createElement('button');
      genBtn.type = 'button';
      genBtn.className = 'btn';
      genBtn.id = regenerate ? 'adminFxRegenerateBtn' : 'adminFxGenerateBtn';
      genBtn.setAttribute('data-help', regenerate ? 'adminFx.regenerate' : 'adminFx.generate');
      genBtn.textContent = regenerate ? 'Re-generate Fixtures' : 'Generate Fixtures';
      genBtn.addEventListener('click', function () {
        me.generateFixtures(!!regenerate);
      });
      parent.appendChild(genBtn);
    },

    renderList: function () {
      var list = this.el.list;
      if (!list) return;
      list.innerHTML = '';
      var me = this;
      var items = this.sortedFixturesForDisplay();
      var ladder = me.isLadderComp();
      if (me.el.addBtn) me.el.addBtn.hidden = ladder;
      if (me.el.ladderHint) me.el.ladderHint.hidden = !ladder;
      if (ladder) {
        me.renderLadderList(list, items);
        return;
      }
      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'admin-fixtures-empty';
        var emptyText = document.createElement('p');
        emptyText.innerHTML = '<em>No fixtures for this comp.</em>';
        empty.appendChild(emptyText);
        me.appendGenerateButton(empty, false);
        list.appendChild(empty);
        return;
      }

      // Only offer re-generate when nothing has been played yet.
      if (me.canRegenerateFixtures()) {
        var regenBar = document.createElement('div');
        regenBar.className = 'admin-fixtures-regen';
        me.appendGenerateButton(regenBar, true);
        list.appendChild(regenBar);
      }

      var koStageLabels =
        typeof KnockoutRounds !== 'undefined' && KnockoutRounds.stageLabelsForFixtures
          ? KnockoutRounds.stageLabelsForFixtures(items)
          : {};

      var lastGroup = null;
      var lastWeek = null;
      var lastKoStage = null;

      items.forEach(function (f) {
        if (f['Stage'] === 'knockout') {
          var round = String(f['Game Week'] || '').trim();
          var stageKey = KnockoutRounds.stageKeyFor(round);
          if (stageKey !== lastKoStage) {
            lastKoStage = stageKey;
            lastGroup = null;
            lastWeek = null;
            var h = document.createElement('h3');
            h.className = 'admin-fixtures-list__header';
            h.textContent =
              koStageLabels[stageKey] ||
              KnockoutRounds.stageLabelFor(round, KnockoutRounds.fixtureRoundName(f));
            list.appendChild(h);
          }
        } else {
          lastKoStage = null;
          var gid = String(f['Group'] || '');
          var week = String(f['Game Week'] || '').trim();
          var grp = me.groupById(gid);
          var groupName = grp ? grp.name : 'Group ' + gid;
          if (gid !== lastGroup) {
            lastGroup = gid;
            lastWeek = null;
            var gh = document.createElement('h3');
            gh.className = 'admin-fixtures-list__header';
            gh.textContent = groupName;
            list.appendChild(gh);
          }
          if (week !== lastWeek) {
            lastWeek = week;
            var wh = document.createElement('h4');
            wh.className = 'admin-fixtures-list__subheader';
            var wn = parseInt(week, 10);
            wh.textContent = Number.isFinite(wn) ? 'Week ' + wn : week;
            list.appendChild(wh);
          }
        }

        var row = document.createElement('div');
        row.className = 'fixture-row admin-fixtures-list__row';
        row.dataset.fixtureId = f.fixtureId || '';

        var nameA = me.displayFixturePlayerName(f, 'a');
        var nameB = me.displayFixturePlayerName(f, 'b');

        var playerA = document.createElement('span');
        playerA.className = 'admin-fixtures-list__player-a';
        playerA.textContent = nameA;

        var center = document.createElement('button');
        center.type = 'button';
        center.className = 'fixture-vs-btn admin-fixtures-list__vs';
        center.setAttribute('data-help', 'adminFx.edit');
        center.textContent = 'V';
        center.setAttribute('aria-label', 'Edit fixture: ' + nameA + ' vs ' + nameB);
        center.addEventListener('click', function () {
          me.openDialogEdit(f);
        });

        var playerB = document.createElement('span');
        playerB.className = 'admin-fixtures-list__player-b';
        playerB.textContent = nameB;

        row.appendChild(playerA);
        row.appendChild(center);
        row.appendChild(playerB);

        // Played matches show their score under the names, so they read differently from unplayed ones.
        var resultText = String(f['Result'] || '').trim();
        if (resultText) {
          var pending = f.resultApproved === false;
          var scoreLine = document.createElement('span');
          scoreLine.className = 'admin-fixtures-list__score' + (pending ? ' is-unapproved' : '');
          scoreLine.textContent = (f.setLine || resultText) + (pending ? ' (pending approval)' : '');
          row.classList.add('admin-fixtures-list__row--played');
          var sa = Number(f.scoreA);
          var sb = Number(f.scoreB);
          if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
            (sa > sb ? playerA : playerB).classList.add('fixture-player-name--winner');
          }
          row.appendChild(scoreLine);
          center.setAttribute('aria-label', 'Edit fixture: ' + nameA + ' vs ' + nameB + ', result ' + scoreLine.textContent);
        }
        list.appendChild(row);
      });
    },

    /** Ladder challenges: read-only rows; unplayed challenges can be cancelled. */
    renderLadderList: function (list, items) {
      var me = this;
      if (!items.length) {
        list.innerHTML = '<p class="admin-fixtures-empty"><em>No challenges yet.</em></p>';
        return;
      }
      var h = document.createElement('h3');
      h.className = 'admin-fixtures-list__header';
      h.textContent = 'Challenges';
      list.appendChild(h);
      items.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'fixture-row admin-fixtures-list__row';
        var a = document.createElement('span');
        a.className = 'admin-fixtures-list__player-a';
        a.textContent = f['Player A'] || '';
        var mid = document.createElement('span');
        mid.className = 'fixture-vs-static';
        mid.textContent = f['Result'] ? f.setLine || f['Result'] : 'V';
        var b = document.createElement('span');
        b.className = 'admin-fixtures-list__player-b';
        b.textContent = f['Player B'] || '';
        row.appendChild(a);
        row.appendChild(mid);
        row.appendChild(b);
        if (!f['Result']) {
          var cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'btn btn-secondary admin-fixtures-list__cancel';
          cancel.textContent = 'Cancel';
          cancel.setAttribute('data-help', 'ladder.cancel');
          cancel.addEventListener('click', function () {
            me.cancelChallenge(f);
          });
          row.appendChild(cancel);
        }
        list.appendChild(row);
      });
    },

    cancelChallenge: function (f) {
      var me = this;
      ConfirmDialog.show({
        title: 'Cancel this challenge?',
        message: (f['Player A'] || '') + ' v ' + (f['Player B'] || '') + ' will be removed. Nobody moves on the ladder.',
        confirmLabel: 'Cancel challenge',
        cancelLabel: 'Keep it',
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        return ApiClient.post('cancelChallenge', { fixtureId: f.fixtureId })
          .then(function () {
            me.flash('Challenge cancelled.', false);
            return me.reloadFixtures();
          })
          .catch(function (err) {
            me.flash(err.message || String(err), true);
          });
      });
    },

    syncStageFields: function () {
      var stage = this.el.stage && this.el.stage.value;
      var isKo = stage === 'knockout';
      if (this.el.groupFields) this.el.groupFields.hidden = isKo;
      if (this.el.koFields) this.el.koFields.hidden = !isKo;
      if (this.el.group) this.el.group.required = !isKo;
      if (this.el.week) this.el.week.required = !isKo;
      if (this.el.round) this.el.round.required = isKo;
      this.syncCustomRoundFields();
      this.fillGroupSelect(this.el.group && this.el.group.value);
      this.fillPlayerSelects(
        this.el.pa && this.el.pa.value,
        this.el.pb && this.el.pb.value
      );
    },

    playersForDropdown: function () {
      var me = this;
      var stage = this.el.stage && this.el.stage.value;
      var players = (this.compPlayers || []).slice();
      players = players.filter(function (p) {
        return !me.isPlaceholderPlayerId(p.playerId);
      });
      if (stage === 'group' && this.el.group && this.el.group.value) {
        var gid = String(this.el.group.value);
        players = players.filter(function (p) {
          return String(playerGroup(p) || '') === gid;
        });
      }
      players.sort(function (a, b) {
        return String(a.playerName || '').localeCompare(String(b.playerName || ''));
      });
      return players;
    },

    currentKoRoundCode: function () {
      var stage = this.el.stage && this.el.stage.value;
      if (stage !== 'knockout') return '';
      var stageId = this.el.round && this.el.round.value;
      var matchNum = this._internalMatchNum;
      if (!stageId || !matchNum) return '';
      return KnockoutRounds.codeForStageMatch(stageId, matchNum);
    },

    earlierKoRoundCodes: function () {
      var current = this.currentKoRoundCode();
      if (!current) return [];
      var currentKey = KnockoutRounds.sortKeyFor(current);
      var codes = {};
      (this.fixturesLoaded || []).forEach(function (f) {
        if (f['Stage'] !== 'knockout') return;
        var code = String(f['Game Week'] || '').trim();
        if (!code || KnockoutRounds.sortKeyFor(code) >= currentKey) return;
        codes[code] = true;
      });
      return Object.keys(codes).sort(function (a, b) {
        return KnockoutRounds.sortKeyFor(a) - KnockoutRounds.sortKeyFor(b);
      });
    },

    winnerOfOptions: function () {
      var fixtures = this.fixturesLoaded || [];
      return this.earlierKoRoundCodes().map(function (code) {
        return {
          playerId: KnockoutRounds.winnerOfPlayerId(code),
          playerName: KnockoutRounds.winnerOfDisplayLabel(code, fixtures),
        };
      });
    },

    loserOfOptions: function () {
      if (this.normalizeCompType(this.currentCompType) !== 'double-eliminator') return [];
      var fixtures = this.fixturesLoaded || [];
      return this.earlierKoRoundCodes().map(function (code) {
        return {
          playerId: KnockoutRounds.loserOfPlayerId(code),
          playerName: KnockoutRounds.loserOfDisplayLabel(code, fixtures),
        };
      });
    },

    appendPlayerSelectOptions: function (select, players, winnerOpts, loserOpts) {
      if (!select) return;
      if (winnerOpts && winnerOpts.length) {
        var ogWin = document.createElement('optgroup');
        ogWin.label = 'Winner of earlier round';
        winnerOpts.forEach(function (w) {
          var o = document.createElement('option');
          o.value = w.playerId;
          o.textContent = w.playerName;
          ogWin.appendChild(o);
        });
        select.appendChild(ogWin);
      }
      if (loserOpts && loserOpts.length) {
        var ogLose = document.createElement('optgroup');
        ogLose.label = 'Loser of earlier round';
        loserOpts.forEach(function (w) {
          var o = document.createElement('option');
          o.value = w.playerId;
          o.textContent = w.playerName;
          ogLose.appendChild(o);
        });
        select.appendChild(ogLose);
      }
      if (players.length) {
        var ogPlayers = document.createElement('optgroup');
        ogPlayers.label = 'Players';
        players.forEach(function (p) {
          var o = document.createElement('option');
          o.value = p.playerId;
          o.textContent = p.playerName;
          ogPlayers.appendChild(o);
        });
        select.appendChild(ogPlayers);
      }
    },

    ensureWinnerOfOption: function (select, playerId) {
      if (!select || !playerId || !KnockoutRounds.isWinnerOfPlayerId(playerId)) return;
      var opts = select.options;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === playerId) return;
      }
      var code = KnockoutRounds.roundCodeFromWinnerOfId(playerId);
      var o = document.createElement('option');
      o.value = playerId;
      o.textContent = KnockoutRounds.winnerOfDisplayLabel(code, this.fixturesLoaded || []);
      select.appendChild(o);
    },

    ensureLoserOfOption: function (select, playerId) {
      if (
        !select ||
        !playerId ||
        !KnockoutRounds.isLoserOfPlayerId ||
        !KnockoutRounds.isLoserOfPlayerId(playerId)
      ) {
        return;
      }
      var opts = select.options;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === playerId) return;
      }
      var code = KnockoutRounds.roundCodeFromLoserOfId(playerId);
      var o = document.createElement('option');
      o.value = playerId;
      o.textContent = KnockoutRounds.loserOfDisplayLabel(code, this.fixturesLoaded || []);
      select.appendChild(o);
    },

    fillPlayerSelects: function (selectedA, selectedB) {
      var pa = this.el.pa;
      var pb = this.el.pb;
      if (!pa || !pb) return;
      var players = this.playersForDropdown();
      var isKo = this.el.stage && this.el.stage.value === 'knockout';
      var winnerOpts = isKo ? this.winnerOfOptions() : [];
      var loserOpts = isKo ? this.loserOfOptions() : [];
      pa.innerHTML = '<option value="">— Select —</option>';
      pb.innerHTML = '<option value="">— Select —</option>';
      this.appendPlayerSelectOptions(pa, players, winnerOpts, loserOpts);
      this.appendPlayerSelectOptions(pb, players, winnerOpts, loserOpts);
      this.ensureWinnerOfOption(pa, selectedA);
      this.ensureWinnerOfOption(pb, selectedB);
      this.ensureLoserOfOption(pa, selectedA);
      this.ensureLoserOfOption(pb, selectedB);
      if (selectedA) pa.value = selectedA;
      if (selectedB) pb.value = selectedB;
    },

    generateFixtures: function (regenerate) {
      var me = this;
      var compId = me.currentCompId();
      if (!compId) {
        me.flash('Select a comp.', true);
        return;
      }
      if (regenerate) {
        if (!me.canRegenerateFixtures()) {
          me.flash('Cannot re-generate: one or more fixtures have already been played.', true);
          return;
        }
      }
      ConfirmDialog.show(
        regenerate
          ? {
              title: 'Re-generate fixtures?',
              message:
                'This permanently deletes every fixture in this competition and creates a new set. Only continue if no matches have been played.',
              confirmLabel: 'Re-generate',
              danger: true,
            }
          : { title: 'Generate fixtures?', message: 'Create all fixtures for this competition from its roster.', confirmLabel: 'Generate' }
      )
        .then(function (ok) {
          if (!ok) return null;
          return WorkingIndicator.withWorking(
            ApiClient.post('generateFixtures', { compId: compId, regenerate: !!regenerate }),
            'Generating fixtures…'
          );
        })
        .then(function (res) {
          if (!res) return;
          var verb = res.regenerated ? 'Re-generated' : 'Generated';
          me.flash(verb + ' ' + (res.created || 0) + ' fixtures.', false);
          return me.reloadFixtures();
        })
        .catch(function (err) {
          me.flash(err.message || String(err), true);
        });
    },

    /** Sets needed to win: 1 (one set), 2 (best of 3) or 3 (best of 5). */
    normalizeSetsToWin: function (raw) {
      var n = parseInt(raw, 10);
      return n >= 1 && n <= 3 ? n : null;
    },

    readSetsToWinFromDialog: function () {
      var stage = this.el.stage && this.el.stage.value;
      var el = stage === 'knockout' ? this.el.setsKo : this.el.setsLeague;
      return this.normalizeSetsToWin(el ? el.value : 2);
    },

    setSetsToWinFields: function (value) {
      var n = this.normalizeSetsToWin(value);
      var comp = this.currentComp();
      var v = String(n || (comp && comp.setsToWin) || 2);
      if (this.el.setsLeague) this.el.setsLeague.value = v;
      if (this.el.setsKo) this.el.setsKo.value = v;
    },

    openDialogAdd: function () {
      this._isEditMode = false;
      if (this.el.fixtureId) this.el.fixtureId.value = '';
      this.setSetsToWinFields(null);
      this.syncStageOptions();
      if (this.el.stage) {
        this.el.stage.disabled = false;
      }
      if (this.el.week) this.el.week.value = '';
      if (this.el.customRoundName) this.el.customRoundName.value = '';
      this.fillRoundSelect();
      if (this.el.round) this.el.round.selectedIndex = 0;
      this.assignInternalMatchNum();
      if (this.el.deleteBtn) this.el.deleteBtn.hidden = true;
      this.fillGroupSelect();
      this.syncStageFields();
      this.fillPlayerSelects('', '');
      this.dialogFlash('', false);
      if (this.el.dialog && typeof this.el.dialog.showModal === 'function') {
        this.el.dialog.showModal();
      }
    },

    openDialogEdit: function (f) {
      this._isEditMode = true;
      if (this.el.fixtureId) this.el.fixtureId.value = f.fixtureId || '';
      this.syncStageOptions();
      if (this.el.stage) {
        this.el.stage.value = f['Stage'] === 'knockout' ? 'knockout' : 'group';
        this.el.stage.disabled = true;
      }
      if (f['Stage'] === 'knockout') {
        var code = String(f['Game Week'] || '').trim();
        var parsed = KnockoutRounds.parseStageMatch(code);
        if (parsed.stageId) {
          this.fillRoundSelect(parsed.stageId);
          if (this.el.round) this.el.round.value = parsed.stageId;
          this._internalMatchNum = parsed.matchNum || 1;
        } else {
          this.fillRoundSelect();
          if (this.el.round) this.el.round.selectedIndex = 0;
          this.assignInternalMatchNum(f.fixtureId);
        }
        if (this.el.customRoundName) {
          this.el.customRoundName.value = KnockoutRounds.fixtureRoundName(f);
        }
      } else {
        this.fillGroupSelect(String(f['Group'] || ''));
        if (this.el.week) this.el.week.value = String(f['Game Week'] || '');
        if (this.el.customRoundName) this.el.customRoundName.value = '';
      }
      if (this.el.deleteBtn) this.el.deleteBtn.hidden = false;
      this.setSetsToWinFields(f.setsToWin);
      this.syncStageFields();
      this.fillPlayerSelects(f.playerAId || '', f.playerBId || '');
      this.dialogFlash('', false);
      if (this.el.dialog && typeof this.el.dialog.showModal === 'function') {
        this.el.dialog.showModal();
      }
    },

    closeDialog: function () {
      if (this.el.dialog && typeof this.el.dialog.close === 'function') {
        this.el.dialog.close();
      }
    },

    groupSortOrder: function (groupId, weekNum) {
      var ord = this.groupDisplayOrder(groupId);
      var w = Number.isFinite(weekNum) ? weekNum : 0;
      return ord * 1000 + w * 10;
    },

    saveDialog: function (e) {
      if (e) e.preventDefault();
      var me = this;
      var compId = me.currentCompId();
      if (!compId) {
        me.dialogFlash('Select a comp.', true);
        return;
      }
      var stage = me.el.stage && me.el.stage.value;
      if (stage === 'knockout' && !me.isKnockoutComp()) {
        me.dialogFlash('Knockout stage is only allowed for knockout / double-eliminator comps.', true);
        return;
      }
      if (stage === 'group' && me.isKnockoutComp()) {
        me.dialogFlash('Group stage is not used for knockout / double-eliminator comps.', true);
        return;
      }
      var pa = me.el.pa && me.el.pa.value;
      var pb = me.el.pb && me.el.pb.value;
      if (!pa || !pb) {
        me.dialogFlash('Select both sides.', true);
        return;
      }
      if (pa === pb) {
        me.dialogFlash('The two sides must be different.', true);
        return;
      }

      var payload = {
        compId: compId,
        stage: stage,
        playerAId: pa,
        playerBId: pb,
      };
      var fid = me.el.fixtureId && me.el.fixtureId.value.trim();
      if (fid) payload.fixtureId = fid;

      if (stage === 'knockout') {
        var roundVal = me.currentKoRoundCode();
        if (!roundVal) {
          me.dialogFlash('Select a round.', true);
          return;
        }
        payload.roundLabel = roundVal;
        payload.sortOrder = KnockoutRounds.sortOrderFor(roundVal);
        if (KnockoutRounds.isCustomPlayoffStage(me.el.round && me.el.round.value)) {
          var customName = me.el.customRoundName
            ? String(me.el.customRoundName.value || '').trim()
            : '';
          if (!customName) {
            me.dialogFlash('Enter a custom round name.', true);
            return;
          }
          payload.roundName = customName;
        } else {
          payload.roundName = '';
        }
      } else {
        var groupId = me.el.group && me.el.group.value;
        var weekRaw = me.el.week && me.el.week.value.trim();
        var weekNum = parseInt(weekRaw, 10);
        if (!groupId) {
          me.dialogFlash('Select a group.', true);
          return;
        }
        if (!weekRaw || !Number.isFinite(weekNum)) {
          me.dialogFlash('Enter a valid week number.', true);
          return;
        }
        payload.groupId = groupId;
        payload.roundLabel = String(weekNum);
        payload.sortOrder = me.groupSortOrder(groupId, weekNum);
      }

      var setsToWin = me.readSetsToWinFromDialog();
      if (setsToWin == null) {
        me.dialogFlash('Choose a match length.', true);
        return;
      }
      payload.setsToWin = setsToWin;

      ApiClient.post('upsertFixture', payload)
        .then(function () {
          me.flash('Fixture saved.', false);
          me.closeDialog();
          return me.reloadFixtures();
        })
        .catch(function (err) {
          me.dialogFlash(err.message || String(err), true);
        });
    },

    deleteFixture: function () {
      var me = this;
      var fid = me.el.fixtureId && me.el.fixtureId.value.trim();
      if (!fid) return;
      me.confirmOverDialog({ title: 'Delete this fixture?', message: 'The fixture and any result are removed.', confirmLabel: 'Delete', danger: true })
        .then(function (ok) {
          if (!ok) return null;
          return ApiClient.post('deleteFixture', { fixtureId: fid }).then(function () {
            return true;
          });
        })
        .then(function (done) {
          if (!done) return;
          me.flash('Fixture deleted.', false);
          me.closeDialog();
          return me.reloadFixtures();
        })
        .catch(function (err) {
          me.dialogFlash(err.message || String(err), true);
        });
    },

    bind: function () {
      var me = this;
      if (this.el.compSelect) {
        this.el.compSelect.addEventListener('change', function () {
          me.loadCompGroups()
            .then(function () {
              return me.reloadFixtures();
            })
            .catch(function (e) {
              me.flash(e.message || String(e), true);
            });
        });
      }
      if (this.el.addBtn) {
        this.el.addBtn.addEventListener('click', function () {
          me.openDialogAdd();
        });
      }
      if (this.el.stage) {
        this.el.stage.addEventListener('change', function () {
          me.syncStageFields();
        });
      }
      if (this.el.group) {
        this.el.group.addEventListener('change', function () {
          me.fillPlayerSelects(
            me.el.pa && me.el.pa.value,
            me.el.pb && me.el.pb.value
          );
        });
      }
      if (this.el.round) {
        this.el.round.addEventListener('change', function () {
          if (!me._isEditMode) me.assignInternalMatchNum();
          me.syncCustomRoundFields();
          me.fillPlayerSelects(
            me.el.pa && me.el.pa.value,
            me.el.pb && me.el.pb.value
          );
        });
      }
      if (this.el.form) {
        this.el.form.addEventListener('submit', function (e) {
          me.saveDialog(e);
        });
      }
      var cancel = document.getElementById('adminFxCancelBtn');
      if (cancel) {
        cancel.addEventListener('click', function () {
          me.closeDialog();
        });
      }
      if (this.el.deleteBtn) {
        this.el.deleteBtn.addEventListener('click', function () {
          me.deleteFixture();
        });
      }
    },

    init: function () {
      if (!document.getElementById('adminFixturesRoot')) return;
      this.cacheEls();
      this.bind();
      var me = this;
      window.addEventListener(this.adminEvt(), function () {
        me.syncGate();
      });
      this.syncGate();
    },
  };

  return { init: function () { self.init(); } };
})();
