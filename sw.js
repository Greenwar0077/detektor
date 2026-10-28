// Service worker: przechowuje pliki aplikacji, żeby uruchamiała się bez internetu.
// Kafelki OSM i Geoportalu trafiają do osobnych pamięci (obejrzane + pobrane offline).
const CACHE = 'detektor-v16';
const TILE_CACHE = 'detektor-tiles'; // kafelki obejrzane na mapie (przycinany)
const OFFLINE_CACHE = 'detektor-offline'; // kafelki pobrane świadomie (nie przycinany)
const MAX_TILES = 4000;
const corsStats = new Map(); // host -> { ok, fail }
let puts = 0;

const tileKey = (u) => u.replace(/([?&])_r=\d+&?/, '$1').replace(/[?&]$/, '');
function isTileUrl(url) {
  if (url.hostname === 'mapy.geoportal.gov.pl') return /request=(GetMap|GetTile)/i.test(url.search);
  return url.hostname === 'tile.openstreetmap.org';
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    for (const k of keys.slice(0, keys.length - MAX_TILES + 300)) await cache.delete(k);
  }
}

// Kafelki zewnętrzne: najpierw pamięć telefonu, potem sieć. Zapisujemy tylko wtedy, gdy serwer pozwala
// odczytać odpowiedź (CORS); inaczej wpisy byłyby nieprzejrzyste i zawyżały zajęte miejsce.
async function tileResponse(req) {
  const key = tileKey(req.url);
  for (const name of [OFFLINE_CACHE, TILE_CACHE]) {
    const hit = await (await caches.open(name)).match(key, { ignoreVary: true });
    if (hit) return hit;
  }
  const host = new URL(req.url).host;
  const st = corsStats.get(host) || { ok: 0, fail: 0 };
  corsStats.set(host, st);
  if (!(st.ok === 0 && st.fail >= 6)) {
    try {
      const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
      st.ok++;
      if (res.ok) {
        const cache = await caches.open(TILE_CACHE);
        await cache.put(key, res.clone());
        if (++puts % 60 === 0) trimTiles(cache);
      }
      return res;
    } catch (e) {
      st.fail++;
    }
  }
  return fetch(req);
}

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'config.js',
  'js/app.js',
  'js/store.js',
  'js/geo.js',
  'js/data.js',
  'js/exporters.js',
  'js/wmts2180.js',
  'js/scanlayer.js',
  'js/tilequeue.js',
  'js/wms.js',
  'lib/leaflet/leaflet.js',
  'lib/leaflet/leaflet.css',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILE_CACHE && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (isTileUrl(url)) event.respondWith(tileResponse(req).catch(() => Response.error()));
    return; // pozostałe zasoby zewnętrzne: zwykła sieć
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        event.waitUntil(network);
        return hit;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    })()
  );
});
