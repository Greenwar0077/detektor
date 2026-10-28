// Detektor: mapa, GPS, znaleziska ze zdjęciami, ślady. Wszystko działa lokalnie w telefonie.
import { CONFIG } from '../config.js';
import * as store from './store.js';
import { createWmts2180Layer } from './wmts2180.js';
import { ScanLayer, fitTransform, applyT, applyInv, SM } from './scanlayer.js';
import { RetryWms, RetryXyz } from './wms.js';
import { stats as tileStats } from './tilequeue.js';
import { toPuwg1992, toDMS, fmtLL, haversine, fmtDist, bearing, pathLength } from './geo.js';
import { CATEGORIES, SOILS, catLabel, isCat } from './data.js';
import { toGeoJSON, toGPX, makeBackup, parseBackup } from './exporters.js';

const VERSION = '0.8.0';
const L = window.L;
const $ = (s, r = document) => r.querySelector(s);

/* ------------------------------------------------------------------ pomocnicze */

const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem('detektor.' + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('detektor.' + k, JSON.stringify(v));
    } catch (e) {
      /* pamięć niedostępna */
    }
  }
};

// Budowanie DOM bez innerHTML: dane użytkownika zawsze trafiają jako tekst.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'props') Object.assign(el, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  layers: '<path d="M12 3 2.5 8.2 12 13.4l9.5-5.2L12 3Z"/><path d="m2.5 12.2 9.5 5.2 9.5-5.2"/><path d="m2.5 16 9.5 5.2L21.5 16"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  list: '<path d="M8.5 6.5H21M8.5 12H21M8.5 17.5H21"/><circle cx="4" cy="6.5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17.5" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6.5 8v3M10 8v4.5M13.5 8v3M17 8v4.5"/>',
  camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10.5H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 3.5 3.5L16 13l4 4.5"/>',
  nav: '<path d="M12 3 5 20.5l7-3.5 7 3.5L12 3Z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5 15.5V6a1.5 1.5 0 0 1 1.5-1.5H15"/>',
  edit: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  warn: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  pin: '<path d="M12 21s-6.5-6.3-6.5-11a6.5 6.5 0 0 1 13 0c0 4.7-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'
};

function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

const dtf = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDateTime = (ts) => dtf.format(new Date(ts));
const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimer = 0;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

async function copyText(text, okMsg = 'Skopiowano.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (e) {
    toast(text, 6000);
  }
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/* ------------------------------------------------------------------ stan */

const S = {
  pins: new Map(),
  tracks: new Map(),
  outings: new Map(),
  places: new Map(), // miejsca (tereny) z granicą, notatką, mapami i wyjściami
  maps: new Map(), // mapy ze skanów (IndexedDB)
  aligning: null,
  outing: null, // aktywne wyjście
  filter: null, // id wyjścia pokazywanego na mapie (null = wszystko)
  markers: new Map(),
  trackLines: new Map(),
  fix: null,
  watchId: null,
  follow: false,
  gpsState: 'off',
  gpsMsg: 'GPS wyłączony. Dotknij ◎',
  rec: null,
  wake: null,
  draft: null,
  urls: [],
  picking: null,
  settings: { showTracks: LS.get('showTracks', true), keepAwake: LS.get('keepAwake', false), showPins: LS.get('showPins', true), showPlaces: LS.get('showPlaces', true), showBorders: LS.get('showBorders', true) },
  diag: {},
  warned: new Set()
};

/* ------------------------------------------------------------------ statyczny interfejs */

$('#btn-locate').append(icon('locate'));
$('#btn-layers').append(icon('layers'));
// Szybkie przełączniki na mapie: cieniowanie LiDAR i nazwy ulic
const quickDefs = [['btn-nmt', 'Cieniowanie LiDAR: włącz lub wyłącz', 'LiDAR']];
quickDefs.push(['btn-hist', 'Mapa historyczna: włącz lub wyłącz', 'Retro']);
quickDefs.push(['btn-curtain', 'Porównaj ze współczesną mapą (kurtyna)', '⇔']);
let quickAfter = $('#btn-layers');
for (const [id, label, text] of quickDefs) {
  const b = h('button', { id, class: 'round quick', type: 'button', 'aria-label': label }, h('span', null, text));
  quickAfter.after(b);
  quickAfter = b;
}
{
  const bp = h('button', { id: 'btn-places', class: 'round', type: 'button', 'aria-label': 'Miejsca (tereny do zbadania)' });
  bp.append(icon('pin'));
  $('#btn-layers').after(bp);
}
$('#btn-menu').append(icon('menu'));
{
  const bs = h('button', { id: 'btn-search', class: 'round', type: 'button', 'aria-label': 'Szukaj miejsca' });
  bs.append(icon('search'));
  bs.addEventListener('click', () => openSheet('Szukaj miejsca', searchNode()));
  $('#gps-chip').after(bs);
}
$('#sheet-close').append(icon('close'));
$('#viewer-close').append(icon('close'));
$('#btn-list').append(icon('list', 20), h('span', { id: 'lbl-list' }, 'Wyjścia'));
$('#btn-add').append(icon('plus', 24), h('span', { id: 'lbl-add' }, 'Nowe wyjście'));
$('#btn-rec').append(h('span', { class: 'rec-dot' }), h('span', { id: 'rec-label' }, 'Pauza'));

/* ------------------------------------------------------------------ mapa i warstwy */

const startView = LS.get('view', CONFIG.start);
const map = L.map('map', {
  zoomControl: false,
  center: [startView.lat, startView.lng],
  zoom: startView.zoom,
  minZoom: 4,
  maxZoom: CONFIG.maxZoom || 20
});
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

map.on('moveend', () => {
  const c = map.getCenter();
  LS.set('view', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
});
map.on('dragstart', () => {
  if (S.follow) {
    S.follow = false;
    updateLocateBtn();
  }
});
// Długie przytrzymanie mapy (na komputerze prawy przycisk): menu z dodaniem miejsca lub znaleziska.
map.on('contextmenu', (e) => showMapMenu(e.latlng));

// Cieniowanie LiDAR na dowolnym podkładzie: osobny wariant podkładu, który sam miksuje
// kafelki (nie wymaga mix-blend-mode, działa w każdej przeglądarce).
const NMT_DEF = CONFIG.base.find((d) => d.id === 'nmt-base');
const compositeDefs = NMT_DEF
  ? CONFIG.base
      .filter((b) => b.id !== 'nmt-base' && (b.type === 'xyz' || b.type === 'wms' || b.type === 'wmts2180'))
      .map((b) => ({
        ...NMT_DEF,
        id: b.id + '-nmt',
        kind: 'base',
        name: b.name + ' + LiDAR',
        under:
          b.type === 'xyz'
            ? { type: 'xyz', url: b.url }
            : b.type === 'wmts2180'
              ? { type: 'wmts2180', def: b }
              : { type: 'wms', url: b.url, layers: b.layers, format: b.format },
        shadeAlpha: b.type === 'xyz' ? 0.7 : 0.8,
        attribution: [b.attribution, NMT_DEF.attribution].filter(Boolean).join(', ')
      }))
  : [];
const ALL_DEFS = [
  ...CONFIG.base.map((d) => ({ ...d, kind: 'base' })),
  ...compositeDefs,
  ...CONFIG.overlays.map((d) => ({ ...d, kind: 'overlay' })),
  ...(CONFIG.historical || []).map((d) => ({ ...d, kind: 'hist' }))
];
const layerObjs = new Map();
const layerState = (() => {
  const s = LS.get('layers', {}) || {};
  const st = {
    base: CONFIG.base.some((b) => b.id === s.base) ? s.base : CONFIG.base[0].id,
    last: CONFIG.base.some((b) => b.id === s.last && b.id !== 'nmt-base') ? s.last : 'orto',
    nmt: !!s.nmt,
    nmtAlpha: Number.isFinite(s.nmtMix) ? Math.min(1, Math.max(0, s.nmtMix)) : 0.5,
    names: !!s.names,
    hist: s.hist && typeof s.hist === 'object' ? s.hist : {},
    histLast: typeof s.histLast === 'string' ? s.histLast : null,
    curtain: !!s.curtain,
    curtainX: Number.isFinite(s.curtainX) ? Math.min(0.9, Math.max(0.1, s.curtainX)) : 0.5,
    opacity: s.opacity && typeof s.opacity === 'object' ? s.opacity : {}
  };
  if (st.base !== 'nmt-base') st.last = st.base;
  return st;
})();

function effectiveBase() {
  if (layerState.base === 'nmt-base' || !layerState.nmt) return layerState.base;
  const comb = layerState.base + '-nmt';
  return ALL_DEFS.some((d) => d.id === comb) ? comb : layerState.base;
}

function makeLayer(def) {
  const o = {
    attribution: def.attribution,
    maxZoom: def.maxZoom || CONFIG.maxZoom || 20,
    opacity: layerState.opacity[def.id] ?? def.opacity ?? 1,
    zIndex: def.kind === 'base' ? 1 : def.kind === 'hist' ? 5 : 10
  };
  if (def.maxNativeZoom) o.maxNativeZoom = def.maxNativeZoom;
  if (def.minZoom) o.minZoom = def.minZoom;
  let layer;
  if (def.type === 'wmts2180') {
    layer = createWmts2180Layer(def.under ? { ...def, shadeAlpha: layerState.nmtAlpha } : def, o);
  } else if (def.type === 'wms') {
    const w = {
      ...o,
      layers: def.layers,
      styles: def.styles || '',
      format: def.format || 'image/png',
      transparent: !!def.transparent,
      version: def.version || '1.1.1'
    };
    // Część usług Geoportalu (np. NMT) nie zna EPSG:3857: pytamy je w EPSG:4326.
    if (def.crs === '4326') w.crs = L.CRS.EPSG4326;
    layer = new RetryWms(def.url, w);
  } else if (def.type === 'scan') {
    const r = def.rec;
    layer = new ScanLayer(URL.createObjectURL(r.blob), mapTransform(r), r.w, r.h, o);
  } else if (def.type === 'image') {
    layer = L.imageOverlay(def.url, def.bounds, o);
  } else {
    layer = new RetryXyz(def.url, { ...o, tms: !!def.tms, bounds: def.bounds });
  }
  S.diag[def.id] = { ok: 0, err: 0 };
  if (def.type !== 'image' && def.type !== 'scan') {
    layer.on('tileload', () => {
      S.diag[def.id].ok++;
    });
    layer.on('tileerror', () => {
      const d = S.diag[def.id];
      d.err++;
      if (def.kind !== 'hist' && d.ok === 0 && d.err >= 4 && navigator.onLine !== false && !S.warned.has(def.id)) {
        S.warned.add(def.id);
        toast(`Warstwa „${def.name}” się nie ładuje. Sprawdź internet albo adres usługi (Dane → Diagnostyka).`, 6000);
      }
    });
  }
  return layer;
}

function getLayer(def) {
  if (!layerObjs.has(def.id)) layerObjs.set(def.id, makeLayer(def));
  return layerObjs.get(def.id);
}

function applyLayers() {
  for (const def of ALL_DEFS) {
    const want =
      def.kind === 'base'
        ? effectiveBase() === def.id
        : def.kind === 'overlay'
          ? layerState.names
          : !!layerState.hist[def.id];
    const existing = layerObjs.get(def.id);
    if (want) {
      const l = getLayer(def);
      if (!map.hasLayer(l)) l.addTo(map);
    } else if (existing && map.hasLayer(existing)) {
      map.removeLayer(existing);
    }
  }
  layerState.nmtMix = layerState.nmtAlpha;
  LS.set('layers', layerState);
  updateQuick();
  updateCurtain();
}

/* ------------------------------------------------------------------ znaczniki i ślady na mapie */

const pinsGroup = L.layerGroup();
if (S.settings.showPins) pinsGroup.addTo(map);
const tracksGroup = L.layerGroup();
if (S.settings.showTracks) tracksGroup.addTo(map);

function pinIcon(p) {
  const hz = !!p.hazard;
  const inner = hz
    ? '<text class="bang" x="14" y="18">!</text>'
    : '<circle class="dot" cx="14" cy="13.5" r="4"/>';
  return L.divIcon({
    className: 'pin-wrap',
    iconSize: [28, 36],
    iconAnchor: [14, 35],
    html: `<svg class="pin${hz ? ' hazard' : ''}" viewBox="0 0 28 36" aria-hidden="true"><path class="body" d="M14 34.5S2.5 21.5 2.5 13.5a11.5 11.5 0 0 1 23 0C25.5 21.5 14 34.5 14 34.5Z"/>${inner}</svg>`
  });
}

const inFilter = (o) => !S.filter || o.outing === S.filter;

function renderPin(p) {
  const old = S.markers.get(p.id);
  if (old) pinsGroup.removeLayer(old);
  if (!inFilter(p)) {
    S.markers.delete(p.id);
    return;
  }
  const m = L.marker([p.lat, p.lng], {
    icon: pinIcon(p),
    title: catLabel(p.cat),
    alt: catLabel(p.cat),
    riseOnHover: true
  });
  m.on('click', () => openDetail(p.id));
  m.addTo(pinsGroup);
  S.markers.set(p.id, m);
}

function renderTrack(t) {
  const old = S.trackLines.get(t.id);
  if (old) tracksGroup.removeLayer(old);
  S.trackLines.delete(t.id);
  if (!t.pts || t.pts.length < 2 || !inFilter(t)) return;
  const line = L.polyline(
    t.pts.map((q) => [q[0], q[1]]),
    { color: '#e8832a', weight: 4, opacity: 0.9, lineJoin: 'round' }
  );
  line.bindTooltip(t.name, { sticky: true });
  line.addTo(tracksGroup);
  S.trackLines.set(t.id, line);
}

/* ------------------------------------------------------------------ GPS */

const gpsAcc = L.circle([0, 0], { radius: 1, color: '#2f7de1', weight: 1, fillOpacity: 0.12, interactive: false });
const gpsDot = L.circleMarker([0, 0], {
  radius: 8,
  color: '#ffffff',
  weight: 3,
  fillColor: '#2f7de1',
  fillOpacity: 1,
  interactive: false
});

function setGps(state, msg) {
  S.gpsState = state;
  S.gpsMsg = msg;
  updateChip();
}

function updateChip() {
  const chip = $('#gps-chip');
  const f = S.fix;
  let state = S.gpsState;
  let text = S.gpsMsg;
  if (state === 'ok' && f) {
    if (Date.now() - f.ts > 30000) {
      state = 'wait';
      text = 'Brak sygnału GPS…';
    } else {
      state = f.acc <= 25 ? 'ok' : 'weak';
      text = `GPS ±${Math.round(f.acc)} m`;
    }
  }
  chip.dataset.state = state;
  $('#gps-text').textContent = text;
  const c = $('#gps-coords');
  if (f && (state === 'ok' || state === 'weak')) {
    c.hidden = false;
    c.textContent = fmtLL(f.lat, f.lng);
  } else {
    c.hidden = true;
  }
}

function updateLocateBtn() {
  $('#btn-locate').classList.toggle('active', S.follow);
}

function startGps() {
  if (!('geolocation' in navigator)) {
    setGps('err', 'Ta przeglądarka nie ma GPS');
    return;
  }
  if (S.watchId != null) return;
  setGps('wait', 'Szukam GPS…');
  S.watchId = navigator.geolocation.watchPosition(onFix, onGpsError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 25000
  });
}

function onFix(pos) {
  const c = pos.coords;
  S.fix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy ?? 9999, ts: pos.timestamp || Date.now() };
  S.gpsState = 'ok';
  if (typeof updateNav === 'function') updateNav();
  const ll = [S.fix.lat, S.fix.lng];
  if (!map.hasLayer(gpsAcc)) {
    gpsAcc.addTo(map);
    gpsDot.addTo(map);
  }
  gpsAcc.setLatLng(ll).setRadius(Math.max(S.fix.acc, 1));
  gpsDot.setLatLng(ll);
  updateChip();
  if (S.follow) map.setView(ll, Math.max(map.getZoom(), 17), { animate: true });
  if (S.rec) recordPoint();
}

function onGpsError(err) {
  if (err.code === 1) {
    if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId);
    S.watchId = null;
    setGps('err', 'Brak zgody na lokalizację. Włącz ją w ustawieniach witryny.');
  } else if (err.code === 2) {
    setGps('err', 'Pozycja niedostępna (brak sygnału GPS)');
  } else {
    setGps('wait', 'Szukam GPS…');
  }
}

function onLocate() {
  S.follow = true;
  updateLocateBtn();
  if (S.watchId == null) startGps();
  else if (S.fix) map.setView([S.fix.lat, S.fix.lng], Math.max(map.getZoom(), 17), { animate: true });
}

function onChip() {
  if (S.fix && Date.now() - S.fix.ts < 30000) copyText(fmtLL(S.fix.lat, S.fix.lng), 'Skopiowano współrzędne.');
  else onLocate();
}

async function acquireWake() {
  try {
    if ('wakeLock' in navigator && !S.wake) {
      S.wake = await navigator.wakeLock.request('screen');
      S.wake.addEventListener('release', () => {
        S.wake = null;
      });
    }
  } catch (e) {
    /* odrzucone: trudno */
  }
}
function releaseWake() {
  if (S.wake && !S.settings.keepAwake && !S.rec) {
    S.wake.release().catch(() => {});
    S.wake = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (S.rec || S.settings.keepAwake)) acquireWake();
  updateChip();
});

/* ------------------------------------------------------------------ wyjścia i nagrywanie śladu */

const outingTracks = (id) => [...S.tracks.values()].filter((t) => t.outing === id);
const outingPins = (id) => [...S.pins.values()].filter((p) => p.outing === id);
function outingDist(o) {
  let d = outingTracks(o.id).reduce((n, t) => n + (t.dist || 0), 0);
  if (S.rec && S.rec.t.outing === o.id) d += S.rec.t.dist;
  return d;
}
function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

// Dolny pasek zależy od tego, czy trwa wyjście.
function updateBar() {
  const o = S.outing;
  const rec = $('#btn-rec');
  $('#lbl-list').textContent = o ? `${outingPins(o.id).length} zn.` : 'Wyjścia';
  $('#btn-list').setAttribute('aria-label', o ? `Bieżące wyjście: ${outingPins(o.id).length} znalezisk` : 'Biblioteka wyjść');
  $('#lbl-add').textContent = o ? 'Znalezisko' : 'Nowe wyjście';
  $('#btn-list').classList.toggle('active', !!o);
  const showRec = !!(o && S.rec);
  const paused = !!(S.rec && S.rec.paused);
  rec.classList.toggle('ghost', !showRec);
  rec.classList.toggle('recording', showRec && !paused);
  rec.tabIndex = showRec ? 0 : -1;
  rec.setAttribute('aria-hidden', String(!showRec));
  rec.setAttribute('aria-label', paused ? 'Wznów nagrywanie trasy' : 'Wstrzymaj nagrywanie trasy');
  $('#rec-label').textContent = showRec ? (paused ? 'Wznów' : fmtDist(S.rec.t.dist)) : 'Pauza';
}

function startRec(o, resume) {
  startGps();
  const t = resume || { id: store.uid(), outing: o.id, name: o.name, start: Date.now(), end: null, pts: [], dist: 0, open: true };
  S.rec = {
    t,
    line: L.polyline(
      t.pts.map((q) => [q[0], q[1]]),
      { color: '#e8832a', weight: 4, opacity: 0.95 }
    ).addTo(map),
    lastSaved: t.pts.length,
    paused: false,
    gap: !!resume // po wznowieniu nie doliczamy skoku do pierwszego nowego punktu
  };
  acquireWake();
}

function recordPoint() {
  if (S.rec.paused) return;
  const f = S.fix;
  const t = S.rec.t;
  if (!f || f.acc > 40) return;
  const last = t.pts[t.pts.length - 1];
  if (last) {
    const d = haversine(last[0], last[1], f.lat, f.lng);
    if (d < 3) return;
    if (!S.rec.gap) t.dist += d;
  }
  S.rec.gap = false;
  t.pts.push([f.lat, f.lng, f.ts, Math.round(f.acc)]);
  S.rec.line.addLatLng([f.lat, f.lng]);
  updateBar();
  if (t.pts.length - S.rec.lastSaved >= 15) {
    S.rec.lastSaved = t.pts.length;
    store.put('tracks', t).catch(() => {});
  }
}

function togglePause() {
  if (!S.rec) return;
  S.rec.paused = !S.rec.paused;
  if (S.rec.paused) store.put('tracks', S.rec.t).catch(() => {});
  else S.rec.gap = true;
  updateBar();
  toast(S.rec.paused ? 'Trasa wstrzymana. Znaleziska nadal możesz dodawać.' : 'Wznowiono nagrywanie trasy.');
}

async function stopRec() {
  const { t, line } = S.rec;
  S.rec = null;
  map.removeLayer(line);
  releaseWake();
  t.end = Date.now();
  t.open = false;
  if (t.pts.length >= 2) {
    try {
      await store.put('tracks', t);
    } catch (e) {
      toast('Nie udało się zapisać trasy.', 5000);
    }
    S.tracks.set(t.id, t);
    renderTrack(t);
  } else {
    store.del('tracks', t.id).catch(() => {});
  }
}

function defaultOutingName(ts) {
  const d = new Date(ts);
  const base = `Wyjście ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  const names = new Set([...S.outings.values()].map((o) => o.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
  return base;
}

async function startOuting(name, track) {
  const ts = Date.now();
  const o = { id: store.uid(), name: name.trim() || defaultOutingName(ts), start: ts, end: null, open: true, track, note: '' };
  const here = S.fix ? placeAt(S.fix.lat, S.fix.lng) : null;
  if (here) o.place = here.id;
  try {
    await store.put('outings', o);
  } catch (e) {
    toast('Nie udało się zapisać wyjścia.', 5000);
    return;
  }
  S.outings.set(o.id, o);
  S.outing = o;
  LS.set('activeOuting', o.id);
  LS.set('trackDefault', track);
  if (S.filter) applyFilter(null);
  startGps();
  if (track) startRec(o);
  updateBar();
  closeSheet();
  toast(track ? 'Wyjście rozpoczęte, nagrywam trasę. Trzymaj ekran włączony.' : 'Wyjście rozpoczęte.', 4500);
}

async function endOuting() {
  const o = S.outing;
  if (!o) return;
  if (S.rec) await stopRec();
  o.end = Date.now();
  o.open = false;
  S.outing = null;
  LS.set('activeOuting', null);
  await store.put('outings', o).catch(() => toast('Nie udało się zapisać wyjścia.', 5000));
  updateBar();
  const dist = outingDist(o);
  toast(`Zakończono „${o.name}”: ${outingPins(o.id).length} znalezisk${dist > 0 ? `, ${fmtDist(dist)}` : ''}.`, 5000);
}

// Znalezisko dodane poza wyjściem trafia do „szybkiego wyjścia” z danego dnia.
async function quickOuting(ts) {
  const day = new Date(ts).toDateString();
  let o = [...S.outings.values()].find((x) => x.quick && new Date(x.start).toDateString() === day);
  if (!o) {
    const d = new Date(ts);
    o = {
      id: store.uid(),
      name: `Szybkie znaleziska ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`,
      start: ts,
      end: ts,
      open: false,
      track: false,
      quick: true,
      note: ''
    };
    await store.put('outings', o);
    S.outings.set(o.id, o);
  }
  return o.id;
}

// Dane bez przypisanego wyjścia (starsze wersje, import starej kopii) trafiają do jednego wyjścia zbiorczego.
async function adoptOrphans() {
  const pins = [...S.pins.values()].filter((p) => !p.outing);
  const tracks = [...S.tracks.values()].filter((t) => !t.outing);
  if (!pins.length && !tracks.length) return;
  const times = [...pins.map((p) => p.ts), ...tracks.map((t) => t.start)];
  let o = [...S.outings.values()].find((x) => x.legacy);
  if (!o) {
    o = { id: store.uid(), name: 'Wcześniejsze dane', start: Math.min(...times), end: Math.max(...times), open: false, track: false, legacy: true, note: '' };
  } else {
    o.start = Math.min(o.start, ...times);
    o.end = Math.max(o.end || 0, ...times);
  }
  await store.put('outings', o);
  S.outings.set(o.id, o);
  for (const p of pins) {
    p.outing = o.id;
    await store.put('pins', p);
  }
  for (const t of tracks) {
    t.outing = o.id;
    await store.put('tracks', t);
  }
}

function applyFilter(id) {
  const o = id ? S.outings.get(id) : null;
  S.filter = o ? o.id : null;
  $('#filterbar').hidden = !o;
  if (o) $('#filter-text').textContent = `Tylko: ${o.name}`;
  for (const p of S.pins.values()) renderPin(p);
  for (const t of S.tracks.values()) renderTrack(t);
}

/* ------------------------------------------------------------------ arkusze (dolne panele) */

const sheetEl = $('#sheet');
const sheetBody = $('#sheet-body');
const sheetTitle = $('#sheet-title');
const backdrop = $('#backdrop');
let sheetOpen = false;

function releaseUrls() {
  for (const u of S.urls) URL.revokeObjectURL(u);
  S.urls = [];
}
function trackUrl(blob) {
  const u = URL.createObjectURL(blob);
  S.urls.push(u);
  return u;
}

// Zwijana sekcja (drzewko): tytuł + krótka wartość w wierszu, treść po rozwinięciu. Stan zapamiętany.
const foldState = new Map();
function fold(key, title, value, ...kids) {
  const fv = h('span', { class: 'fv' }, value || '');
  const d = h(
    'details',
    {
      class: 'fold',
      props: { open: !!foldState.get(key) },
      onToggle: () => foldState.set(key, d.open)
    },
    h('summary', null, h('span', null, title), fv),
    h('div', { class: 'fold-body' }, kids)
  );
  d.fv = fv;
  return d;
}

function openSheet(title, nodes, keepScroll = false, extra = null) {
  const top = keepScroll ? sheetBody.scrollTop : 0;
  releaseUrls();
  sheetTitle.textContent = title;
  $('#sheet-extra').replaceChildren(...(extra ? [extra] : []));
  sheetBody.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
  sheetBody.scrollTop = top;
  sheetEl.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add('sheet-open');
  if (!sheetOpen) {
    history.pushState({ sheet: 1 }, '');
    sheetOpen = true;
  }
}

function hideSheet() {
  const d = S.draft;
  if (d && d.isNew && !d.saved && (d.add.length || d.notes.trim())) toast('Niezapisane znalezisko odrzucono.', 3500);
  sheetEl.hidden = true;
  backdrop.hidden = true;
  document.body.classList.remove('sheet-open');
  sheetOpen = false;
  releaseUrls();
  cleanupDraft();
  dropDraw();
  sheetBody.replaceChildren();
}

function closeSheet() {
  if (sheetOpen) history.back();
  else hideSheet();
}

$('#sheet-close').addEventListener('click', closeSheet);
for (const ev of ['input', 'change', 'click']) sheetBody.addEventListener(ev, () => saveDraftSoon());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveDraftNow();
});
window.addEventListener('pagehide', saveDraftNow);
backdrop.addEventListener('click', closeSheet);

function openViewer(url) {
  $('#viewer-img').src = url;
  $('#viewer').hidden = false;
  history.pushState({ viewer: 1 }, '');
}
function closeViewer() {
  $('#viewer').hidden = true;
  $('#viewer-img').removeAttribute('src');
}
$('#viewer-close').addEventListener('click', () => history.back());
$('#viewer').addEventListener('click', (e) => {
  if (e.target.id === 'viewer') history.back();
});

window.addEventListener('popstate', () => {
  if (cam) {
    closeCamera();
    return;
  }
  if (S.aligning) {
    endAlign();
    return;
  }
  if (S.picking) {
    endPick(S.picking.result);
    return;
  }
  if (!$('#viewer').hidden) {
    closeViewer();
    return;
  }
  if (sheetOpen) hideSheet();
});

/* ------------------------------------------------------------------ wybór miejsca na mapie */

function pickOnMap(startAt) {
  return new Promise((resolve) => {
    S.picking = { resolve, result: null };
    document.body.classList.add('picking');
    $('#crosshair').hidden = false;
    $('#pickbar').hidden = false;
    sheetEl.hidden = true;
    backdrop.hidden = true;
    if (startAt) map.setView(startAt, Math.max(map.getZoom(), 17));
    history.pushState({ pick: 1 }, '');
  });
}

function endPick(center) {
  const p = S.picking;
  if (!p) return;
  S.picking = null;
  document.body.classList.remove('picking');
  $('#crosshair').hidden = true;
  $('#pickbar').hidden = true;
  sheetEl.hidden = false;
  backdrop.hidden = false;
  p.resolve(center);
}

$('#pick-ok').addEventListener('click', () => {
  if (!S.picking) return;
  S.picking.result = map.getCenter();
  history.back();
});
$('#pick-cancel').addEventListener('click', () => history.back());

/* ------------------------------------------------------------------ zdjęcia */

async function resizeImage(file, max = 1600, quality = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bmp.width || bmp.naturalWidth;
  const hh = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, max / Math.max(w, hh));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(hh * k));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  c.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', quality));
}

/* ------------------------------------------------------------------ formularz znaleziska */

// Autozapis niedokończonego znaleziska: Android potrafi odświeżyć stronę, gdy w tle działa aparat.
let draftTimer = 0;
function saveDraftNow() {
  const d = S.draft;
  if (!d || !d.isNew || d.saved) return;
  LS.set('draft', {
    id: d.id,
    loc: d.loc,
    ts: d.ts,
    cat: d.cat,
    hazard: d.hazard,
    depth: d.depth,
    soil: d.soil,
    signal: d.signal,
    notes: d.notes,
    photos: d.add.map((a) => a.id)
  });
}
function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 350);
}

function cleanupDraft() {
  const d = S.draft;
  if (!d) return;
  clearTimeout(draftTimer);
  if (!d.saved) {
    // porzucony szkic: usuwamy jego zdjęcia z pamięci i zapis szkicu
    for (const a of d.add) store.del('photos', a.id).catch(() => {});
    if (d.isNew) LS.set('draft', null);
  }
  for (const u of d.urls.values()) URL.revokeObjectURL(u);
  for (const a of d.add) URL.revokeObjectURL(a.url);
  S.draft = null;
}

async function openForm(pin, preset) {
  let loc;
  if (pin) loc = { lat: pin.lat, lng: pin.lng, acc: pin.acc ?? null, src: pin.src };
  else if (preset) loc = preset;
  else if (S.fix) loc = { lat: S.fix.lat, lng: S.fix.lng, acc: S.fix.acc, src: 'gps' };
  else {
    const c = map.getCenter();
    loc = { lat: c.lat, lng: c.lng, acc: null, src: 'map' };
  }
  cleanupDraft();
  const d = {
    isNew: !pin,
    outing: pin ? pin.outing || null : null,
    id: pin ? pin.id : store.uid(),
    loc,
    ts: pin ? pin.ts : Date.now(),
    cat: pin ? pin.cat : LS.get('lastCat', 'coin'),
    hazard: !!(pin && pin.hazard),
    depth: pin && pin.depth != null ? String(pin.depth) : '',
    soil: pin ? pin.soil || '' : '',
    signal: pin ? pin.signal || '' : '',
    notes: pin ? pin.notes || '' : '',
    keep: pin ? [...(pin.photos || [])] : [],
    removed: new Set(),
    urls: new Map(),
    add: [],
    busy: 0,
    ui: {}
  };
  S.draft = d;
  renderForm();
  if (pin) {
    for (const id of [...d.keep]) {
      const ph = await store.get('photos', id);
      if (S.draft !== d) return;
      if (ph) d.urls.set(id, URL.createObjectURL(ph.blob));
      else d.keep = d.keep.filter((x) => x !== id);
    }
    renderThumbs();
  }
}

async function restoreDraft(sv) {
  const d = {
    isNew: true,
    id: typeof sv.id === 'string' ? sv.id : store.uid(),
    loc: sv.loc && Number.isFinite(sv.loc.lat) && Number.isFinite(sv.loc.lng) ? sv.loc : null,
    ts: Number.isFinite(sv.ts) ? sv.ts : Date.now(),
    cat: isCat(sv.cat) ? sv.cat : 'other',
    hazard: !!sv.hazard,
    depth: String(sv.depth ?? ''),
    soil: String(sv.soil ?? ''),
    signal: String(sv.signal ?? ''),
    notes: String(sv.notes ?? ''),
    keep: [],
    removed: new Set(),
    urls: new Map(),
    add: [],
    busy: 0,
    ui: {}
  };
  if (!d.loc) return false;
  for (const id of Array.isArray(sv.photos) ? sv.photos : []) {
    const ph = await store.get('photos', id);
    if (ph) d.add.push({ id, blob: ph.blob, url: URL.createObjectURL(ph.blob) });
  }
  cleanupDraft();
  S.draft = d;
  renderForm();
  return true;
}

function srcLabel(l) {
  if (l.src === 'gps') return `GPS${l.acc != null ? ` ±${Math.round(l.acc)} m` : ''}`;
  if (l.src === 'pick') return 'Wskazane na mapie';
  return 'Środek mapy';
}

function renderLoc() {
  const d = S.draft;
  if (!d) return;
  saveDraftSoon();
  const l = d.loc;
  const pg = toPuwg1992(l.lat, l.lng);
  d.ui.loc.replaceChildren(
    h('div', { class: 'big' }, fmtLL(l.lat, l.lng)),
    h('div', { class: 'small' }, srcLabel(l)),
    h('div', { class: 'small' }, `PL-1992  X ${pg.x.toFixed(0)}  Y ${pg.y.toFixed(0)}`)
  );
}

function renderThumbs() {
  const d = S.draft;
  if (!d || !d.ui.thumbs) return;
  const nodes = [];
  for (const id of d.keep) {
    const url = d.urls.get(id);
    if (!url) continue;
    nodes.push(
      h(
        'div',
        { class: 'thumb' },
        h('img', { src: url, alt: 'Zdjęcie znaleziska' }),
        h(
          'button',
          {
            class: 'x',
            type: 'button',
            'aria-label': 'Usuń zdjęcie',
            onClick: () => {
              d.keep = d.keep.filter((x) => x !== id);
              d.removed.add(id);
              URL.revokeObjectURL(url);
              d.urls.delete(id);
              renderThumbs();
            }
          },
          icon('close', 16)
        )
      )
    );
  }
  for (const a of d.add) {
    nodes.push(
      h(
        'div',
        { class: 'thumb' },
        h('img', { src: a.url, alt: 'Nowe zdjęcie' }),
        h(
          'button',
          {
            class: 'x',
            type: 'button',
            'aria-label': 'Usuń zdjęcie',
            onClick: () => {
              d.add = d.add.filter((x) => x !== a);
              URL.revokeObjectURL(a.url);
              store.del('photos', a.id).catch(() => {});
              saveDraftSoon();
              renderThumbs();
            }
          },
          icon('close', 16)
        )
      )
    );
  }
  d.ui.thumbs.replaceChildren(...nodes);
  d.ui.thumbs.hidden = nodes.length === 0;
}

function refreshSave() {
  const d = S.draft;
  if (!d || !d.ui.save) return;
  d.ui.save.disabled = d.busy > 0;
  d.ui.save.textContent = d.busy > 0 ? 'Przetwarzam zdjęcie…' : d.isNew ? 'Zapisz znalezisko' : 'Zapisz zmiany';
}

async function addPhotoBlob(blob) {
  const d = S.draft;
  if (!d) return false;
  if (d.keep.length + d.add.length >= 12) {
    toast('Maksymalnie 12 zdjęć przy jednym znalezisku.');
    return false;
  }
  const a = { id: store.uid(), blob, url: URL.createObjectURL(blob) };
  d.add.push(a);
  // zdjęcie od razu do pamięci telefonu: przeżyje odświeżenie strony
  try {
    await store.put('photos', { id: a.id, blob, ts: Date.now() });
  } catch (e) {
    /* zapis nastąpi przy zapisie znaleziska */
  }
  renderThumbs();
  saveDraftSoon();
  return true;
}

async function addPhotos(files) {
  const d = S.draft;
  if (!d) return;
  for (const f of files) {
    d.busy++;
    refreshSave();
    try {
      const blob = await resizeImage(f);
      if (S.draft !== d) return;
      if (!(await addPhotoBlob(blob))) break;
    } catch (e) {
      toast('Nie udało się przetworzyć zdjęcia.');
    } finally {
      d.busy--;
      refreshSave();
    }
  }
}

/* ------------------------------------------------------------------ aparat w aplikacji */

let cam = null;

async function openCamera(fallbackInput) {
  if (cam || !S.draft) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    fallbackInput.click();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      audio: false
    });
  } catch (e) {
    toast('Brak dostępu do aparatu. Użyj „Z galerii” albo zezwól na aparat w ustawieniach witryny.', 5000);
    return;
  }
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  video.srcObject = stream;
  const count = h('span', { class: 'cam-count' }, '');
  const shutter = h(
    'button',
    {
      type: 'button',
      class: 'shutter',
      'aria-label': 'Zrób zdjęcie',
      onClick: async () => {
        if (!video.videoWidth) return;
        const k = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(video.videoWidth * k);
        c.height = Math.round(video.videoHeight * k);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
        if (!blob) return;
        flash.classList.remove('go');
        void flash.offsetWidth;
        flash.classList.add('go');
        const ok = await addPhotoBlob(blob);
        const n = S.draft ? S.draft.add.length : 0;
        count.textContent = n ? `Zdjęć: ${n}` : '';
        if (!ok) history.back();
      }
    },
    h('i')
  );
  const flash = h('div', { class: 'cam-flash' });
  const done = h('button', { type: 'button', class: 'btn primary', onClick: () => history.back() }, 'Gotowe');
  const el = h('div', { id: 'camera', class: 'camera' }, video, flash, h('div', { class: 'cam-bar' }, count, shutter, done));
  document.body.append(el);
  cam = { el, stream };
  history.pushState({ cam: 1 }, '');
}

function closeCamera() {
  if (!cam) return;
  for (const t of cam.stream.getTracks()) t.stop();
  cam.el.remove();
  cam = null;
}

function renderForm() {
  const d = S.draft;

  const locBox = h('div', { class: 'locbox' });
  d.ui.loc = locBox;

  const catBtns = CATEGORIES.map((c) =>
    h(
      'button',
      {
        type: 'button',
        class: 'opt',
        'aria-pressed': String(d.cat === c.id),
        onClick: () => {
          d.cat = c.id;
          catBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(CATEGORIES[i].id === d.cat)));
        }
      },
      c.label
    )
  );

  const hazBtn = h(
    'button',
    {
      type: 'button',
      class: 'opt dangerous',
      'aria-pressed': String(d.hazard),
      onClick: () => {
        d.hazard = !d.hazard;
        hazBtn.setAttribute('aria-pressed', String(d.hazard));
        hazBtn.textContent = d.hazard ? 'Tak' : 'Nie';
      }
    },
    d.hazard ? 'Tak' : 'Nie'
  );

  const soilOptions = [...SOILS];
  if (d.soil && !soilOptions.includes(d.soil)) soilOptions.push(d.soil);
  const soilSel = h(
    'select',
    {
      id: 'f-soil',
      onChange: (e) => {
        d.soil = e.target.value;
      }
    },
    h('option', { value: '' }, '—'),
    soilOptions.map((s) => h('option', { value: s }, s))
  );
  soilSel.value = d.soil;

  const thumbs = h('div', { class: 'thumbs', hidden: true });
  d.ui.thumbs = thumbs;

  const camInput = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    hidden: true,
    onChange: (e) => {
      addPhotos([...e.target.files]);
      e.target.value = '';
    }
  });
  const galInput = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    onChange: (e) => {
      addPhotos([...e.target.files]);
      e.target.value = '';
    }
  });

  const saveBtn = h('button', { type: 'button', class: 'btn primary block', onClick: savePin }, '');
  d.ui.save = saveBtn;

  openSheet(d.isNew ? 'Nowe znalezisko' : 'Edycja znaleziska', [
    h(
      'div',
      { class: 'section' },
      h('h3', null, 'Położenie'),
      locBox,
      h(
        'div',
        { class: 'row-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () => {
              if (!S.fix) {
                startGps();
                toast('Włączam GPS. Spróbuj za chwilę.');
                return;
              }
              d.loc = { lat: S.fix.lat, lng: S.fix.lng, acc: S.fix.acc, src: 'gps' };
              renderLoc();
            }
          },
          icon('locate', 18),
          'Użyj GPS'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: async () => {
              const c = await pickOnMap([d.loc.lat, d.loc.lng]);
              if (c && S.draft === d) {
                d.loc = { lat: c.lat, lng: c.lng, acc: null, src: 'pick' };
              }
              renderLoc();
            }
          },
          icon('pin', 18),
          'Wskaż na mapie'
        )
      )
    ),
    h(
      'div',
      { class: 'section' },
      h('h3', null, 'Co to jest'),
      h('div', { class: 'opts', role: 'group', 'aria-label': 'Kategoria' }, catBtns),
      h(
        'div',
        { class: 'switch' },
        h('span', null, 'Niebezpieczne (nie ruszać)'),
        hazBtn
      )
    ),
    h(
      'div',
      { class: 'section' },
      h('h3', null, 'Szczegóły'),
      h(
        'div',
        { class: 'two' },
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'f-depth' }, 'Głębokość (cm)'),
          h('input', {
            id: 'f-depth',
            type: 'number',
            inputmode: 'numeric',
            min: '0',
            max: '300',
            onInput: (e) => {
              d.depth = e.target.value;
            },
            props: { value: d.depth }
          })
        ),
        h('div', { class: 'field' }, h('label', { for: 'f-soil' }, 'Podłoże'), soilSel)
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'f-signal' }, 'Sygnał wykrywacza (np. VDI 78 / Fe 41)'),
        h('input', {
          id: 'f-signal',
          type: 'text',
          maxlength: '60',
          autocomplete: 'off',
          onInput: (e) => {
            d.signal = e.target.value;
          },
          props: { value: d.signal }
        })
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'f-notes' }, 'Opis i notatki'),
        h('textarea', {
          id: 'f-notes',
          maxlength: '2000',
          onInput: (e) => {
            d.notes = e.target.value;
          },
          props: { value: d.notes }
        })
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'f-time' }, 'Data i godzina'),
        h('input', {
          id: 'f-time',
          type: 'datetime-local',
          onChange: (e) => {
            const t = new Date(e.target.value).getTime();
            if (Number.isFinite(t)) d.ts = t;
          },
          props: { value: toLocalInput(d.ts) }
        })
      )
    ),
    h(
      'div',
      { class: 'section' },
      h('h3', null, 'Zdjęcia'),
      h('p', { class: 'hint' }, 'Najlepiej z kilku stron, z linijką obok. Ułatwia to datowanie.'),
      thumbs,
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn', onClick: () => openCamera(camInput) }, icon('camera', 18), 'Zrób zdjęcie'),
        h('button', { type: 'button', class: 'btn', onClick: () => galInput.click() }, icon('image', 18), 'Z galerii'),
        camInput,
        galInput
      )
    ),
    h('div', { class: 'section' }, saveBtn)
  ]);
  renderLoc();
  renderThumbs();
  refreshSave();
}

async function savePin() {
  const d = S.draft;
  if (!d || d.busy) return;
  const depthNum = d.depth === '' ? null : Number(String(d.depth).replace(',', '.'));
  const p = {
    id: d.id,
    lat: d.loc.lat,
    lng: d.loc.lng,
    acc: d.loc.acc != null ? Math.round(d.loc.acc) : null,
    src: d.loc.src,
    ts: d.ts,
    cat: d.cat,
    depth: Number.isFinite(depthNum) && depthNum >= 0 ? Math.round(depthNum) : null,
    soil: d.soil,
    signal: d.signal.trim(),
    notes: d.notes.trim(),
    hazard: d.hazard,
    photos: [...d.keep, ...d.add.map((a) => a.id)],
    outing: null,
    updated: Date.now()
  };
  try {
    p.outing = d.outing || (S.outing ? S.outing.id : await quickOuting(d.ts));
    for (const a of d.add) await store.put('photos', { id: a.id, blob: a.blob, ts: Date.now() });
    await store.put('pins', p);
    for (const id of d.removed) await store.del('photos', id);
  } catch (e) {
    toast('Nie udało się zapisać. Czy w telefonie jest wolne miejsce?', 6000);
    return;
  }
  const wasNew = d.isNew;
  d.saved = true;
  if (wasNew) LS.set('draft', null);
  S.pins.set(p.id, p);
  if (S.filter && S.filter !== p.outing) applyFilter(null);
  renderPin(p);
  updateBar();
  LS.set('lastCat', p.cat);
  store.requestPersist();
  cleanupDraft();
  toast(wasNew ? 'Zapisano znalezisko.' : 'Zapisano zmiany.');
  openDetail(p.id);
}

/* ------------------------------------------------------------------ szczegóły znaleziska */

function kvRows(p) {
  const pg = toPuwg1992(p.lat, p.lng);
  return h(
    'dl',
    { class: 'kv' },
    h('dt', null, 'Data'),
    h('dd', null, fmtDateTime(p.ts)),
    S.outings.get(p.outing) && [h('dt', null, 'Wyjście'), h('dd', null, S.outings.get(p.outing).name)],
    h('dt', null, 'Pozycja'),
    h('dd', { class: 'mono' }, `${fmtLL(p.lat, p.lng)}${p.acc != null ? ` (±${p.acc} m)` : ''}`),
    h('dt', null, 'Skąd pozycja'),
    h('dd', null, srcLabel({ src: p.src, acc: null })),
    h('dt', null, 'DMS'),
    h('dd', { class: 'mono' }, toDMS(p.lat, p.lng)),
    h('dt', null, 'PL-1992'),
    h('dd', { class: 'mono' }, `X ${pg.x.toFixed(0)}   Y ${pg.y.toFixed(0)}`),
    p.depth != null && [h('dt', null, 'Głębokość'), h('dd', null, `${p.depth} cm`)],
    p.soil && [h('dt', null, 'Podłoże'), h('dd', null, p.soil)],
    p.signal && [h('dt', null, 'Sygnał'), h('dd', null, p.signal)],
    p.notes && [h('dt', null, 'Opis'), h('dd', null, p.notes)]
  );
}

function openDetail(id) {
  const p = S.pins.get(id);
  if (!p) return;
  cleanupDraft();
  if (!map.getBounds().pad(-0.25).contains([p.lat, p.lng])) map.panTo([p.lat, p.lng]);

  const photosBox = h('div', { class: 'thumbs', hidden: !(p.photos && p.photos.length) });
  (async () => {
    for (const pid of p.photos || []) {
      const ph = await store.get('photos', pid);
      if (!ph || !photosBox.isConnected) continue;
      const url = trackUrl(ph.blob);
      photosBox.append(
        h(
          'button',
          { class: 'thumb', type: 'button', 'aria-label': 'Powiększ zdjęcie', onClick: () => openViewer(url) },
          h('img', { src: url, alt: 'Zdjęcie znaleziska' })
        )
      );
    }
  })();

  const delWrap = h('div', { class: 'row-actions' });
  const showDeleteButton = () =>
    delWrap.replaceChildren(
      h('button', { type: 'button', class: 'btn danger', onClick: askDelete }, icon('trash', 18), 'Usuń')
    );
  const askDelete = () =>
    delWrap.replaceChildren(
      h('p', { class: 'hint' }, 'Usunąć to znalezisko razem ze zdjęciami? Nie da się tego cofnąć.'),
      h('button', { type: 'button', class: 'btn', onClick: showDeleteButton }, 'Anuluj'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn danger',
          onClick: async () => {
            try {
              for (const pid of p.photos || []) await store.del('photos', pid);
              await store.del('pins', p.id);
            } catch (e) {
              toast('Nie udało się usunąć.');
              return;
            }
            S.pins.delete(p.id);
            const m = S.markers.get(p.id);
            if (m) pinsGroup.removeLayer(m);
            S.markers.delete(p.id);
            updateBar();
            toast('Usunięto znalezisko.');
            closeSheet();
          }
        },
        'Tak, usuń'
      )
    );
  showDeleteButton();

  const label = encodeURIComponent(catLabel(p.cat));
  openSheet(catLabel(p.cat), [
    p.hazard && h('div', { class: 'banner danger' }, icon('warn', 20), 'Oznaczone jako niebezpieczne. Nie ruszać.'),
    photosBox,
    kvRows(p),
    h(
      'div',
      { class: 'row-actions' },
      h(
        'a',
        {
          class: 'btn',
          href: `geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}(${label})`
        },
        icon('nav', 18),
        'Nawiguj'
      ),
      h('button', { type: 'button', class: 'btn', onClick: () => { closeSheet(); startNav(p.lat, p.lng, catLabel(p.cat)); } }, icon('locate', 18), 'Kompas'),
      h(
        'button',
        { type: 'button', class: 'btn', onClick: () => copyText(fmtLL(p.lat, p.lng), 'Skopiowano współrzędne.') },
        icon('copy', 18),
        'Kopiuj'
      ),
      h('button', { type: 'button', class: 'btn', onClick: () => openForm(p) }, icon('edit', 18), 'Edytuj')
    ),
    delWrap
  ]);
}

/* ------------------------------------------------------------------ lista znalezisk */

function pinListNode(pins, emptyText) {
  if (!pins.length) return h('p', { class: 'hint' }, emptyText);
  return h(
    'div',
    { class: 'list' },
    pins.map((p) => {
      const ph = h('span', { class: 'ph' }, icon('pin', 22));
      if (p.photos && p.photos[0]) {
        store.get('photos', p.photos[0]).then((rec) => {
          if (rec && ph.isConnected) ph.replaceChildren(h('img', { src: trackUrl(rec.blob), alt: '' }));
        });
      }
      const dist = S.fix ? fmtDist(haversine(S.fix.lat, S.fix.lng, p.lat, p.lng)) : '';
      return h(
        'button',
        {
          type: 'button',
          class: 'item',
          onClick: () => {
            map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17));
            openDetail(p.id);
          }
        },
        ph,
        h(
          'span',
          null,
          h('div', { class: 't' }, catLabel(p.cat), p.hazard && h('span', { class: 'tag-haz' }, '  ! niebezpieczne')),
          h('div', { class: 's' }, [fmtDateTime(p.ts), p.depth != null ? `${p.depth} cm` : ''].filter(Boolean).join(' · '))
        ),
        h('span', { class: 'd' }, dist)
      );
    })
  );
}

let listCat = null;
function openList(keepScroll = false) {
  const all = [...S.pins.values()].sort((a, b) => b.ts - a.ts);
  const cats = new Map();
  for (const p of all) cats.set(p.cat, (cats.get(p.cat) || 0) + 1);
  if (listCat && !cats.has(listCat)) listCat = null;
  const pins = listCat ? all.filter((p) => p.cat === listCat) : all;
  const chip = (id, label) =>
    h('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(listCat === id), onClick: () => { listCat = id; openList(true); } }, label);
  openSheet(
    `Wszystkie znaleziska (${pins.length}${listCat ? ` z ${all.length}` : ''})`,
    [
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => openOutings() }, '← Wyjścia')),
      cats.size > 1 && h('div', { class: 'chips' }, chip(null, 'Wszystkie'), [...cats.entries()].sort((x, y) => y[1] - x[1]).map(([c, n]) => chip(c, `${catLabel(c)} ×${n}`))),
      pinListNode(pins, 'Brak znalezisk.')
    ],
    keepScroll
  );
}

/* ------------------------------------------------------------------ wyjścia: biblioteka i szczegóły */

function openNewOuting() {
  const def = defaultOutingName(Date.now());
  let track = LS.get('trackDefault', true);
  const input = h('input', { type: 'text', maxlength: '80', placeholder: def, autocomplete: 'off', 'aria-label': 'Nazwa wyjścia' });
  const sw = h(
    'button',
    {
      type: 'button',
      class: 'opt',
      'aria-pressed': String(track),
      onClick: () => {
        track = !track;
        sw.setAttribute('aria-pressed', String(track));
        sw.textContent = track ? 'Tak' : 'Nie';
      }
    },
    track ? 'Tak' : 'Nie'
  );
  openSheet('Nowe wyjście', [
    h('div', { class: 'field' }, h('label', null, 'Nazwa (opcjonalnie)'), input),
    h('div', { class: 'switch' }, h('span', null, 'Nagrywaj trasę (GPS)', h('small', { class: 'hint' }, 'Wyłącz, żeby oszczędzać baterię.')), sw),
    h('p', { class: 'hint' }, 'Znaleziska dodane w trakcie wyjścia trafią do jego osobnej biblioteki.'),
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn primary', onClick: () => startOuting(input.value, track) }, 'Zacznij wyjście'))
  ]);
}

function outingCard(o) {
  const n = outingPins(o.id).length;
  const dist = outingDist(o);
  const dur = !o.open && o.end && o.end - o.start > 60000 ? fmtDuration(o.end - o.start) : '';
  const pl = o.place && S.places.get(o.place);
  const meta = [fmtDateTime(o.start), dur, dist > 0 ? fmtDist(dist) : '', `${n} zn.`, pl ? pl.name : ''].filter(Boolean).join(' · ');
  return h(
    'button',
    { type: 'button', class: 'item', onClick: () => openOutingDetail(o.id) },
    h('span', { class: 'ph' }, icon('nav', 22)),
    h('span', null, h('div', { class: 't' }, o.name, o.open && h('span', { class: 'tag-live' }, '  ● trwa')), h('div', { class: 's' }, meta))
  );
}

function openOutings(keepScroll = false) {
  const list = [...S.outings.values()].sort((a, b) => b.start - a.start);
  openSheet(
    `Wyjścia (${list.length})`,
    [
      S.filter &&
        h(
          'div',
          { class: 'banner' },
          h('span', null, 'Mapa pokazuje tylko jedno wyjście.'),
          h('button', { type: 'button', class: 'btn', onClick: () => { applyFilter(null); openOutings(true); } }, 'Pokaż wszystko')
        ),
      h(
        'div',
        { class: 'row-actions' },
        !S.outing && h('button', { type: 'button', class: 'btn primary', onClick: openNewOuting }, icon('plus', 18), 'Nowe wyjście'),
        h('button', { type: 'button', class: 'btn', onClick: openList }, icon('list', 18), `Wszystkie znaleziska (${S.pins.size})`)
      ),
      list.length
        ? h('div', { class: 'list' }, list.map(outingCard))
        : h('p', { class: 'hint' }, 'Brak wyjść. Każde wyjście ma własną trasę i bibliotekę znalezisk. Dotknij „Nowe wyjście”, żeby zacząć.')
    ],
    keepScroll
  );
}

function slug(s) {
  return (
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'wyjscie'
  );
}

async function deleteOuting(o) {
  if (S.outing === o) {
    if (S.rec) {
      map.removeLayer(S.rec.line);
      store.del('tracks', S.rec.t.id).catch(() => {});
      S.rec = null;
      releaseWake();
    }
    S.outing = null;
    LS.set('activeOuting', null);
  }
  try {
    for (const p of outingPins(o.id)) {
      for (const pid of p.photos || []) await store.del('photos', pid);
      await store.del('pins', p.id);
      S.pins.delete(p.id);
      const m = S.markers.get(p.id);
      if (m) pinsGroup.removeLayer(m);
      S.markers.delete(p.id);
    }
    for (const t of outingTracks(o.id)) {
      await store.del('tracks', t.id);
      S.tracks.delete(t.id);
      const line = S.trackLines.get(t.id);
      if (line) tracksGroup.removeLayer(line);
      S.trackLines.delete(t.id);
    }
    await store.del('outings', o.id);
  } catch (e) {
    toast('Nie udało się usunąć wszystkiego.', 5000);
  }
  S.outings.delete(o.id);
  if (S.filter === o.id) applyFilter(null);
  updateBar();
  toast('Usunięto wyjście.');
  openOutings();
}

function showOnMap(o) {
  const pts = [...outingPins(o.id).map((p) => [p.lat, p.lng]), ...outingTracks(o.id).flatMap((t) => t.pts.map((q) => [q[0], q[1]]))];
  if (S.rec && S.rec.t.outing === o.id) pts.push(...S.rec.t.pts.map((q) => [q[0], q[1]]));
  if (!pts.length) {
    toast('To wyjście nie ma jeszcze żadnych danych na mapie.');
    return;
  }
  if (!S.settings.showTracks) {
    S.settings.showTracks = true;
    LS.set('showTracks', true);
    tracksGroup.addTo(map);
  }
  applyFilter(o.id);
  closeSheet();
  map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 18 });
}

function openOutingDetail(id, keepScroll = false) {
  const o = S.outings.get(id);
  if (!o) {
    openOutings();
    return;
  }
  const pins = outingPins(id).sort((a, b) => b.ts - a.ts);
  const tracks = outingTracks(id);
  const dist = outingDist(o);
  const active = S.outing === o;
  const save = () => store.put('outings', o).catch(() => toast('Nie udało się zapisać.', 4000));

  const nameIn = h('input', {
    type: 'text',
    maxlength: '80',
    value: o.name,
    'aria-label': 'Nazwa wyjścia',
    onChange: (e) => {
      o.name = e.target.value.trim() || o.name;
      e.target.value = o.name;
      for (const t of tracks) {
        t.name = o.name;
        store.put('tracks', t).catch(() => {});
      }
      if (S.rec && S.rec.t.outing === o.id) S.rec.t.name = o.name;
      if (S.filter === o.id) $('#filter-text').textContent = `Tylko: ${o.name}`;
      save();
    }
  });
  const noteIn = h('textarea', {
    maxlength: '3000',
    placeholder: 'Notatka (np. teren, pogoda, ustawienia wykrywacza)',
    'aria-label': 'Notatka do wyjścia',
    props: { value: o.note || '' },
    onChange: (e) => {
      o.note = e.target.value.trim();
      save();
    }
  });

  const endWrap = h('div', { class: 'row-actions' });
  const showEnd = () =>
    endWrap.replaceChildren(
      S.rec && h('button', { type: 'button', class: 'btn', onClick: () => { togglePause(); openOutingDetail(id, true); } }, S.rec.paused ? 'Wznów trasę' : 'Wstrzymaj trasę'),
      h('button', { type: 'button', class: 'btn primary', onClick: askEnd }, 'Zakończ wyjście')
    );
  const askEnd = () =>
    endWrap.replaceChildren(
      h('p', { class: 'hint' }, 'Zakończyć wyjście? Trasa przestanie się nagrywać.'),
      h('button', { type: 'button', class: 'btn', onClick: showEnd }, 'Anuluj'),
      h('button', { type: 'button', class: 'btn primary', onClick: async () => { await endOuting(); openOutingDetail(id); } }, 'Tak, zakończ')
    );
  if (active) showEnd();

  const delWrap = h('div', { class: 'row-actions' });
  const showDel = () => delWrap.replaceChildren(h('button', { type: 'button', class: 'btn danger', onClick: askDel }, icon('trash', 18), 'Usuń wyjście'));
  const askDel = () =>
    delWrap.replaceChildren(
      h('p', { class: 'hint' }, `Usunąć „${o.name}” razem z trasą, ${pins.length} znaleziskami i ich zdjęciami? Nie da się tego cofnąć.`),
      h('button', { type: 'button', class: 'btn', onClick: showDel }, 'Anuluj'),
      h('button', { type: 'button', class: 'btn danger', onClick: () => deleteOuting(o) }, 'Tak, usuń')
    );
  showDel();

  openSheet(
    o.name,
    [
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => openOutings() }, '← Wyjścia')),
      active && h('div', { class: 'banner' }, h('span', null, '● Wyjście trwa. Znaleziska dodajesz przyciskiem na dole mapy.')),
      active && endWrap,
      h('div', { class: 'field' }, h('label', null, 'Nazwa'), nameIn),
      S.places.size > 0 &&
        h(
          'div',
          { class: 'field' },
          h('label', null, 'Miejsce'),
          h(
            'select',
            {
              'aria-label': 'Miejsce wyjścia',
              onChange: (e) => {
                o.place = e.target.value || null;
                save();
              }
            },
            h('option', { value: '', props: { selected: !o.place } }, '(bez miejsca)'),
            ...[...S.places.values()].map((q) => h('option', { value: q.id, props: { selected: o.place === q.id } }, q.name))
          )
        ),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Start'),
        h('dd', null, fmtDateTime(o.start)),
        h('dt', null, 'Koniec'),
        h('dd', null, o.open ? 'trwa' : fmtDateTime(o.end || o.start)),
        !o.open && o.end && o.end - o.start > 60000 && [h('dt', null, 'Czas'), h('dd', null, fmtDuration(o.end - o.start))],
        h('dt', null, 'Trasa'),
        h('dd', null, dist > 0 ? fmtDist(dist) : o.track ? 'brak punktów' : 'nie nagrywana'),
        h('dt', null, 'Znaleziska'),
        h('dd', null, String(pins.length))
      ),
      h('div', { class: 'field' }, h('label', null, 'Notatka'), noteIn),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn primary', onClick: () => showOnMap(o) }, icon('layers', 18), 'Pokaż na mapie'),
        h('button', { type: 'button', class: 'btn', onClick: () => exportGPX(id) }, icon('download', 18), 'GPX'),
        h('button', { type: 'button', class: 'btn', onClick: () => exportGeoJSON(id) }, icon('download', 18), 'GeoJSON')
      ),
      h('div', { class: 'section' }, h('h3', null, `Znaleziska (${pins.length})`), pinListNode(pins, 'Brak znalezisk w tym wyjściu.')),
      delWrap
    ],
    keepScroll
  );
}

/* ------------------------------------------------------------------ warstwy */

function histRow(def) {
  const on = !!layerState.hist[def.id];
  const op = layerState.opacity[def.id] ?? def.opacity ?? 1;
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'opt',
      'aria-pressed': String(on),
      onClick: () => {
        layerState.hist[def.id] = !on;
        applyLayers();
        openLayers(true);
      }
    },
    on ? 'Włączona' : 'Wyłączona'
  );
  const slider = h('input', {
    type: 'range',
    min: '0.1',
    max: '1',
    step: '0.05',
    'aria-label': `Przezroczystość: ${def.name}`,
    onInput: (e) => {
      const v = Number(e.target.value);
      layerState.opacity[def.id] = v;
      const l = layerObjs.get(def.id);
      if (l) l.setOpacity(v);
      LS.set('layers', layerState);
    },
    props: { value: String(op) }
  });
  return h(
    'div',
    { class: 'layer-row' },
    h('div', { class: 'top' }, h('strong', null, def.name), toggle),
    [def.year, def.scale, def.accuracy && `dokładność ${def.accuracy}`].filter(Boolean).length > 0 &&
      h('div', { class: 'hint' }, [def.year, def.scale, def.accuracy && `dokładność ${def.accuracy}`].filter(Boolean).join(' · ')),
    on && h('label', { class: 'hint' }, 'Przezroczystość', slider),
    def.type === 'scan' && scanActions(def)
  );
}

function setBase(id) {
  if (id === 'nmt-base' && layerState.base !== 'nmt-base') layerState.last = layerState.base;
  layerState.base = id;
  if (id !== 'nmt-base') layerState.last = id;
  applyLayers();
}

function toggleNmt() {
  if (layerState.base === 'nmt-base') {
    // z „samego LiDAR-u” wracamy do poprzedniego podkładu, bez cieniowania
    layerState.base = layerState.last;
    layerState.nmt = false;
  } else {
    layerState.nmt = !layerState.nmt;
  }
  applyLayers();
}

function toggleNames() {
  layerState.names = !layerState.names;
  applyLayers();
}

function updateQuick() {
  const n = $('#btn-nmt');
  const t = $('#btn-names');
  if (n) {
    const on = layerState.base === 'nmt-base' || layerState.nmt;
    n.classList.toggle('active', on);
    n.setAttribute('aria-pressed', String(on));
  }
  if (t) {
    t.classList.toggle('active', layerState.names);
    t.setAttribute('aria-pressed', String(layerState.names));
  }
  const hb = $('#btn-hist');
  if (hb) {
    hb.hidden = !histDefs().length;
    const on = anyHist();
    hb.classList.toggle('active', on);
    hb.setAttribute('aria-pressed', String(on));
    const cb = $('#btn-curtain');
    cb.hidden = !on || !histDefs().length;
    cb.classList.toggle('active', layerState.curtain);
    cb.setAttribute('aria-pressed', String(layerState.curtain));
  }
}

/* ------------------------------------------------------------------ mapy historyczne i kurtyna */

const histDefs = () => ALL_DEFS.filter((d) => d.kind === 'hist');
const anyHist = () => histDefs().some((d) => layerState.hist[d.id]);

function toggleHist() {
  const defs = histDefs();
  if (!defs.length) return;
  if (anyHist()) {
    const on = defs.find((d) => layerState.hist[d.id]);
    if (on) layerState.histLast = on.id;
    for (const d of defs) layerState.hist[d.id] = false;
  } else {
    const id = defs.some((d) => d.id === layerState.histLast) ? layerState.histLast : defs[0].id;
    layerState.hist[id] = true;
  }
  applyLayers();
}

function toggleCurtain() {
  layerState.curtain = !layerState.curtain;
  applyLayers();
}

// Kurtyna: stara mapa widoczna tylko po lewej stronie pionowej linii, po prawej jest dzisiejsza mapa.
const curtainEl = $('#curtain');
function curtainPx() {
  return Math.round(map.getSize().x * layerState.curtainX);
}
function clipHist() {
  const nw = map.containerPointToLayerPoint([0, 0]);
  const se = map.containerPointToLayerPoint(map.getSize());
  const on = layerState.curtain && anyHist();
  const x = nw.x + curtainPx();
  for (const d of histDefs()) {
    const l = layerObjs.get(d.id);
    const c = l && l.getContainer && l.getContainer();
    if (c) c.style.clip = on ? `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)` : '';
  }
}
function updateCurtain() {
  const on = layerState.curtain && anyHist();
  curtainEl.hidden = !on;
  if (on) curtainEl.style.left = curtainPx() + 'px';
  clipHist();
}
map.on('move zoom resize layeradd', () => {
  if (layerState.curtain) {
    updateCurtain();
  }
});
{
  const handle = curtainEl.querySelector('.curtain-handle');
  let drag = false;
  const moveTo = (clientX) => {
    const r = $('#map').getBoundingClientRect();
    layerState.curtainX = Math.min(0.9, Math.max(0.1, (clientX - r.left) / r.width));
    curtainEl.style.left = curtainPx() + 'px';
    clipHist();
  };
  handle.addEventListener('pointerdown', (e) => {
    drag = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (drag) moveTo(e.clientX);
  });
  const end = () => {
    if (!drag) return;
    drag = false;
    LS.set('layers', layerState);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}


/* ------------------------------------------------------------------ własne mapy ze skanów */

const mapTransform = (r) => fitTransform(r.init, r.pts);

function userMapDefs() {
  return [...S.maps.values()].map((r) => ({
    id: 'map:' + r.id,
    name: r.name,
    kind: 'hist',
    type: 'scan',
    rec: r,
    opacity: 0.8,
    accuracy: r.pts.length ? `dopasowano na ${r.pts.length} pkt` : 'niedopasowana'
  }));
}

function syncMapDefs() {
  const keep = ALL_DEFS.filter((d) => d.type !== 'scan');
  ALL_DEFS.length = 0;
  ALL_DEFS.push(...keep, ...userMapDefs());
  for (const [id, l] of [...layerObjs]) {
    if (id.startsWith('map:') && !S.maps.has(id.slice(4))) {
      if (map.hasLayer(l)) map.removeLayer(l);
      if (l._url) URL.revokeObjectURL(l._url);
      layerObjs.delete(id);
      delete layerState.hist[id];
    }
  }
}

async function importScan(file, placeId = null) {
  toast('Wczytuję skan…', 10000);
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch (e) {
    toast('Nie udało się otworzyć obrazu. Użyj JPG lub PNG; bardzo duży skan zmniejsz najpierw na komputerze.', 8000);
    return;
  }
  const k = Math.min(1, 4800 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const hh = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, hh);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
  if (!blob) {
    toast('Nie udało się przetworzyć skanu.', 5000);
    return;
  }
  // wstępne ustawienie: skan na środku widoku, ok. 80% ekranu, bez obrotu
  const size = map.getSize();
  const mpp = 156543.03392804097 / Math.pow(2, map.getZoom());
  const s = Math.min((0.8 * size.x * mpp) / w, (0.8 * size.y * mpp) / hh);
  const cm = SM.project(map.getCenter());
  const rec = {
    id: store.uid(),
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Mapa',
    blob,
    w,
    h: hh,
    init: { a: s, b: 0, c: 0, d: -s, e: cm.x - (s * w) / 2, f: cm.y + (s * hh) / 2 },
    pts: [],
    place: placeId,
    created: Date.now()
  };
  S.maps.set(rec.id, rec);
  syncMapDefs();
  hideToast();
  startAlign(rec, true);
}

function scanActions(def) {
  const r = def.rec;
  const wrap = h('div', { class: 'row-actions' });
  const nameIn = h('input', {
    type: 'text',
    maxlength: '80',
    value: r.name,
    'aria-label': 'Nazwa mapy',
    onChange: (e) => {
      r.name = e.target.value.trim() || r.name;
      e.target.value = r.name;
      def.name = r.name;
      store.put('maps', r).catch(() => toast('Nie udało się zapisać.', 4000));
      openLayers(true);
    }
  });
  const show = () =>
    wrap.replaceChildren(
      h('button', { type: 'button', class: 'btn', onClick: () => startAlign(r, false) }, 'Dopasuj ponownie'),
      h('button', { type: 'button', class: 'btn danger', onClick: ask }, icon('trash', 18), 'Usuń')
    );
  const ask = () =>
    wrap.replaceChildren(
      h('p', { class: 'hint' }, 'Usunąć tę mapę z telefonu? Oryginalny plik zostaje u Ciebie.'),
      h('button', { type: 'button', class: 'btn', onClick: show }, 'Anuluj'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn danger',
          onClick: async () => {
            await store.del('maps', r.id).catch(() => {});
            S.maps.delete(r.id);
            syncMapDefs();
            applyLayers();
            openLayers(true);
          }
        },
        'Tak, usuń'
      )
    );
  show();
  return h('div', null, h('div', { class: 'field' }, nameIn), wrap);
}

/* Dopasowanie skanu do terenu: celownik na punkcie skanu, potem celownik na tym samym punkcie terenu. */

function startAlign(rec, isNew) {
  const id = 'map:' + rec.id;
  layerState.hist[id] = true;
  const al = {
    rec,
    id,
    isNew,
    origPts: rec.pts.map((p) => ({ ...p })),
    pts: rec.pts.map((p) => ({ ...p })),
    step: rec.pts.length ? 'idle' : 'A',
    pending: null,
    marker: null,
    op: null,
    curtainWas: layerState.curtain,
    saved: false
  };
  layerState.curtain = false;
  S.aligning = al;
  applyLayers();
  al.layer = layerObjs.get(id);
  document.body.classList.add('picking', 'aligning');
  $('#crosshair').hidden = false;
  $('#aligner').hidden = false;
  sheetEl.hidden = true;
  backdrop.hidden = true;
  history.pushState({ align: 1 }, '');
  if (!isNew) {
    const T = mapTransform(rec);
    const pts = [[0, 0], [rec.w, 0], [0, rec.h], [rec.w, rec.h]].map(([x, y]) => {
      const [X, Y] = applyT(T, x, y);
      return SM.unproject(L.point(X, Y));
    });
    map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
  }
  renderAligner();
}

const STEP_OP = { A: 0.9, B: 0.5, idle: 0.65 };

function renderAligner() {
  const al = S.aligning;
  if (!al) return;
  const n = al.pts.length;
  al.layer.setOpacity(al.op ?? STEP_OP[al.step]);
  let title;
  let text;
  let buttons;
  const cancel = h('button', { type: 'button', class: 'btn', onClick: () => history.back() }, 'Anuluj');
  if (al.step === 'A') {
    title = `Punkt ${n + 1}: wskaż na skanie`;
    text = 'Przesuwaj i przybliżaj mapę, aż celownik stanie na rozpoznawalnym miejscu skanu (skrzyżowanie, kościół, most). Potem „Dalej”.';
    buttons = [cancel, h('button', { type: 'button', class: 'btn primary', onClick: alignNext }, 'Dalej')];
  } else if (al.step === 'B') {
    title = `Punkt ${n + 1}: to samo miejsce w terenie`;
    text = 'Czerwona kropka to wybrane miejsce na skanie. Przesuń mapę tak, żeby celownik stał na TYM SAMYM miejscu na prawdziwej mapie, i dotknij „Przypnij”.';
    buttons = [
      h('button', { type: 'button', class: 'btn', onClick: alignBack }, 'Wstecz'),
      h('button', { type: 'button', class: 'btn primary', onClick: alignPin }, 'Przypnij tutaj')
    ];
  } else {
    title = `Dopasowanie: ${n} ${n === 1 ? 'punkt' : n < 5 ? 'punkty' : 'punktów'}`;
    text =
      n === 1
        ? 'Potrzebny jest drugi punkt, daleko od pierwszego: ustawi skalę i obrót. Bez dwóch punktów nie przejdziesz dalej.'
        : n === 2
          ? 'Dobrze. Trzeci punkt (z dala od prostej między tamtymi) poprawi przekrzywienie arkusza.'
          : 'Gdy skan pasuje do terenu, dotknij „Gotowe”. Kolejne punkty poprawiają dopasowanie.';
    buttons = [
      cancel,
      h('button', { type: 'button', class: 'btn', onClick: alignUndo, disabled: !n }, 'Cofnij punkt'),
      h('button', { type: 'button', class: 'btn', onClick: () => { al.step = 'A'; renderAligner(); } }, '+ Punkt'),
      h('button', { type: 'button', class: 'btn primary', onClick: alignDone, disabled: n < 2 }, n < 2 ? 'Gotowe (min. 2)' : 'Gotowe')
    ];
  }
  const slider = h('input', {
    type: 'range',
    min: '0.1',
    max: '1',
    step: '0.05',
    'aria-label': 'Przezroczystość skanu',
    props: { value: String(al.op ?? STEP_OP[al.step]) },
    onInput: (e) => {
      al.op = Number(e.target.value);
      al.layer.setOpacity(al.op);
    }
  });
  $('#aligner').replaceChildren(
    h('h3', null, title),
    h('p', null, text),
    h('div', { class: 'op' }, h('span', null, 'Przezroczystość skanu'), slider),
    h('div', { class: 'row' }, buttons)
  );
}

function alignNext() {
  const al = S.aligning;
  const c = map.getCenter();
  const m = SM.project(c);
  const T = mapTransform(al.rec);
  const [px, py] = applyInv(T, m.x, m.y);
  if (!(px >= 0 && py >= 0 && px <= al.rec.w && py <= al.rec.h)) {
    toast('Celownik jest poza skanem. Przesuń mapę na skan.', 3500);
    return;
  }
  al.pending = { px, py, ll: c };
  al.marker = L.circleMarker(c, { radius: 8, color: '#fff', weight: 3, fillColor: '#d6402a', fillOpacity: 1, interactive: false }).addTo(map);
  al.step = 'B';
  renderAligner();
}

function alignBack() {
  const al = S.aligning;
  if (al.marker) map.removeLayer(al.marker);
  al.marker = null;
  al.pending = null;
  al.step = 'A';
  renderAligner();
}

function alignPin() {
  const al = S.aligning;
  const m = SM.project(map.getCenter());
  al.pts.push({ px: al.pending.px, py: al.pending.py, X: m.x, Y: m.y });
  if (al.marker) map.removeLayer(al.marker);
  al.marker = null;
  al.pending = null;
  al.rec.pts = al.pts;
  al.layer.setTransform(mapTransform(al.rec));
  al.step = 'idle';
  renderAligner();
}

function alignUndo() {
  const al = S.aligning;
  al.pts.pop();
  al.rec.pts = al.pts;
  al.layer.setTransform(mapTransform(al.rec));
  al.step = al.pts.length ? 'idle' : 'A';
  renderAligner();
}

async function alignDone() {
  const al = S.aligning;
  if (al.pts.length < 2) {
    toast('Ustaw minimum 2 punkty (daleko od siebie), inaczej skala i obrót będą zgadywane.', 4000);
    return;
  }
  al.rec.pts = al.pts;
  try {
    await store.put('maps', al.rec);
  } catch (e) {
    toast('Nie udało się zapisać mapy (za mało miejsca?).', 6000);
    return;
  }
  al.saved = true;
  history.back();
}

function endAlign() {
  const al = S.aligning;
  if (!al) return;
  S.aligning = null;
  document.body.classList.remove('picking', 'aligning');
  $('#crosshair').hidden = true;
  $('#aligner').hidden = true;
  if (al.marker) map.removeLayer(al.marker);
  layerState.curtain = al.curtainWas;
  if (al.saved) {
    layerState.opacity[al.id] = al.op ?? 0.7;
    layerState.hist[al.id] = true;
    al.layer.setOpacity(layerState.opacity[al.id]);
    syncMapDefs();
    toast('Mapa zapisana.');
  } else if (al.isNew) {
    S.maps.delete(al.rec.id);
    syncMapDefs();
  } else {
    al.rec.pts = al.origPts;
    al.layer.setTransform(mapTransform(al.rec));
    al.layer.setOpacity(layerState.opacity[al.id] ?? 0.8);
  }
  sheetEl.hidden = false;
  backdrop.hidden = false;
  applyLayers();
  openLayers(true);
}

function switchLine(label, hint, on, disabled, onClick) {
  const btn = h(
    'button',
    { type: 'button', class: 'opt', 'aria-pressed': String(on), disabled: disabled || null, onClick },
    on ? 'Tak' : 'Nie'
  );
  return h('div', { class: 'switch' }, h('span', null, label, hint && h('small', { class: 'hint' }, hint)), btn);
}

const BASE_SHORT = { osm: 'Mapa', orto: 'Orto', 'orto-hr': 'Orto HR', 'nmt-base': 'LiDAR' };
const svgUri = (inner) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>${inner}</svg>`)}")`;
const BASE_THUMBS = {
  osm: svgUri("<rect width='64' height='64' fill='#f2efe9'/><rect x='0' y='38' width='30' height='26' fill='#c8e6b0'/><rect x='40' y='4' width='24' height='20' fill='#c8e6b0'/><path d='M0 22 Q24 18 64 34' stroke='#a7cbe8' stroke-width='5' fill='none'/><path d='M8 0 L30 64 M0 48 L64 52 M44 0 L36 64' stroke='#fff' stroke-width='3' fill='none'/><path d='M0 30 L64 12' stroke='#f5c26b' stroke-width='3'/>"),
  orto: svgUri("<rect width='64' height='64' fill='#5c7a3e'/><rect x='0' y='0' width='28' height='24' fill='#7a9a4a'/><rect x='28' y='0' width='36' height='30' fill='#44602f'/><rect x='0' y='24' width='22' height='40' fill='#8c7a4d'/><rect x='22' y='30' width='42' height='34' fill='#3b5528'/><rect x='40' y='38' width='10' height='8' fill='#b9a98a'/><path d='M0 26 L64 34' stroke='#cdbf9a' stroke-width='2'/>"),
  'orto-hr': svgUri("<rect width='64' height='64' fill='#587a3a'/><rect x='0' y='0' width='30' height='26' fill='#7c9c4c'/><rect x='30' y='0' width='34' height='28' fill='#46633a'/><rect x='0' y='26' width='20' height='38' fill='#8f7d52'/><rect x='20' y='28' width='44' height='36' fill='#3a5a2c'/><rect x='38' y='36' width='14' height='10' fill='#c8baa0'/><path d='M4 4v22M8 4v22M12 4v22M16 4v22M20 4v22M24 4v22' stroke='#6a8a40' stroke-width='1'/><path d='M0 27 L64 33' stroke='#d6c9a6' stroke-width='2'/>"),
  'nmt-base': svgUri("<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#f0f0f0'/><stop offset='.5' stop-color='#9a9a9a'/><stop offset='1' stop-color='#3c3c3c'/></linearGradient></defs><rect width='64' height='64' fill='url(#g)'/><circle cx='22' cy='24' r='12' fill='#d8d8d8' opacity='.7'/><circle cx='44' cy='44' r='14' fill='#4a4a4a' opacity='.5'/><path d='M0 50 Q32 30 64 54' stroke='#fff' stroke-width='2' fill='none' opacity='.6'/>")
};

function openLayers(keepScroll = false) {
  const base = CONFIG.base.map((def) =>
    h(
      'button',
      {
        type: 'button',
        class: 'radio-row has-thumb',
        role: 'radio',
        'aria-checked': String(layerState.base === def.id),
        onClick: () => {
          setBase(def.id);
          openLayers(true);
        }
      },
      h('span', { class: 'thumb', style: `background-image:${BASE_THUMBS[def.id] || 'none'}` }),
      h('span', null, def.name)
    )
  );
  const lidarOnly = layerState.base === 'nmt-base';
  const scanInput = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onChange: (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) importScan(f);
    }
  });
  const hist = histDefs().map(histRow);
  const histOn = histDefs().filter((d) => layerState.hist[d.id]).length;
  const histCurtain = hist.length ? switchLine('Kurtyna: porównaj z dzisiejszą mapą', 'Przesuwasz pionową linię: po lewej mapa historyczna, po prawej dzisiejsza.', layerState.curtain, !anyHist(), () => { toggleCurtain(); openLayers(true); }) : null;
  const extras = [lidarOnly || layerState.nmt ? 'LiDAR' : null, layerState.names ? 'nazwy' : null].filter(Boolean);
  const active = activePlaceId && S.places.get(activePlaceId);
  const vis = (label, hint, key, after) =>
    switchLine(label, hint, S.settings[key], false, () => {
      S.settings[key] = !S.settings[key];
      LS.set(key, S.settings[key]);
      after();
      openLayers(true);
    });
  const shown = [S.settings.showPins && 'znaleziska', S.settings.showTracks && 'trasy', S.settings.showPlaces && 'miejsca'].filter(Boolean);
  openSheet(
    'Warstwy mapy',
    [
      h('div', { class: 'section' }, h('h3', null, 'Podkład'), h('div', { role: 'radiogroup', class: 'section' }, base)),
      fold(
        'l:extras',
        'Dodatki',
        extras.join(', ') || 'brak',
        switchLine(
          'Cieniowanie LiDAR na podkładzie',
          lidarOnly ? ' (wybrany sam LiDAR)' : '',
          lidarOnly || layerState.nmt,
          lidarOnly,
          () => {
            toggleNmt();
            openLayers(true);
          }
        ),
        !lidarOnly &&
          layerState.nmt &&
          h(
            'label',
            { class: 'hint slider-line' },
            `LiDAR: ${Math.round(layerState.nmtAlpha * 100)}% (0 = sam podkład, 100 = sam LiDAR)`,
            h('input', {
              type: 'range',
              min: '0',
              max: '1',
              step: '0.05',
              'aria-label': 'Mieszanie podkładu z LiDAR',
              props: { value: String(layerState.nmtAlpha) },
              onInput: (e) => {
                const v = Number(e.target.value);
                layerState.nmtAlpha = v;
                e.target.parentNode.firstChild.nodeValue = `LiDAR: ${Math.round(v * 100)}% (0 = sam podkład, 100 = sam LiDAR)`;
                for (const [id, l] of layerObjs) if (id.endsWith('-nmt') && l.setShadeAlpha) l.setShadeAlpha(v);
                layerState.nmtMix = v;
                LS.set('layers', layerState);
              }
            })
          ),
        switchLine('Nazwy ulic, miejscowości i numery domów', '', layerState.names, false, () => {
          toggleNames();
          openLayers(true);
        })
      ),
      fold(
        'l:hist',
        'Mapy historyczne',
        histOn ? `${histOn} włączone` : String(hist.length),
        hist,
        hist.length ? histCurtain : h('p', { class: 'hint' }, 'Dodaj skan starej mapy (np. z Mapstera) i dopasuj go do terenu dwoma–trzema punktami.'),
        h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn primary', onClick: () => scanInput.click() }, icon('plus', 18), 'Dodaj mapę ze skanu'), scanInput)
      ),
      fold(
        'l:show',
        'Widoczność',
        shown.join(', ') || 'nic',
        vis('Znaleziska (pinezki)', '', 'showPins', () => (S.settings.showPins ? pinsGroup.addTo(map) : map.removeLayer(pinsGroup))),
        vis('Zapisane trasy', '', 'showTracks', () => (S.settings.showTracks ? tracksGroup.addTo(map) : map.removeLayer(tracksGroup))),
        vis('Miejsca (pinezki)', '', 'showPlaces', () => (S.settings.showPlaces ? placesGroup.addTo(map) : map.removeLayer(placesGroup))),
        vis('Granica wybranego miejsca', active ? ` (${active.name})` : ' (brak wybranego miejsca)', 'showBorders', refreshPlaces),
        active && h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => { selectPlace(null); openLayers(true); } }, 'Odznacz miejsce'))
      )
    ],
    keepScroll
  );
}

/* ------------------------------------------------------------------ menu: dane, ślady, ustawienia */

function exportData(outingId) {
  const o = outingId ? S.outings.get(outingId) : null;
  return {
    pins: o ? outingPins(o.id) : [...S.pins.values()],
    tracks: o ? outingTracks(o.id) : [...S.tracks.values()],
    tag: o ? slug(o.name) : 'wszystko'
  };
}
async function exportGeoJSON(outingId) {
  const d = exportData(outingId);
  download(`detektor-${d.tag}-${stamp()}.geojson`, JSON.stringify(toGeoJSON(d.pins, d.tracks), null, 1), 'application/geo+json');
}
function exportGPX(outingId) {
  const d = exportData(outingId);
  download(`detektor-${d.tag}-${stamp()}.gpx`, toGPX(d.pins, d.tracks), 'application/gpx+xml');
}
async function exportBackup() {
  try {
    const used = new Set([...S.pins.values()].flatMap((p) => p.photos || []));
    const photos = (await store.getAll('photos')).filter((ph) => used.has(ph.id));
    const text = await makeBackup([...S.pins.values()], [...S.tracks.values()], photos, [...S.outings.values()], [...S.places.values()]);
    download(`detektor-kopia-${stamp()}.json`, text, 'application/json');
    LS.set('lastBackup', Date.now());
    toast('Kopia zapasowa zapisana w Pobranych.');
    openMenu(true);
  } catch (e) {
    toast('Nie udało się zrobić kopii zapasowej.', 5000);
  }
}

async function applyImport(data) {
  for (const ph of data.photos) {
    const blob = await (await fetch(ph.dataUrl)).blob();
    await store.put('photos', { id: ph.id, blob, ts: ph.ts });
  }
  for (const o of data.outings) {
    if (S.outing && o.id === S.outing.id) continue;
    await store.put('outings', o);
    S.outings.set(o.id, o);
  }
  for (const q of data.places || []) {
    normalizePlace(q);
    await store.put('places', q);
    S.places.set(q.id, q);
    renderPlace(q);
  }
  for (const p of data.pins) {
    await store.put('pins', p);
    S.pins.set(p.id, p);
  }
  for (const t of data.tracks) {
    await store.put('tracks', t);
    S.tracks.set(t.id, t);
  }
  await adoptOrphans();
  applyFilter(S.filter);
  updateBar();
  toast(`Zaimportowano: ${data.outings.length} wyjść, ${data.pins.length} znalezisk, ${data.tracks.length} tras.`, 4000);
}

async function handleImport(file, box) {
  let data;
  try {
    data = parseBackup(await file.text());
  } catch (e) {
    toast(`Nie można wczytać pliku: ${e.message}.`, 5000);
    return;
  }
  box.replaceChildren(
    h(
      'p',
      { class: 'hint' },
      `Plik zawiera: ${data.outings.length} wyjść, ${data.pins.length} znalezisk, ${data.photos.length} zdjęć, ${data.tracks.length} tras. Dane zostaną scalone z obecnymi (ten sam identyfikator oznacza nadpisanie).`
    ),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onClick: () => box.replaceChildren() }, 'Anuluj'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary',
          onClick: async () => {
            try {
              await applyImport(data);
              openMenu(true);
            } catch (e) {
              toast('Import się nie udał.', 5000);
            }
          }
        },
        'Importuj'
      )
    )
  );
}

function switchRow(label, key, onChange) {
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'opt',
      'aria-pressed': String(!!S.settings[key]),
      onClick: () => {
        S.settings[key] = !S.settings[key];
        LS.set(key, S.settings[key]);
        btn.setAttribute('aria-pressed', String(S.settings[key]));
        btn.textContent = S.settings[key] ? 'Tak' : 'Nie';
        onChange(S.settings[key]);
      }
    },
    S.settings[key] ? 'Tak' : 'Nie'
  );
  return h('div', { class: 'switch' }, h('span', null, label), btn);
}

function parseLatLng(q) {
  const m = q.trim().replace(/,/g, ' ').match(/^(-?\d{1,2}[.]\d+)\s+(-?\d{1,3}[.]\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a >= 48 && a <= 56 && b >= 13 && b <= 25 ? [a, b] : null;
}
function searchNode() {
  const out = h('div', { class: 'list' });
  const input = h('input', { type: 'search', placeholder: 'Wieś, las albo współrzędne (51.25, 22.57)', autocomplete: 'off', 'aria-label': 'Szukaj miejsca' });
  const go = (lat, lng, z = 16) => {
    closeSheet();
    map.setView([lat, lng], z);
  };
  const run = async () => {
    const q = input.value.trim();
    if (!q) return;
    const ll = parseLatLng(q);
    if (ll) return go(ll[0], ll[1], 17);
    out.replaceChildren(h('p', { class: 'hint' }, 'Szukam…'));
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=pl&accept-language=pl&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!j.length) return out.replaceChildren(h('p', { class: 'hint' }, 'Nic nie znaleziono.'));
      out.replaceChildren(...j.map((x) => h('button', { type: 'button', class: 'item', onClick: () => go(Number(x.lat), Number(x.lon), 15) }, h('span', { class: 'ph' }, icon('pin', 22)), h('span', null, h('div', { class: 't' }, x.display_name.split(',').slice(0, 2).join(',')), h('div', { class: 's' }, x.display_name.split(',').slice(2, 5).join(','))))));
    } catch (e) {
      out.replaceChildren(h('p', { class: 'hint' }, 'Brak internetu albo wyszukiwarka nie odpowiada. Współrzędne zadziałają bez sieci.'));
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  return h('div', { class: 'section' }, input, h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn primary', onClick: run }, 'Szukaj')), out);
}

async function openMenu(keepScroll = false) {
  const info = await store.storageInfo();
  const photoCount = [...S.pins.values()].reduce((n, p) => n + (p.photos ? p.photos.length : 0), 0);
  const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1).replace('.', ',');
  const last = LS.get('lastBackup', null);
  const cc = await cacheCounts();
  const importBox = h('div', { class: 'section' });
  const importInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onChange: (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) handleImport(f, importBox);
    }
  });
  const diag = ALL_DEFS.filter((d) => layerObjs.has(d.id)).map((d) => {
    const x = S.diag[d.id] || { ok: 0, err: 0 };
    return h('div', { class: 'hint' }, `${d.name}: ${x.ok} kafelków OK, ${x.err} błędów`);
  });

  const ts = tileStats;
  diag.push(h('div', { class: 'hint' }, `Ponowienia kafelków Geoportalu: ${ts.retries}, ostatecznie nieudane: ${ts.failed}, udane: ${ts.ok}`));

  openSheet(
    'Dane i ustawienia',
    [
      fold(
        'm:data',
        'Dane i kopia zapasowa',
        `${S.outings.size} wyjść · ${S.pins.size} zn.`,
        h(
          'p',
          { class: 'hint' },
          `${S.outings.size} wyjść · ${S.pins.size} znalezisk · ${photoCount} zdjęć`,
          info.usage != null ? ` · zajęte ${mb(info.usage)} MB` : '',
          info.persisted != null ? ` · trwałe przechowywanie: ${info.persisted ? 'tak' : 'nie'}` : ''
        ),
        h(
          'p',
          { class: 'hint' },
          `Ostatnia kopia zapasowa: ${last ? fmtDateTime(last) : 'brak'}. Dane są tylko w tym telefonie; wyczyszczenie danych witryny w Chrome je usuwa.`
        ),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn primary', onClick: exportBackup }, icon('download', 18), 'Kopia zapasowa (ze zdjęciami)'),
          h('button', { type: 'button', class: 'btn', onClick: () => importInput.click() }, icon('upload', 18), 'Przywróć z kopii'),
          importInput
        ),
        importBox
      ),
      fold(
        'm:export',
        'Eksport do innych programów',
        'GPX, GeoJSON',
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => exportGeoJSON() }, icon('download', 18), 'GeoJSON (QGIS)'),
          h('button', { type: 'button', class: 'btn', onClick: () => exportGPX() }, icon('download', 18), 'GPX')
        ),
        h('p', { class: 'hint' }, 'To eksport wszystkich wyjść naraz (bez zdjęć). Pojedyncze wyjście wyeksportujesz z jego karty.')
      ),
      fold(
        'm:outings',
        'Wyjścia',
        String(S.outings.size),
        h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => openOutings() }, 'Otwórz bibliotekę wyjść'))
      ),
      fold(
        'm:settings',
        'Ustawienia',
        '',
        switchRow('Pokazuj zapisane trasy na mapie', 'showTracks', (on) => {
          if (on) tracksGroup.addTo(map);
          else map.removeLayer(tracksGroup);
        }),
        switchRow('Nie wygaszaj ekranu', 'keepAwake', (on) => {
          if (on) acquireWake();
          else releaseWake();
        })
      ),
      fold(
        'm:offline',
        'Mapa offline',
        cc ? `${cc[OFFLINE]} kafelków` : '',
        h('p', { class: 'hint' }, cc ? `W telefonie: ${cc[OFFLINE]} pobranych + ${cc['detektor-tiles']} obejrzanych kafelków.` : 'Pamięć kafelków niedostępna w tej przeglądarce.'),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn primary', onClick: () => openOffline() }, icon('download', 18), 'Zapisz widoczny obszar offline'),
          h('button', { type: 'button', class: 'btn', onClick: clearTiles }, 'Wyczyść kafelki')
        )
      ),
      fold(
        'm:test',
        'Narzędzia testowe',
        '',
        h('p', { class: 'hint' }, 'Przykładowa wyprawa wokół środka mapy (trasa + 8 znalezisk) do sprawdzania listy, filtrów, eksportu i kopii. Oznaczona [TEST].'),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn', onClick: addDemoOuting }, 'Dodaj przykładową wyprawę'),
          h('button', { type: 'button', class: 'btn', onClick: removeDemoData }, 'Usuń dane testowe')
        )
      ),
      fold('m:diag', 'Diagnostyka warstw', '', diag.length ? diag : h('p', { class: 'hint' }, 'Brak danych.')),
      fold(
        'm:about',
        'O aplikacji',
        VERSION,
        h(
          'p',
          { class: 'hint' },
          `Detektor ${VERSION}. Znaleziska, zdjęcia i ślady zostają w tym telefonie i nigdzie się nie wysyłają. Mapy: © OpenStreetMap, © GUGiK (geoportal.gov.pl). Silnik mapy: Leaflet.`
        )
      )
    ],
    keepScroll
  );
}

/* ------------------------------------------------------------------ mapa offline */

const OFFLINE = 'detektor-offline';
const OFFLINE_CAP = 12000;

async function cacheCounts() {
  if (!('caches' in window)) return null;
  try {
    const out = {};
    for (const n of ['detektor-tiles', OFFLINE]) out[n] = (await (await caches.open(n)).keys()).length;
    return out;
  } catch (e) {
    return null;
  }
}

// Źródła do zapisu offline. OSM celowo pominięte: serwery OpenStreetMap zabraniają pobierania na zapas.
const OFFLINE_SOURCES = [
  { id: 'orto', label: 'Ortofotomapa', kb: 30, on: true },
  { id: 'nmt-base', label: 'LiDAR (cieniowanie terenu)', kb: 40, on: false }
];

// Adresy kafelków do zapisu obszaru `b` w zakresie przybliżeń z0..z1 dla wybranych źródeł.
// Adresy składamy sami (getTileUrl Leafleta zależy od bieżącego zoomu mapy, więc się nie nadaje).
function offlineUrls(z0, z1, b, ids) {
  const urls = new Set();
  for (const id of ids) {
    const def = ALL_DEFS.find((d) => d.id === id);
    if (!def) continue;
    const layer = def.type === 'wmts2180' ? getLayer(def) : null;
    const nat = def.maxNativeZoom;
    for (let z = z0; z <= z1; z++) {
      if (def.minZoom && z < def.minZoom) continue;
      const zz = nat ? Math.min(z, nat) : z;
      const p0 = map.project(b.getNorthWest(), zz);
      const p1 = map.project(b.getSouthEast(), zz);
      const n = Math.pow(2, zz);
      const x0 = Math.max(0, Math.floor(p0.x / 256));
      const x1 = Math.min(n - 1, Math.floor(p1.x / 256));
      const y0 = Math.max(0, Math.floor(p0.y / 256));
      const y1 = Math.min(n - 1, Math.floor(p1.y / 256));
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (layer) {
            const c = L.point(x, y);
            c.z = zz;
            layer.urlsFor(c).forEach((u) => urls.add(u));
          } else if (def.type === 'xyz') {
            urls.add(def.url.replace('{z}', zz).replace('{x}', x).replace('{y}', y));
          }
          if (urls.size > OFFLINE_CAP * 2) return urls;
        }
      }
    }
  }
  return urls;
}

let dl = null;

async function runDownload(urls, ui) {
  const cache = await caches.open(OFFLINE);
  dl = { stop: false, ok: 0, skip: 0, fail: 0, total: urls.length, cors: 0 };
  const queue = urls.slice();
  const show = () => {
    ui.textContent = `Pobrano ${dl.ok + dl.skip} z ${dl.total}${dl.fail ? ` · błędów: ${dl.fail}` : ''}`;
  };
  const worker = async () => {
    while (queue.length && !dl.stop) {
      const u = queue.pop();
      if (await cache.match(u)) {
        dl.skip++;
        show();
        continue;
      }
      let done = false;
      for (let n = 0; n < 3 && !done && !dl.stop; n++) {
        try {
          const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
          if (res.ok) {
            await cache.put(u, res);
            dl.ok++;
            done = true;
          } else {
            await new Promise((r) => setTimeout(r, 400 * (n + 1) + Math.random() * 300));
          }
        } catch (e) {
          dl.cors++;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (!done) dl.fail++;
      if (dl.ok === 0 && dl.fail >= 10 && dl.cors >= 10) {
        dl.stop = true;
        dl.corsBlocked = true;
      }
      show();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const r = dl;
  dl = null;
  return r;
}

// Zapis obszaru offline: zakres (ekran albo granica miejsca) i warstwy do wyboru, przybliżenia do 18.
async function openOffline(opts = {}) {
  if (!('caches' in window) || !navigator.serviceWorker || !navigator.serviceWorker.controller) {
    toast('Tryb offline działa po zainstalowaniu aplikacji i jej ponownym otwarciu (potrzebny service worker).', 5000);
    return;
  }
  const place = opts.place || null;
  const screenB = map.getBounds();
  const screenZ = Math.min(Math.max(6, Math.round(map.getZoom())), 18);
  const st = { scope: place && hasPoly(place) ? 'border' : 'screen', pick: new Set(OFFLINE_SOURCES.filter((s) => s.on).map((s) => s.id)) };
  const info = h('p', { class: 'hint' });
  const prog = h('p', { class: 'hint' });
  const go = h('button', { type: 'button', class: 'btn primary' }, icon('download', 18), 'Zapisz');
  const stop = h('button', { type: 'button', class: 'btn', hidden: true, onClick: () => dl && (dl.stop = true) }, 'Przerwij');
  const scopeRow = h('div', { class: 'row-actions' });
  const checks = h('div', null);
  const scopeFold = fold('o:scope', 'Zakres', '', scopeRow);
  const whatFold = fold('o:what', 'Co zapisać', '', checks, h('p', { class: 'hint' }, 'Ortofotomapa + LiDAR razem wystarczą, żeby offline działały też widoki łączone. Twoje skany map historycznych są zawsze w telefonie. Podkładu OSM nie zapisujemy: jego serwery nie zezwalają na pobieranie na zapas.'));
  let urls = [];

  const recalc = () => {
    const b = st.scope === 'border' && place ? placeBounds(place) : screenB;
    const z0 = st.scope === 'border' ? 13 : screenZ;
    const ids = [...st.pick];
    urls = [...offlineUrls(z0, 18, b, ids)];
    const kb = ids.reduce((a, id) => a + (OFFLINE_SOURCES.find((s) => s.id === id).kb || 30), 0) / Math.max(1, ids.length);
    const mb = Math.round((urls.length * kb) / 1024);
    const big = urls.length > OFFLINE_CAP;
    info.className = big ? 'banner danger' : 'hint';
    info.textContent = !ids.length
      ? 'Zaznacz przynajmniej jedną warstwę.'
      : big
        ? `To ${urls.length > OFFLINE_CAP * 2 ? 'ponad ' + OFFLINE_CAP * 2 : urls.length} plików, za dużo na raz. Zmniejsz obszar (przybliż mapę) albo odznacz warstwę.`
        : `Przybliżenia ${z0}–18: ${urls.length} plików, ok. ${mb} MB (orientacyjnie). Najlepiej na Wi-Fi.`;
    go.disabled = big || !urls.length;
    scopeFold.fv.textContent = st.scope === 'border' ? 'Granica miejsca' : 'Ekran';
    whatFold.fv.textContent = ids.map((i) => OFFLINE_SOURCES.find((x) => x.id === i).label.split(' (')[0]).join(', ') || 'nic';
    scopeRow.replaceChildren(
      ...[
        h('button', { type: 'button', class: 'opt', 'aria-pressed': String(st.scope === 'screen'), onClick: () => { st.scope = 'screen'; recalc(); } }, 'To, co na ekranie'),
        place && hasPoly(place) && h('button', { type: 'button', class: 'opt', 'aria-pressed': String(st.scope === 'border'), onClick: () => { st.scope = 'border'; recalc(); } }, 'Granica miejsca')
      ].filter(Boolean)
    );
  };
  for (const src of OFFLINE_SOURCES) {
    checks.append(
      h(
        'label',
        { class: 'switch' },
        h('span', null, src.label),
        h('input', { type: 'checkbox', props: { checked: st.pick.has(src.id) }, onChange: (e) => { if (e.target.checked) st.pick.add(src.id); else st.pick.delete(src.id); recalc(); } })
      )
    );
  }
  go.addEventListener('click', async () => {
    go.disabled = true;
    stop.hidden = false;
    const r = await runDownload(urls, prog);
    stop.hidden = true;
    go.disabled = false;
    if (r.corsBlocked) prog.textContent = 'Serwer map nie pozwala zapisywać kafelków (brak CORS). Mapa offline dla tej warstwy nie zadziała.';
    else prog.textContent = `${r.stop ? 'Przerwano' : 'Gotowe'}: nowych ${r.ok}, już były ${r.skip}${r.fail ? `, nieudanych ${r.fail}` : ''}.`;
  });
  openSheet('Zapisz mapę offline', [
    h(
      'div',
      { class: 'section' },
      place && h('p', { class: 'sub' }, `Miejsce: ${place.name}`),
      scopeFold,
      whatFold,
      info,
      h('div', { class: 'row-actions' }, opts.back && h('button', { type: 'button', class: 'btn', onClick: opts.back }, '← Wróć'), go, stop),
      prog
    )
  ]);
  recalc();
}

async function clearTiles() {
  try {
    await caches.delete('detektor-tiles');
    await caches.delete(OFFLINE);
    toast('Usunięto zapisane kafelki map.');
  } catch (e) {
    toast('Nie udało się wyczyścić.', 3000);
  }
  openMenu(true);
}

/* ------------------------------------------------------------------ miejsca (tereny) */

const PLACE_STATUS = [
  ['todo', 'Do sprawdzenia'],
  ['plan', 'Zaplanowane'],
  ['done', 'Przeszukane'],
  ['dry', 'Wyczerpane']
];
const statusLabel = (id) => (PLACE_STATUS.find((x) => x[0] === id) || PLACE_STATUS[0])[1];
const placesGroup = L.layerGroup();
if (S.settings.showPlaces) placesGroup.addTo(map);
let activePlaceId = null; // granica rysowana tylko dla wybranego miejsca
function refreshPlaces() {
  for (const p of S.places.values()) renderPlace(p);
}
function selectPlace(id) {
  if (activePlaceId === id) return;
  activePlaceId = id;
  refreshPlaces();
}
const placeLayers = new Map();

function inPoly(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const POINT_RADIUS_M = 500; // miejsce bez granicy: wyjście w tym promieniu od punktu przypisuje się samo
const hasPoly = (p) => !!p.poly && p.poly.length >= 3;

function normalizePlace(p) {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    if (hasPoly(p)) {
      p.lat = p.poly.reduce((a, c) => a + c[0], 0) / p.poly.length;
      p.lng = p.poly.reduce((a, c) => a + c[1], 0) / p.poly.length;
    }
  }
  if (!Array.isArray(p.poly)) p.poly = [];
  return p;
}

function placeAt(lat, lng) {
  for (const p of S.places.values()) if (hasPoly(p) && inPoly(lat, lng, p.poly)) return p;
  let best = null;
  let bd = POINT_RADIUS_M;
  for (const p of S.places.values()) {
    if (hasPoly(p) || !Number.isFinite(p.lat)) continue;
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

// powierzchnia w hektarach (przybliżenie płaskie, wystarczy dla lasu czy pola)
function polyHa(poly) {
  const lat0 = poly.reduce((a, c) => a + c[0], 0) / poly.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [y1, x1] = poly[i];
    const [y2, x2] = poly[(i + 1) % poly.length];
    a += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(a) / 2 / 10000;
}
const fmtHa = (ha) => (ha >= 100 ? `${(ha / 100).toFixed(1).replace('.', ',')} km²` : `${ha.toFixed(ha < 10 ? 1 : 0).replace('.', ',')} ha`);

function removePlaceLayer(id) {
  const old = placeLayers.get(id);
  if (old) placesGroup.removeLayer(old);
  placeLayers.delete(id);
}

function renderPlace(p) {
  removePlaceLayer(p.id);
  normalizePlace(p);
  if (!Number.isFinite(p.lat)) return;
  const g = L.layerGroup();
  if (hasPoly(p) && p.id === activePlaceId && S.settings.showBorders) L.polygon(p.poly, { color: '#8b5cf6', weight: 3, dashArray: '8 6', fill: false, opacity: 0.9, interactive: false }).addTo(g);
  const m = L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#8b5cf6', fillOpacity: 1 });
  m.bindTooltip(p.name, { direction: 'top' });
  m.on('click', () => openPlaceDetail(p.id));
  m.addTo(g);
  g.addTo(placesGroup);
  placeLayers.set(p.id, g);
}

const placeOutings = (id) => [...S.outings.values()].filter((o) => o.place === id).sort((a, b) => b.start - a.start);
const placeMaps = (id) => [...S.maps.values()].filter((m) => m.place === id);
const savePlace = (p) => {
  p.updated = Date.now();
  return store.put('places', p).catch(() => toast('Nie udało się zapisać.', 4000));
};

function placeCard(p) {
  const meta = [statusLabel(p.status), `priorytet ${p.priority || 3}`, hasPoly(p) ? fmtHa(polyHa(p.poly)) : 'sam punkt', `${placeOutings(p.id).length} wyjść`, `${placeMaps(p.id).length} map`].join(' · ');
  return h(
    'button',
    { type: 'button', class: 'item', onClick: () => openPlaceDetail(p.id) },
    h('span', { class: 'ph' }, icon('pin', 22)),
    h('span', null, h('div', { class: 't' }, p.name), h('div', { class: 's' }, meta))
  );
}

function openPlaces(keepScroll = false) {
  const list = [...S.places.values()].sort((a, b) => (b.priority || 3) - (a.priority || 3) || a.name.localeCompare(b.name, 'pl'));
  openSheet(
    `Miejsca (${list.length})`,
    [
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn primary', onClick: () => addPlaceAt(map.getCenter()) }, icon('plus', 18), 'Dodaj miejsce w środku mapy')),
      list.length
        ? h('div', { class: 'list' }, list.map(placeCard))
        : h('p', { class: 'hint' }, 'Miejsce to teren, który chcesz zbadać (las, pole, dawny folwark). Przytrzymaj palec na mapie (na komputerze: prawy przycisk) i wybierz „Dodaj miejsce tutaj”. Potem dopiszesz notatkę, mapy historyczne i wyjścia.')
    ],
    keepScroll
  );
}

/* rysowanie granicy: kolejne punkty wskazujesz celownikiem (jak przy dopasowaniu skanu) */

let draw = null;
const placeEdit = { id: null, on: false }; // czy nagłówek karty miejsca jest w trybie edycji

function dropDraw() {
  if (!draw) return;
  if (draw.preview) map.removeLayer(draw.preview);
  draw = null;
}

function startPlaceDraw(existing) {
  dropDraw();
  draw = { existing, name: existing ? existing.name : '', pts: [], preview: null };
  renderDraw();
}

function renderDraw() {
  if (!draw) return;
  if (draw.preview) map.removeLayer(draw.preview);
  const st = { color: '#8b5cf6', weight: 3, dashArray: '8 6', fillOpacity: 0.08 };
  draw.preview = draw.pts.length >= 3 ? L.polygon(draw.pts, st).addTo(map) : draw.pts.length ? L.polyline(draw.pts, st).addTo(map) : null;
  const d = draw;
  const nameIn = h('input', {
    type: 'text',
    maxlength: '80',
    placeholder: 'Nazwa, np. Las koło Niemiec',
    'aria-label': 'Nazwa miejsca',
    value: d.name,
    onInput: (e) => (d.name = e.target.value)
  });
  const n = d.pts.length;
  openSheet('Granica miejsca (ręcznie)', [
    h('div', { class: 'field' }, h('label', null, 'Nazwa'), nameIn),
    h(
      'p',
      { class: 'hint' },
      n < 3
        ? `Granica: ${n} ${n === 1 ? 'punkt' : n < 5 ? 'punkty' : 'punktów'}. Dodaj minimum 3 punkty obrysu: za każdym razem ustaw celownik na rogu terenu i dotknij „Użyj tego miejsca”.`
        : `Granica: ${n} ${n < 5 ? 'punkty' : 'punktów'}, ok. ${fmtHa(polyHa(d.pts))}. Możesz dodać więcej punktów albo zapisać.`
    ),
    h(
      'div',
      { class: 'row-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary',
          onClick: async () => {
            const c = await pickOnMap(null);
            if (c && draw === d) d.pts.push([c.lat, c.lng]);
            renderDraw();
          }
        },
        icon('plus', 18),
        'Dodaj punkt granicy'
      ),
      h('button', { type: 'button', class: 'btn', disabled: !n, onClick: () => { d.pts.pop(); renderDraw(); } }, 'Cofnij punkt')
    ),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onClick: () => { const ex = d.existing; dropDraw(); ex ? openPlaceDetail(ex.id) : openPlaces(); } }, 'Anuluj'),
      h('button', { type: 'button', class: 'btn primary', disabled: n < 3, onClick: savePlaceDraw }, 'Zapisz miejsce')
    )
  ]);
}

async function savePlaceDraw() {
  const d = draw;
  if (!d || d.pts.length < 3) return;
  const p = d.existing;
  if (!p) return;
  if (d.name.trim()) p.name = d.name.trim();
  p.poly = d.pts.map((c) => [c[0], c[1]]);
  await savePlace(p);
  renderPlace(p);
  dropDraw();
  openPlaceDetail(p.id);
}

function placeBounds(p) {
  return hasPoly(p) ? L.latLngBounds(p.poly) : null;
}

function focusPlace(p) {
  selectPlace(p.id);
  const b = placeBounds(p);
  if (b) map.fitBounds(b, { padding: [30, 30] });
  else map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
}

async function addPlaceAt(ll) {
  const names = new Set([...S.places.values()].map((q) => q.name));
  let n = S.places.size + 1;
  while (names.has(`Miejsce ${n}`)) n++;
  const p = { id: store.uid(), name: `Miejsce ${n}`, lat: ll.lat, lng: ll.lng, poly: [], note: '', status: 'todo', priority: 3, created: Date.now() };
  S.places.set(p.id, p);
  await savePlace(p);
  renderPlace(p);
  map.panTo([p.lat, p.lng]);
  openPlaceDetail(p.id);
}

// Granica = prostokąt widoczny na ekranie.
async function setScreenBorder(p) {
  const b = map.getBounds();
  p.poly = [b.getNorthWest(), b.getNorthEast(), b.getSouthEast(), b.getSouthWest()].map((c) => [c.lat, c.lng]);
  await savePlace(p);
  renderPlace(p);
  toast(`Granica ustawiona: ${fmtHa(polyHa(p.poly))}.`, 3500);
  openPlaceDetail(p.id, true);
}

function openPlaceDetail(id, keepScroll = false) {
  const p = S.places.get(id);
  if (!p) {
    openPlaces();
    return;
  }
  selectPlace(id);
  const nameIn = h('input', {
    type: 'text',
    maxlength: '80',
    value: p.name,
    'aria-label': 'Nazwa miejsca',
    onChange: (e) => {
      p.name = e.target.value.trim() || p.name;
      e.target.value = p.name;
      savePlace(p);
      renderPlace(p);
      openPlaceDetail(id, true);
    }
  });
  const statusSel = h(
    'select',
    { 'aria-label': 'Status', onChange: (e) => { p.status = e.target.value; savePlace(p); } },
    ...PLACE_STATUS.map(([v, l]) => h('option', { value: v, props: { selected: p.status === v } }, l))
  );
  const prioSel = h(
    'select',
    { 'aria-label': 'Priorytet', onChange: (e) => { p.priority = Number(e.target.value); savePlace(p); } },
    ...[5, 4, 3, 2, 1].map((v) => h('option', { value: String(v), props: { selected: (p.priority || 3) === v } }, `${v}${v === 5 ? ' (najwyższy)' : v === 1 ? ' (najniższy)' : ''}`))
  );
  const noteIn = h('textarea', {
    maxlength: '5000',
    placeholder: 'Kontekst historyczny: co tu było, kiedy, źródła, mapy, co mogło zostać w ziemi…',
    'aria-label': 'Notatka do miejsca',
    props: { value: p.note || '' },
    onChange: (e) => {
      p.note = e.target.value.trim();
      savePlace(p);
    }
  });

  // mapy historyczne przypisane do miejsca
  const maps = placeMaps(id);
  const mapRows = maps.map((m) => {
    const key = 'map:' + m.id;
    const on = !!layerState.hist[key];
    return h(
      'div',
      { class: 'switch' },
      h('span', null, `${m.name}${m.pts && m.pts.length ? '' : ' (niedopasowana)'}`),
      h(
        'button',
        {
          type: 'button',
          class: 'opt',
          'aria-pressed': String(on),
          onClick: () => {
            layerState.hist[key] = !on;
            applyLayers();
            openPlaceDetail(id, true);
          }
        },
        on ? 'Widoczna' : 'Ukryta'
      )
    );
  });
  const scanInput = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onChange: (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) {
        focusPlace(p);
        importScan(f, id);
      }
    }
  });
  const otherMaps = [...S.maps.values()].filter((m) => m.place !== id);
  const attachMap = otherMaps.length
    ? h(
        'select',
        {
          'aria-label': 'Przypisz istniejącą mapę',
          onChange: async (e) => {
            const m = S.maps.get(e.target.value);
            if (!m) return;
            m.place = id;
            await store.put('maps', m).catch(() => toast('Nie udało się zapisać.', 4000));
            openPlaceDetail(id, true);
          }
        },
        h('option', { value: '' }, 'Przypisz mapę, którą już masz…'),
        ...otherMaps.map((m) => h('option', { value: m.id }, m.name))
      )
    : null;

  // wyjścia
  const outs = placeOutings(id);
  const otherOuts = [...S.outings.values()].filter((o) => o.place !== id).sort((a, b) => b.start - a.start);
  const attachOut = otherOuts.length
    ? h(
        'select',
        {
          'aria-label': 'Przypisz wyjście',
          onChange: async (e) => {
            const o = S.outings.get(e.target.value);
            if (!o) return;
            o.place = id;
            await store.put('outings', o).catch(() => toast('Nie udało się zapisać.', 4000));
            openPlaceDetail(id, true);
          }
        },
        h('option', { value: '' }, 'Przypisz wyjście…'),
        ...otherOuts.map((o) => h('option', { value: o.id }, `${o.name} (${fmtDateTime(o.start)})`))
      )
    : null;

  const delWrap = h('div', { class: 'row-actions' });
  const showDel = () => delWrap.replaceChildren(h('button', { type: 'button', class: 'btn danger', onClick: askDel }, icon('trash', 18), 'Usuń miejsce'));
  const askDel = () =>
    delWrap.replaceChildren(
      h('p', { class: 'hint' }, `Usunąć „${p.name}”? Wyjścia, znaleziska i mapy zostają, tracą tylko przypisanie do miejsca.`),
      h('button', { type: 'button', class: 'btn', onClick: showDel }, 'Anuluj'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn danger',
          onClick: async () => {
            for (const o of placeOutings(id)) {
              o.place = null;
              await store.put('outings', o).catch(() => {});
            }
            for (const m of placeMaps(id)) {
              m.place = null;
              await store.put('maps', m).catch(() => {});
            }
            await store.del('places', id).catch(() => {});
            S.places.delete(id);
            removePlaceLayer(id);
            openPlaces();
          }
        },
        'Tak, usuń'
      )
    );
  showDel();

  const pins = outs.flatMap((o) => outingPins(o.id));
  const byCat = new Map();
  for (const q of pins) byCat.set(q.cat, (byCat.get(q.cat) || 0) + 1);
  const finds = pins.length
    ? [
        h('p', { class: 'sub' }, `${pins.length} ${pins.length === 1 ? 'znalezisko' : 'znalezisk'} w ${outs.length} ${outs.length === 1 ? 'wyjściu' : 'wyjściach'}`),
        h('div', { class: 'chips' }, [...byCat.entries()].sort((x, y) => y[1] - x[1]).map(([cat, n]) => h('span', { class: 'chip' }, `${catLabel(cat)} ×${n}`)))
      ]
    : h('p', { class: 'sub' }, outs.length ? 'Z tych wyjść jeszcze nic nie dodano.' : 'Jeszcze nic tu nie znaleziono.');

  if (placeEdit.id !== id) {
    placeEdit.id = id;
    placeEdit.on = false;
  }
  const pencil = h(
    'button',
    {
      type: 'button',
      class: 'round small',
      'aria-label': 'Edytuj nazwę, status i priorytet',
      'aria-pressed': String(placeEdit.on),
      onClick: () => {
        placeEdit.on = !placeEdit.on;
        openPlaceDetail(id, true);
      }
    },
    icon('edit', 18)
  );
  const head = placeEdit.on
    ? h(
        'div',
        { class: 'section' },
        h('div', { class: 'field' }, h('label', null, 'Nazwa'), nameIn),
        h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Status'), statusSel), h('div', { class: 'field' }, h('label', null, 'Priorytet'), prioSel))
      )
    : h('p', { class: 'sub' }, `${statusLabel(p.status)} · priorytet ${p.priority || 3}`);

  const borderBody = [
    h('p', { class: 'hint' }, hasPoly(p) ? `Obecna granica: ${fmtHa(polyHa(p.poly))}.` : 'Bez granicy to tylko punkt. Ustaw mapę tak, żeby na ekranie był cały interesujący Cię teren, i użyj ekranu jako granicy.'),
    h('button', { type: 'button', class: 'btn primary', onClick: () => setScreenBorder(p) }, hasPoly(p) ? 'Ustaw na obecny ekran' : 'Użyj ekranu jako granicy'),
    h('button', { type: 'button', class: 'btn', onClick: () => startPlaceDraw(p) }, 'Rysuj ręcznie'),
    hasPoly(p) && h('button', { type: 'button', class: 'btn', onClick: async () => { p.poly = []; await savePlace(p); renderPlace(p); openPlaceDetail(id, true); } }, 'Usuń granicę')
  ];

  openSheet(
    p.name,
    [
      head,
      finds,
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn primary', onClick: () => { closeSheet(); focusPlace(p); } }, icon('layers', 18), 'Pokaż na mapie'),
        h('button', { type: 'button', class: 'btn', onClick: () => openOffline({ place: p, back: () => openPlaceDetail(id) }) }, icon('download', 18), 'Mapa offline')
      ),
      fold('p:border', 'Granica', hasPoly(p) ? fmtHa(polyHa(p.poly)) : 'brak', borderBody),
      fold('p:note', 'Kontekst i notatki', p.note ? 'jest' : 'pusto', noteIn),
      fold(
        'p:maps',
        'Mapy historyczne',
        String(maps.length),
        mapRows,
        !maps.length && h('p', { class: 'hint' }, 'Dodaj skan starej mapy: ustawisz go na mapie dwoma punktami i zostanie przypisany do tego miejsca.'),
        h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => scanInput.click() }, icon('upload', 18), 'Dodaj mapę historyczną'), scanInput),
        attachMap && h('div', { class: 'field' }, attachMap)
      ),
      fold(
        'p:outs',
        'Wyjścia',
        String(outs.length),
        outs.length ? h('div', { class: 'list' }, outs.map(outingCard)) : h('p', { class: 'hint' }, 'Wyjścia rozpoczęte, gdy stoisz w granicy miejsca, przypisują się same. Pozostałe przypiszesz tutaj albo w karcie wyjścia.'),
        attachOut && h('div', { class: 'field' }, attachOut)
      ),
      fold('p:finds', 'Znaleziska', String(pins.length), pinListNode(pins.sort((x, y) => y.ts - x.ts), 'Brak znalezisk w wyjściach tego miejsca.')),
      fold('p:more', 'Więcej', '', delWrap)
    ],
    keepScroll,
    pencil
  );
}

/* ------------------------------------------------------------------ menu na mapie (przytrzymanie / prawy przycisk) */

function showMapMenu(ll) {
  if (S.picking || S.aligning || sheetOpen || S.ruler) return;
  const close = () => map.closePopup();
  const box = h(
    'div',
    { class: 'ctx' },
    h('div', { class: 'hint' }, `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`),
    h('button', { type: 'button', class: 'btn primary', onClick: () => { close(); addPlaceAt(ll); } }, icon('pin', 18), 'Dodaj miejsce tutaj'),
    h('button', { type: 'button', class: 'btn', onClick: () => { close(); openForm(null, { lat: ll.lat, lng: ll.lng, acc: null, src: 'pick' }); } }, icon('plus', 18), 'Dodaj znalezisko tutaj'),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onClick: () => { close(); startRuler(ll); } }, icon('ruler', 18), 'Linijka'),
      h('button', { type: 'button', class: 'btn', onClick: () => { close(); startNav(ll.lat, ll.lng, 'Punkt na mapie'); } }, icon('locate', 18), 'Kompas'),
      h('a', { class: 'btn', href: `geo:${ll.lat},${ll.lng}?q=${ll.lat},${ll.lng}` }, icon('nav', 18), 'Nawiguj'),
      h('button', { type: 'button', class: 'btn', onClick: () => { close(); copyText(fmtLL(ll.lat, ll.lng), 'Skopiowano współrzędne.'); } }, icon('copy', 18), 'Kopiuj')
    )
  );
  L.popup({ closeButton: false, className: 'ctx-popup', minWidth: 200 }).setLatLng(ll).setContent(box).openOn(map);
}


/* ------------------------------------------------------------------ linijka i kompas do celu */

const fmtAz = (a) => `${String(Math.round(a) % 360).padStart(3, '0')}°`;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dirName = (a) => COMPASS[Math.round(a / 45) % 8];

S.ruler = null;
function startRuler(first) {
  if (S.ruler) endRuler();
  const line = L.polyline([], { color: '#e8590c', weight: 4, opacity: 0.9, interactive: false }).addTo(map);
  const marks = L.layerGroup().addTo(map);
  S.ruler = { pts: [], line, marks };
  document.body.classList.add('ruling');
  $('#crosshair').hidden = false;
  rulerBar();
  if (first) {
    map.panTo(first);
    addRulerPoint(first);
  }
  rulerBar();
}
function addRulerPoint(ll) {
  const r = S.ruler;
  if (!r) return;
  r.pts.push([ll.lat, ll.lng]);
  r.line.setLatLngs(r.pts);
  L.circleMarker([ll.lat, ll.lng], { radius: 5, color: '#fff', weight: 2, fillColor: '#e8590c', fillOpacity: 1, interactive: false }).addTo(r.marks);
  rulerBar();
}
function endRuler() {
  const r = S.ruler;
  if (!r) return;
  map.removeLayer(r.line);
  map.removeLayer(r.marks);
  S.ruler = null;
  document.body.classList.remove('ruling');
  $('#crosshair').hidden = true;
  $('#rulerbar').hidden = true;
}
function rulerBar() {
  const r = S.ruler;
  let bar = $('#rulerbar');
  if (!bar) {
    bar = h('div', { id: 'rulerbar', class: 'toolbar' });
    document.body.append(bar);
  }
  bar.hidden = false;
  const pts = r.pts;
  const total = pathLength(pts);
  const n = pts.length;
  const last = n > 1 ? haversine(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1]) : 0;
  const az = n > 1 ? bearing(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1]) : null;
  bar.replaceChildren(
    h(
      'div',
      { class: 'tb-info' },
      h('strong', null, n > 1 ? `Razem ${fmtDist(total)}` : n ? 'Dodaj kolejny punkt' : 'Ustaw celownik i dodaj punkt'),
      n > 1 && h('span', null, `ostatni odcinek ${fmtDist(last)} · azymut ${fmtAz(az)} ${dirName(az)} · punktów: ${n}`)
    ),
    h(
      'div',
      { class: 'tb-row' },
      h('button', { type: 'button', class: 'btn primary', onClick: () => addRulerPoint(map.getCenter()) }, icon('plus', 18), 'Punkt'),
      S.fix && h('button', { type: 'button', class: 'btn', onClick: () => addRulerPoint(L.latLng(S.fix.lat, S.fix.lng)) }, 'Ja'),
      h('button', { type: 'button', class: 'btn', disabled: n ? null : true, onClick: () => { pts.pop(); r.line.setLatLngs(pts); const ms = r.marks.getLayers(); if (ms.length) r.marks.removeLayer(ms[ms.length - 1]); rulerBar(); } }, 'Cofnij'),
      n > 0 && h('button', { type: 'button', class: 'btn', onClick: () => { const q = pts[n - 1]; endRuler(); startNav(q[0], q[1], 'Koniec linijki'); } }, 'Kompas'),
      h('button', { type: 'button', class: 'btn', onClick: endRuler }, 'Zamknij')
    )
  );
}

/* kompas: azymut i odległość do celu + strzałka względem tego, w którą stronę patrzy telefon */
S.nav = null;
let heading = null;
let compassOn = false;
function onOrient(e) {
  let hd = null;
  if (typeof e.webkitCompassHeading === 'number') hd = e.webkitCompassHeading;
  else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) hd = (360 - e.alpha) % 360;
  if (hd == null) return;
  heading = heading == null ? hd : (heading + ((((hd - heading) % 360) + 540) % 360 - 180) * 0.25 + 360) % 360;
  updateNav();
}
async function enableCompass() {
  if (compassOn) return;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return;
    }
  } catch (e) {
    return;
  }
  compassOn = true;
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}
function startNav(lat, lng, name) {
  S.nav = { lat, lng, name, line: S.nav ? S.nav.line : null };
  if (!S.nav.line) S.nav.line = L.polyline([], { color: '#1971c2', weight: 3, dashArray: '6 6', interactive: false }).addTo(map);
  enableCompass();
  navHud();
  if (!S.fix) toast('Czekam na GPS, azymut pokaże się po złapaniu pozycji.', 3500);
  updateNav();
}
function endNav() {
  if (!S.nav) return;
  map.removeLayer(S.nav.line);
  S.nav = null;
  $('#navhud').hidden = true;
}
function navHud() {
  let hud = $('#navhud');
  if (!hud) {
    hud = h('div', { id: 'navhud', class: 'toolbar navhud' },
      h('div', { class: 'arrow-wrap' }, h('div', { id: 'nav-arrow', class: 'nav-arrow' }, icon('nav', 36))),
      h('div', { class: 'tb-info' }, h('strong', { id: 'nav-az' }), h('span', { id: 'nav-dist' }), h('span', { id: 'nav-hint', class: 'hint' })),
      h('button', { type: 'button', class: 'btn', onClick: endNav }, 'Zakończ')
    );
    document.body.append(hud);
  }
  hud.hidden = false;
}
function updateNav() {
  const n = S.nav;
  if (!n) return;
  const hud = $('#navhud');
  if (!hud) return;
  if (!S.fix) {
    $('#nav-az').textContent = n.name;
    $('#nav-dist').textContent = 'Brak pozycji GPS';
    $('#nav-hint').textContent = '';
    return;
  }
  const az = bearing(S.fix.lat, S.fix.lng, n.lat, n.lng);
  const d = haversine(S.fix.lat, S.fix.lng, n.lat, n.lng);
  n.line.setLatLngs([[S.fix.lat, S.fix.lng], [n.lat, n.lng]]);
  $('#nav-az').textContent = `${n.name}: azymut ${fmtAz(az)} ${dirName(az)}`;
  $('#nav-dist').textContent = d < 3 ? 'Jesteś na miejscu' : `Odległość ${fmtDist(d)}`;
  const arrow = $('#nav-arrow');
  if (heading != null) {
    arrow.style.transform = `rotate(${Math.round(az - heading)}deg)`;
    $('#nav-hint').textContent = `Telefon patrzy na ${fmtAz(heading)} ${dirName(heading)}. Trzymaj płasko, z dala od wykrywacza i metalu.`;
  } else {
    arrow.style.transform = `rotate(${Math.round(az)}deg)`;
    $('#nav-hint').textContent = 'Brak czujnika kierunku: strzałka pokazuje azymut względem północy. Idź według kompasu.';
  }
}

/* ------------------------------------------------------------------ dane testowe */

// Przykładowa wyprawa do diagnozowania na czas testów: trasa i znaleziska wokół środka mapy.
async function addDemoOuting() {
  const c = map.getCenter();
  const now = Date.now();
  const start = now - 2 * 3600e3;
  const o = { id: store.uid(), name: '[TEST] Przykładowa wyprawa', start, end: now - 10 * 60e3, open: false, track: true, note: 'Dane testowe, do usunięcia w Menu.', demo: true };
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((c.lat * Math.PI) / 180);
  let x = 0;
  let y = 0;
  let dir = Math.random() * Math.PI * 2;
  const pts = [];
  let dist = 0;
  for (let i = 0; i < 150; i++) {
    dir += (Math.random() - 0.5) * 0.9;
    const step = 7 + Math.random() * 6;
    const nx = x + Math.cos(dir) * step;
    const ny = y + Math.sin(dir) * step;
    if (Math.hypot(nx, ny) > 450) dir += Math.PI * 0.8; // wracamy w stronę środka
    else {
      x = nx;
      y = ny;
    }
    pts.push([c.lat + y / mPerLat, c.lng + x / mPerLng, start + i * 36e3, 3 + Math.round(Math.random() * 6)]);
    if (i) dist += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  const t = { id: store.uid(), outing: o.id, name: o.name, start, end: o.end, pts, dist, open: false, demo: true };
  const samples = [
    ['coin', 12, 'piasek', 'czysty, wysoki', 'Moneta, ok. 18 mm, awers nieczytelny.'],
    ['coin', 8, 'ściółka leśna', 'wysoki', 'Półtorak? Do oczyszczenia i oceny.'],
    ['ammo', 25, 'piasek', 'niski, ostry', 'Łuska karabinowa, kaliber ok. 7,92.'],
    ['weapon', 30, 'glina', 'średni, szeroki', 'Fragment okucia, możliwy element broni.'],
    ['uniform', 15, 'ściółka leśna', 'średni', 'Guzik mundurowy z orłem, bez nici.'],
    ['tool', 20, 'ziemia orna', 'niski', 'Fragment podkowy.'],
    ['jewel', 6, 'piasek', 'bardzo wysoki', 'Pierścionek z blaszki, bez próby.'],
    ['other', null, 'inne', '', 'Sygnał bez wykopu, do sprawdzenia.']
  ];
  const pins = samples.map(([cat, depth, soil, signal, notes], k) => {
    const q = pts[Math.floor(((k + 0.5) * pts.length) / samples.length)];
    return {
      id: store.uid(),
      lat: q[0] + (Math.random() - 0.5) * 0.00004,
      lng: q[1] + (Math.random() - 0.5) * 0.00006,
      acc: 4,
      src: 'gps',
      ts: q[2] + 20e3,
      cat,
      depth,
      soil,
      signal,
      notes,
      hazard: cat === 'ammo',
      photos: [],
      outing: o.id,
      demo: true,
      updated: now
    };
  });
  try {
    await store.put('outings', o);
    await store.put('tracks', t);
    for (const p of pins) await store.put('pins', p);
  } catch (e) {
    toast('Nie udało się zapisać danych testowych.', 5000);
    return;
  }
  S.outings.set(o.id, o);
  S.tracks.set(t.id, t);
  for (const p of pins) S.pins.set(p.id, p);
  renderTrack(t);
  for (const p of pins) renderPin(p);
  map.fitBounds(L.latLngBounds(pts.map((q) => [q[0], q[1]])), { padding: [30, 30] });
  closeSheet();
  toast('Dodano przykładową wyprawę: trasa i 8 znalezisk.', 4000);
}

async function removeDemoData() {
  const demo = [...S.outings.values()].filter((o) => o.demo);
  for (const o of demo) await deleteOuting(o);
  toast(demo.length ? 'Usunięto dane testowe.' : 'Brak danych testowych.');
  openMenu(true);
}

/* ------------------------------------------------------------------ przypomnienie o kopii */

function backupReminder() {
  if (!S.pins.size) return;
  const last = LS.get('lastBackup', 0) || 0;
  const asked = LS.get('backupAsked', 0) || 0;
  const day = 24 * 3600e3;
  if (Date.now() - last > 7 * day && Date.now() - asked > day) {
    LS.set('backupAsked', Date.now());
    setTimeout(() => toast('Minął tydzień od ostatniej kopii zapasowej. Menu → Kopia zapasowa.', 7000), 2500);
  }
}

/* ------------------------------------------------------------------ podpięcie przycisków i start */

$('#btn-list').addEventListener('click', () => (S.outing ? openOutingDetail(S.outing.id) : openOutings()));
$('#btn-add').addEventListener('click', () => (S.outing ? openForm(null) : openNewOuting()));
$('#btn-rec').addEventListener('click', togglePause);
$('#filter-clear').addEventListener('click', () => applyFilter(null));
$('#btn-layers').addEventListener('click', () => openLayers());
$('#btn-places').addEventListener('click', () => openPlaces());
$('#btn-nmt').addEventListener('click', toggleNmt);
$('#btn-hist').addEventListener('click', toggleHist);
$('#btn-curtain').addEventListener('click', toggleCurtain);
$('#btn-menu').addEventListener('click', () => openMenu());
$('#btn-locate').addEventListener('click', onLocate);
$('#gps-chip').addEventListener('click', onChip);

const outingPinsOf = (pins, id) => (pins || []).filter((p) => p.outing === id);

async function boot() {
  applyLayers();
  updateChip();
  updateBar();
  updateLocateBtn();
  try {
    const [pins, tracks, outings, maps, places] = await Promise.all([store.getAll('pins'), store.getAll('tracks'), store.getAll('outings'), store.getAll('maps'), store.getAll('places')]);
    for (const q of places || []) {
      normalizePlace(q);
      S.places.set(q.id, q);
      renderPlace(q);
    }
    for (const r of maps || []) S.maps.set(r.id, r);
    syncMapDefs();
    applyLayers();
    for (const o of outings || []) S.outings.set(o.id, o);
    for (const p of pins || []) S.pins.set(p.id, p);

    // Wyjście przerwane (zamknięta aplikacja) wznawiamy; zbyt stare zamykamy samodzielnie.
    const wanted = LS.get('activeOuting', null);
    const openOs = [...S.outings.values()].filter((o) => o.open).sort((a, b) => b.start - a.start);
    const act = openOs.find((o) => o.id === wanted) || openOs[0] || null;
    const lastActivity = (o) => {
      const ts = [o.start, ...outingPinsOf(pins, o.id).map((p) => p.ts)];
      for (const t of tracks || []) if (t.outing === o.id) ts.push(t.pts.length ? t.pts[t.pts.length - 1][2] : t.start);
      return Math.max(...ts);
    };
    let resume = null;
    for (const o of openOs) {
      const last = lastActivity(o);
      if (o === act && Date.now() - last < 12 * 3600e3) continue;
      o.open = false;
      o.end = last;
      store.put('outings', o).catch(() => {});
      if (o === act) toast('Poprzednie wyjście zakończono automatycznie.', 5000);
    }
    S.outing = act && act.open ? act : null;

    for (const t of tracks || []) {
      if (S.outing && t.outing === S.outing.id && t.open) {
        resume = t;
        continue;
      }
      if (t.open) {
        // Trasa przerwana: odzyskujemy to, co zapisano.
        t.open = false;
        if (!t.end) t.end = t.pts.length ? t.pts[t.pts.length - 1][2] : t.start;
        if (t.pts.length >= 2) store.put('tracks', t).catch(() => {});
      }
      if (t.pts && t.pts.length >= 2) S.tracks.set(t.id, t);
    }
    await adoptOrphans();
    for (const p of S.pins.values()) renderPin(p);
    for (const t of S.tracks.values()) renderTrack(t);
    backupReminder();
    if (S.outing) {
      LS.set('activeOuting', S.outing.id);
      startGps();
      if (S.outing.track) startRec(S.outing, resume || undefined);
      toast(`Trwa wyjście „${S.outing.name}”.`, 4000);
    } else {
      LS.set('activeOuting', null);
    }
    updateBar();
    // porządki: zdjęcia nieprzypisane do znaleziska ani do szkicu
    const sv = LS.get('draft', null);
    const keep = new Set([...S.pins.values()].flatMap((p) => p.photos || []));
    if (sv && Array.isArray(sv.photos)) sv.photos.forEach((id) => keep.add(id));
    for (const ph of await store.getAll('photos')) if (!keep.has(ph.id)) store.del('photos', ph.id).catch(() => {});
    if (sv && sv.loc) {
      if (await restoreDraft(sv)) toast('Przywrócono niezapisane znalezisko.', 4000);
    }
  } catch (e) {
    toast('Pamięć lokalna niedostępna. Dane nie zostaną zachowane.', 7000);
  }
  if (store.isMemoryOnly()) toast('Uwaga: ta przeglądarka nie daje trwałej pamięci. Dane znikną po zamknięciu.', 8000);

  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state === 'granted') startGps();
    st.onchange = () => {
      if (st.state === 'granted') startGps();
      else if (st.state === 'denied') setGps('err', 'Brak zgody na lokalizację');
    };
  } catch (e) {
    /* przeglądarka nie obsługuje zapytania o zgodę */
  }
  setInterval(updateChip, 5000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
window.__detektor = { S, map }; // do testów ręcznych w konsoli
