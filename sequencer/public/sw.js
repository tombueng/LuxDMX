// Offline support: venues often have no internet. Everything the app loads from its own site is
// kept, and served from here when the network isn't there (and refreshed when it is). Fixture
// definitions from the libraries are kept the same way once used. Nothing here sends anything.
const CACHE = 'luxdmx-sequencer-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './ofl/index.json', './qlc/index.json'];
const LIBRARIES = ['https://cdn.jsdelivr.net/gh/OpenLightingProject/', 'https://raw.githubusercontent.com/mcallegari/qlcplus/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  const lib = LIBRARIES.some((p) => req.url.startsWith(p));
  if (!own && !lib) return;                                  // the LuxDMX box and everything else: straight through
  if (own && url.pathname.endsWith('/sw.js')) return;
  // (the LuxDMX Link downloads: 3 to 7 MB each, wanted once, never offline)
  if (own && url.pathname.includes('/link/')) return;
  // Libraries are pinned to a commit: once fetched they never change, cache first.
  // The app itself: network first (so updates arrive), the cache when offline.
  e.respondWith(lib
    ? caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone())); return r; }))
    : fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })
        .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
