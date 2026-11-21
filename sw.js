// Service worker: network first, cached shell as the offline fallback.
// Bump the version whenever a shell file changes or the list below changes.
var CACHE_PREFIX = 'ierne-tennis-shell-';
var CACHE = CACHE_PREFIX + 'v3';
var SHELL = [
  './',
  './index.html',
  './standings.html',
  './ladder.html',
  './fixtures.html',
  './results.html',
  './rules.html',
  './manifest.json',
  './assets/css/style.css',
  './assets/css/contextual-help.css',
  './assets/css/brief-message.css',
  './assets/css/confirm-dialog.css',
  './assets/css/working-indicator.css',
  './assets/css/fixture-features.css',
  './assets/css/tennis.css',
  './assets/icons/favicon-32.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/images/Ierne-logo-768x920.png',
  './assets/images/court-hero.svg',
  './assets/js/scripts.min.js',
  './assets/js/config/app-config.js',
  './assets/js/utils/api-client.js',
  './assets/js/utils/current-competition.js',
  './assets/js/utils/nav-competition.js',
  './assets/js/utils/admin-mode.js',
  './assets/js/utils/player-session.js',
  './assets/js/utils/formatters.js',
  './assets/js/utils/image-loader.js',
  './assets/js/utils/nav-active.js',
  './assets/js/utils/brief-message.js',
  './assets/js/utils/confirm-dialog.js',
  './assets/js/utils/working-indicator.js',
  './assets/js/utils/tennis-score.js',
  './assets/js/utils/knockout-rounds.js',
  './assets/js/utils/knockout-bracket.js',
  './assets/js/utils/league-group-filter.js',
  './assets/js/utils/image-compress.js',
  './assets/js/utils/help-catalog.js',
  './assets/js/components/contextual-help.js',
  './assets/js/components/result-slip-upload.js',
  './assets/js/components/league-standings.js',
  './assets/js/pages/index.js',
  './assets/js/pages/fixtures.js',
  './assets/js/pages/results.js',
  './assets/js/pages/standings.js',
  './assets/js/pages/ladder.js',
  './assets/js/main.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }));
  self.skipWaiting();
});

// Other CursorSites apps share this origin (zarleyltd.github.io), so only
// delete this app's own old caches.
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE;
    }).map(function (key) {
      return caches.delete(key);
    }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(function (response) {
    var copy = response.clone();
    caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
    return response;
  }).catch(function () {
    return caches.match(event.request);
  }));
});
