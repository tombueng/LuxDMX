// Offline support: venues often have no internet. The app is kept here whole (every file of this
// build, fetched when it's installed), so it starts without a network; fixture definitions from the
// libraries are kept once used. Nothing here sends anything.
//
// Updates: the build writes its id below, so every new build is a new worker. The browser fetches
// it when the app looks for updates (src/pwa.ts: at the start, every half hour, when it comes back
// to the front); the new one fetches its files in the background and waits. The app tells it to
// take over at a quiet moment (nothing playing, the show saved) and reloads: never in the middle of
// a show. Closed and opened again, the app starts on the new one anyway.
//
// (the build fills these in, vite.config.ts: this build's id and its files)
const BUILD = 'dev';
const PRECACHE = [];
const PREFIX = 'luxdmx-sequencer-';
const CACHE = PREFIX + BUILD;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './luxdmx-logo.png', './favicon.png', './ofl/index.json', './qlc/index.json'];
const LIBRARIES = ['https://cdn.jsdelivr.net/gh/OpenLightingProject/', 'https://raw.githubusercontent.com/mcallegari/qlcplus/'];
// How long the network gets before the copy here is used: a venue's Wi-Fi without internet
// mustn't hold the start up for a minute
const PATIENCE_MS = 4000;

self.addEventListener('install', (e) => {
  // (each file on its own: one that's missing mustn't stop the rest from being kept)
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([...SHELL, ...PRECACHE].map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
});
self.addEventListener('activate', (e) => {
  // the older builds' copies go (only ours: the songs kept for offline have a cache of their own)
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => (k.startsWith(PREFIX) || k === 'luxdmx-sequencer-v1') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => {
  if (e.data === 'take-over') self.skipWaiting();
  else if (e.data === 'build') e.source?.postMessage({ build: BUILD });
});

// the network, given up after a while (the copy here takes over)
function network(req, ms) {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('slow')), ms);
    fetch(req).then((r) => { clearTimeout(t); ok(r); }, (err) => { clearTimeout(t); no(err); });
  });
}
// (a server that answers a missing file with its page, status 200: that page is never kept as a script)
const keep = (req, r) => {
  const page = /text\/html/.test(r.headers.get('content-type') ?? '') && !(req.mode === 'navigate' || /\.html?$|\/$/.test(new URL(req.url).pathname));
  if (r.ok && r.type !== 'opaque' && !page) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return r;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  const lib = LIBRARIES.some((p) => req.url.startsWith(p));
  if (!own && !lib) return;                                  // the LuxDMX box and everything else: straight through
  if (own && url.pathname.endsWith('/sw.js')) return;
  // (the LuxDMX Link downloads: 3 to 7 MB each, wanted once, never offline; the songs: kept by the
  // app itself, store/songCache.ts, a range request for a song is the player's)
  if (own && (url.pathname.includes('/link/') || url.pathname.includes('/songs/'))) return;
  // Libraries are pinned to a commit, a build's files have their hash in the name: once fetched they
  // never change, the copy first.
  if (lib || (own && url.pathname.includes('/assets/'))) {
    // (whatever Vary the server sent: a module script asks with an Origin the install's request didn't have)
    e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((r) => keep(req, r))));
    return;
  }
  // The rest of the app (the page, its icons, the libraries' lists): the network first, so a new
  // version shows, the copy when the network isn't there or takes too long.
  e.respondWith(network(req, PATIENCE_MS).then((r) => keep(req, r))
    .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate', ignoreVary: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
