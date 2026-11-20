// Updates nav links based on the now-showing competition.
// Standings and the group filter only apply to leagues; the Ladder link only
// to ladder comps. Inline head scripts on each page apply the same rule from
// sessionStorage before the API answers, to avoid a flash.

var NavCompetition = {
  init: function () {
    var self = this;
    this.syncFromSession();
    if (typeof CurrentCompetition === 'undefined') return;
    CurrentCompetition.whenReady(function () {
      self.apply();
    });
    window.addEventListener(CurrentCompetition.EVENT_NAME, function () {
      self.apply();
    });
  },

  syncFromSession: function () {
    var type = 'league';
    try {
      type = sessionStorage.getItem('ierneTennisCurrentCompType') || 'league';
    } catch (_e) {
      /* ignore */
    }
    this.syncForType(type);
  },

  syncForType: function (type) {
    var isLeague = type === 'league';
    this.syncLeagueFilters(!isLeague);
    this.syncNavItems('.nav-item-standings', '.footer-standings-link', !isLeague);
    this.syncNavItems('.nav-item-ladder', '.footer-ladder-link', type !== 'ladder');
  },

  syncNavItems: function (navSelector, footerSelector, hide) {
    document.querySelectorAll(navSelector).forEach(function (li) {
      li.hidden = hide;
      if (hide) li.setAttribute('aria-hidden', 'true');
      else li.removeAttribute('aria-hidden');
    });
    document.querySelectorAll(footerSelector).forEach(function (link) {
      var li = link.closest('li');
      if (!li) return;
      li.hidden = hide;
      if (hide) li.setAttribute('aria-hidden', 'true');
      else li.removeAttribute('aria-hidden');
    });
  },

  syncLeagueFilters: function (hide) {
    if (hide) document.documentElement.classList.add('ierne-tennis-no-groups');
    else document.documentElement.classList.remove('ierne-tennis-no-groups');
    var filterContainer = document.getElementById('filter-container');
    if (!filterContainer) return;
    if (hide) {
      filterContainer.classList.remove('filters-visible');
      filterContainer.hidden = true;
      filterContainer.setAttribute('aria-hidden', 'true');
    } else {
      filterContainer.classList.add('filters-visible');
      filterContainer.hidden = false;
      filterContainer.removeAttribute('aria-hidden');
    }
  },

  apply: function () {
    var comp = CurrentCompetition.get();
    var type = 'league';
    if (CurrentCompetition.isKnockout()) type = 'knockout';
    else if (CurrentCompetition.isLadder()) type = 'ladder';
    this.syncForType(type);

    var compLabel = document.getElementById('page-competition-name');
    if (compLabel && comp) {
      compLabel.textContent = comp.name || '';
    }
    this.syncActiveNav();
  },

  syncActiveNav: function () {
    var path = (window.location.pathname || '').split('/').pop() || 'index.html';
    document.querySelectorAll('.navbar__menu > li').forEach(function (li) {
      li.classList.remove('active');
    });
    document.querySelectorAll('.navbar__menu a[href]').forEach(function (link) {
      var href = link.getAttribute('href') || '';
      var li = link.closest('li');
      if (!li) return;
      if (href === path) li.classList.add('active');
    });
  },
};
