// Admin — create or edit one player: name, gender (used to check mixed
// pairs), active flag, plus the pairs and comps they are in.

var AdminPlayerPage = (function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function qsPlayerId() {
    try {
      return new URL(window.location.href).searchParams.get('playerId') || '';
    } catch (_e) {
      return '';
    }
  }

  function compTypeLabel(t) {
    var n = String(t || '').trim().toLowerCase();
    if (n === 'knockout') return 'Knockout';
    if (n === 'double-eliminator' || n === 'double_eliminator') return 'Double-Eliminator';
    if (n === 'ladder') return 'Ladder';
    return 'League';
  }

  var self = {
    playerId: '',
    player: null,
    el: {},

    adminEvt: function () {
      return typeof AdminMode !== 'undefined' ? AdminMode.EVENT_NAME : 'ierne-tennis-admin-mode-changed';
    },

    cacheEls: function () {
      var g = function (id) {
        return document.getElementById(id);
      };
      this.el = {
        gate: g('adminPlayerGate'),
        panel: g('adminPlayerPanel'),
        msg: g('adminPlayerMsg'),
        title: g('adminPlayerTitle'),
        form: g('adminPlayerForm'),
        name: g('adminPlayerName'),
        gender: g('adminPlayerGender'),
        active: g('adminPlayerActive'),
        del: g('adminPlayerDelete'),
        pairsSection: g('adminPlayerPairsSection'),
        pairsList: g('adminPlayerPairsList'),
        compsSection: g('adminPlayerCompsSection'),
        compsList: g('adminPlayerCompsList'),
      };
    },

    flash: function (text, isErr) {
      if (!this.el.msg) return;
      this.el.msg.textContent = text || '';
      this.el.msg.className = 'msg' + (isErr ? ' msg--warning' : ' msg--success');
      this.el.msg.hidden = !text;
    },

    isCreateMode: function () {
      return !this.playerId;
    },

    syncGate: function () {
      var ok = typeof AdminMode !== 'undefined' && AdminMode.isUnlocked();
      if (this.el.gate) this.el.gate.hidden = ok;
      if (this.el.panel) this.el.panel.hidden = !ok;
      if (ok) {
        this.playerId = qsPlayerId();
        this.loadAll();
      }
    },

    setPageTitle: function () {
      var text = this.isCreateMode() ? 'Add Player' : 'Edit Player';
      if (this.el.title) this.el.title.textContent = text;
      document.title =
        (this.isCreateMode() ? 'Add Player' : (this.player && this.player.playerName) || 'Edit Player') + ' - ierne-tennis';
    },

    loadAll: function () {
      var me = this;
      if (this.isCreateMode()) {
        if (this.el.name) this.el.name.value = '';
        if (this.el.gender) this.el.gender.value = '';
        if (this.el.active) this.el.active.checked = true;
        if (this.el.del) this.el.del.hidden = true;
        if (this.el.pairsSection) this.el.pairsSection.hidden = true;
        if (this.el.compsSection) this.el.compsSection.hidden = true;
        this.setPageTitle();
        return Promise.resolve();
      }
      return Promise.all([
        ApiClient.get({ action: 'getPlayers' }),
        ApiClient.get({ action: 'getPlayerComps', playerId: this.playerId }),
        ApiClient.get({ action: 'getEntrants', kind: 'pair' }),
      ])
        .then(function (rs) {
          me.player = (rs[0].players || []).find(function (p) {
            return p.playerId === me.playerId;
          });
          if (!me.player) {
            me.flash('Player not found: ' + me.playerId, true);
            return;
          }
          if (me.el.name) me.el.name.value = me.player.playerName || '';
          if (me.el.gender) me.el.gender.value = me.player.gender || '';
          if (me.el.active) me.el.active.checked = me.player.active !== false;
          if (me.el.del) me.el.del.hidden = false;
          me.setPageTitle();
          var pairs = (rs[2].entrants || []).filter(function (e) {
            return (e.memberIds || []).indexOf(me.playerId) >= 0;
          });
          me.renderPairs(pairs);
          me.renderComps(rs[1].competitions || []);
        })
        .catch(function (err) {
          me.flash(err.message || String(err), true);
        });
    },

    renderPairs: function (pairs) {
      if (this.el.pairsSection) this.el.pairsSection.hidden = false;
      var box = this.el.pairsList;
      if (!box) return;
      if (!pairs.length) {
        box.innerHTML = '<p class="admin-player-picks__hint"><em>Not in any doubles pair.</em></p>';
        return;
      }
      var me = this;
      box.innerHTML = pairs
        .map(function (p) {
          var removable = !p.compCount && !p.matchCount;
          return (
            '<div class="admin-player-picks__row admin-item-list__row">' +
            '<span class="admin-player-picks__name">' + esc(p.name) + '</span>' +
            '<span class="admin-item-list__meta">' + p.compCount + ' comps · ' + p.matchCount + ' matches' +
            (removable
              ? ' <button type="button" class="btn btn-danger btn-small" data-delete-pair="' + esc(p.entrantId) + '" data-help="adminPlayer.deletePair">Delete pair</button>'
              : '') +
            '</span></div>'
          );
        })
        .join('');
      box.querySelectorAll('[data-delete-pair]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          me.deletePair(btn.getAttribute('data-delete-pair'));
        });
      });
    },

    renderComps: function (comps) {
      if (this.el.compsSection) this.el.compsSection.hidden = false;
      var box = this.el.compsList;
      if (!box) return;
      if (!comps.length) {
        box.innerHTML = '<p class="admin-player-picks__hint"><em>Not on any comp roster.</em></p>';
        return;
      }
      box.innerHTML = comps
        .map(function (c) {
          return (
            '<a class="admin-player-picks__row admin-item-list__row' + (c.isCurrent ? ' admin-item-list__row--current' : '') +
            '" href="admin-competitions.html?compId=' + encodeURIComponent(c.compId) + '">' +
            '<span class="admin-player-picks__name">' + esc(c.name) + '</span>' +
            '<span class="admin-item-list__meta">' + compTypeLabel(c.competitionType) +
            (c.entrantKind === 'pair' ? ' · as ' + esc(c.entrantName) : '') + '</span></a>'
          );
        })
        .join('');
    },

    savePlayer: function (e) {
      if (e) e.preventDefault();
      var me = this;
      var name = (me.el.name && me.el.name.value.trim()) || '';
      if (!name) {
        me.flash('Player name required.', true);
        return;
      }
      var payload = {
        playerName: name,
        gender: me.el.gender ? me.el.gender.value : '',
        active: me.el.active ? me.el.active.checked : true,
      };
      payload.playerId = me.playerId || PlayerSlug.slugify(name);
      ApiClient.post('upsertPlayer', payload)
        .then(function (res) {
          if (me.isCreateMode()) {
            window.location.href = 'admin-player.html?playerId=' + encodeURIComponent((res && res.playerId) || payload.playerId);
            return;
          }
          me.flash('Player saved.', false);
          return me.loadAll();
        })
        .catch(function (err) {
          me.flash(err.message || String(err), true);
        });
    },

    deletePlayer: function () {
      if (this.isCreateMode()) return;
      var me = this;
      var label = (this.player && this.player.playerName) || this.playerId;
      ConfirmDialog.show({
        title: 'Delete player?',
        message: 'Delete "' + label + '"? This is refused while they are in a comp or have fixtures.',
        confirmLabel: 'Delete player',
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        ApiClient.post('deletePlayer', { playerId: me.playerId })
          .then(function () {
            window.location.href = 'admin-players.html';
          })
          .catch(function (err) {
            me.flash(err.message || String(err), true);
          });
      });
    },

    deletePair: function (entrantId) {
      var me = this;
      ConfirmDialog.show({ title: 'Delete pair?', message: 'This pair is not in any comp, so it can be removed.', confirmLabel: 'Delete pair', danger: true })
        .then(function (ok) {
          if (!ok) return null;
          return ApiClient.post('deletePair', { entrantId: entrantId });
        })
        .then(function (res) {
          if (!res) return;
          me.flash('Pair deleted.', false);
          return me.loadAll();
        })
        .catch(function (err) {
          me.flash(err.message || String(err), true);
        });
    },

    bind: function () {
      var me = this;
      if (this.el.form) {
        this.el.form.addEventListener('submit', function (e) {
          me.savePlayer(e);
        });
      }
      if (this.el.del) {
        this.el.del.addEventListener('click', function () {
          me.deletePlayer();
        });
      }
    },

    init: function () {
      if (!document.getElementById('adminPlayerRoot')) return;
      this.cacheEls();
      this.bind();
      var me = this;
      window.addEventListener(this.adminEvt(), function () {
        me.syncGate();
      });
      this.syncGate();
    },
  };

  return {
    init: function () {
      self.init();
    },
  };
})();
