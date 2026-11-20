// Main Entry Point & Page Router
// Initialises the page module whose root element is in the DOM.

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}

if (window.ContextualHelp && typeof window.ContextualHelp.init === 'function') {
  window.ContextualHelp.init();
}

document.addEventListener('DOMContentLoaded', function () {
  ImageLoader.init();

  // Shared now-showing competition context (public pages)
  if (typeof CurrentCompetition !== 'undefined') {
    CurrentCompetition.init().catch(function (err) {
      console.error('CurrentCompetition init failed:', err);
    });
  }
  if (typeof NavCompetition !== 'undefined') NavCompetition.init();

  var routes = [
    // Admin pages (actions require Admin Mode)
    ['adminFixturesRoot', 'AdminFixturesPage'],
    ['adminPlayersRoot', 'AdminPlayersPage'],
    ['adminPlayerRoot', 'AdminPlayerPage'],
    ['adminCompetitionsRoot', 'AdminCompetitionsPage'],
    ['adminAccountsRoot', 'AdminAccountsPage'],
    // Public pages
    ['home-carousel', 'IndexPage'],
    ['fixtures-list', 'FixturesPage'],
    ['results-list', 'ResultsPage'],
    ['leagues-standings-root', 'StandingsPage'],
    ['ladder-root', 'LadderPage'],
    ['rules-format', 'RulesPage'],
  ];
  routes.forEach(function (route) {
    var mod = window[route[1]];
    if (document.getElementById(route[0]) && mod && typeof mod.init === 'function') {
      mod.init();
    }
  });
});
