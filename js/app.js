// Detektor: mapa, GPS, znaleziska ze zdjęciami, ślady. Wszystko działa lokalnie w telefonie.
import { CONFIG } from '../config.js';
import * as store from './store.js';
import { toPuwg1992, toDMS, fmtLL, haversine, fmtDist } from './geo.js';
import { CATEGORIES, SOILS, catLabel } from './data.js';
import { toGeoJSON, toGPX, makeBackup, parseBackup } from './exporters.js';

const VERSION = '0.1.0';
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
const defaultTrackName = (ts) => `Ślad ${fmtDateTime(ts)}`;

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
  settings: { showTracks: LS.get('showTracks', true), keepAwake: LS.get('keepAwake', false) },
  diag: {},
  warned: new Set()
};

/* ------------------------------------------------------------------ statyczny interfejs */

$('#btn-locate').append(icon('locate'));
$('#btn-layers').append(icon('layers'));
$('#btn-menu').append(icon('menu'));
$('#sheet-close').append(icon('close'));
$('#viewer-close').append(icon('close'));
$('#btn-list').append(icon('list', 20), h('span', null, 'Lista'));
$('#btn-add').append(icon('plus', 24), h('span', null, 'Znalezisko'));
$('#btn-rec').append(h('span', { class: 'rec-dot' }), h('span', { id: 'rec-label' }, 'Ślad'));

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
// Długie przytrzymanie mapy: dodaj znalezisko w tym miejscu.
map.on('contextmenu', (e) => {
  if (S.picking) return;
  openForm(null, { lat: e.latlng.lat, lng: e.latlng.lng, acc: null, src: 'pick' });
});

const ALL_DEFS = [
  ...CONFIG.base.map((d) => ({ ...d, kind: 'base' })),
  ...CONFIG.overlays.map((d) => ({ ...d, kind: 'overlay' })),
  ...(CONFIG.historical || []).map((d) => ({ ...d, kind: 'hist' }))
];
const layerObjs = new Map();
const layerState = Object.assign({ base: CONFIG.base[0].id, on: {}, opacity: {} }, LS.get('layers', {}));
if (!CONFIG.base.some((b) => b.id === layerState.base)) layerState.base = CONFIG.base[0].id;

function makeLayer(def) {
  const o = {
    attribution: def.attribution,
    maxZoom: def.maxZoom || CONFIG.maxZoom || 20,
    opacity: layerState.opacity[def.id] ?? def.opacity ?? 1,
    zIndex: def.kind === 'base' ? 1 : def.kind === 'overlay' ? 10 : 20
  };
  if (def.maxNativeZoom) o.maxNativeZoom = def.maxNativeZoom;
  if (def.minZoom) o.minZoom = def.minZoom;
  let layer;
  if (def.type === 'wms') {
    layer = L.tileLayer.wms(def.url, {
      ...o,
      layers: def.layers,
      styles: def.styles || '',
      format: def.format || 'image/png',
      transparent: !!def.transparent,
      version: def.version || '1.1.1'
    });
  } else if (def.type === 'image') {
    layer = L.imageOverlay(def.url, def.bounds, o);
  } else {
    layer = L.tileLayer(def.url, { ...o, tms: !!def.tms, bounds: def.bounds });
  }
  S.diag[def.id] = { ok: 0, err: 0 };
  if (def.type !== 'image') {
    layer.on('tileload', () => {
      S.diag[def.id].ok++;
    });
    layer.on('tileerror', () => {
      const d = S.diag[def.id];
      d.err++;
      if (d.ok === 0 && d.err >= 4 && navigator.onLine !== false && !S.warned.has(def.id)) {
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
    const want = def.kind === 'base' ? layerState.base === def.id : !!layerState.on[def.id];
    const existing = layerObjs.get(def.id);
    if (want) {
      const l = getLayer(def);
      if (!map.hasLayer(l)) l.addTo(map);
    } else if (existing && map.hasLayer(existing)) {
      map.removeLayer(existing);
    }
  }
  LS.set('layers', layerState);
}

/* ------------------------------------------------------------------ znaczniki i ślady na mapie */

const pinsGroup = L.layerGroup().addTo(map);
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

function renderPin(p) {
  const old = S.markers.get(p.id);
  if (old) pinsGroup.removeLayer(old);
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
  if (!t.pts || t.pts.length < 2) return;
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

/* ------------------------------------------------------------------ nagrywanie śladu */

function updateRecUI() {
  const b = $('#btn-rec');
  const rec = !!S.rec;
  b.classList.toggle('recording', rec);
  $('#rec-label').textContent = rec ? `Stop · ${fmtDist(S.rec.t.dist)}` : 'Ślad';
  b.setAttribute('aria-label', rec ? 'Zatrzymaj nagrywanie śladu' : 'Nagrywaj ślad');
}

function startRec() {
  startGps();
  const t = { id: store.uid(), name: '', start: Date.now(), end: null, pts: [], dist: 0, open: true };
  S.rec = {
    t,
    line: L.polyline([], { color: '#e8832a', weight: 4, opacity: 0.95 }).addTo(map),
    lastSaved: 0
  };
  acquireWake();
  updateRecUI();
  toast('Nagrywam ślad. Trzymaj ekran włączony: GPS w przeglądarce zwykle nie działa przy wygaszonym.', 5000);
}

function recordPoint() {
  const f = S.fix;
  const t = S.rec.t;
  if (!f || f.acc > 40) return;
  const last = t.pts[t.pts.length - 1];
  if (last) {
    const d = haversine(last[0], last[1], f.lat, f.lng);
    if (d < 3) return;
    t.dist += d;
  }
  t.pts.push([f.lat, f.lng, f.ts, Math.round(f.acc)]);
  S.rec.line.addLatLng([f.lat, f.lng]);
  updateRecUI();
  if (t.pts.length - S.rec.lastSaved >= 15) {
    S.rec.lastSaved = t.pts.length;
    store.put('tracks', { ...t, name: t.name || defaultTrackName(t.start) }).catch(() => {});
  }
}

async function stopRec() {
  const { t, line } = S.rec;
  S.rec = null;
  map.removeLayer(line);
  releaseWake();
  updateRecUI();
  t.end = Date.now();
  t.open = false;
  t.name = t.name || defaultTrackName(t.start);
  if (t.pts.length >= 2) {
    try {
      await store.put('tracks', t);
    } catch (e) {
      toast('Nie udało się zapisać śladu.', 5000);
    }
    S.tracks.set(t.id, t);
    renderTrack(t);
    toast(`Zapisano ślad: ${fmtDist(t.dist)}.`);
  } else {
    store.del('tracks', t.id).catch(() => {});
    toast('Ślad za krótki, odrzucono.');
  }
}

function toggleRec() {
  if (S.rec) stopRec();
  else startRec();
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

function openSheet(title, nodes, keepScroll = false) {
  const top = keepScroll ? sheetBody.scrollTop : 0;
  releaseUrls();
  sheetTitle.textContent = title;
  sheetBody.replaceChildren(...[].concat(nodes).filter(Boolean));
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
  if (d && d.isNew && (d.add.length || d.notes.trim())) toast('Niezapisane znalezisko odrzucono.', 3500);
  sheetEl.hidden = true;
  backdrop.hidden = true;
  document.body.classList.remove('sheet-open');
  sheetOpen = false;
  releaseUrls();
  cleanupDraft();
  sheetBody.replaceChildren();
}

function closeSheet() {
  if (sheetOpen) history.back();
  else hideSheet();
}

$('#sheet-close').addEventListener('click', closeSheet);
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

function cleanupDraft() {
  const d = S.draft;
  if (!d) return;
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

function srcLabel(l) {
  if (l.src === 'gps') return `GPS${l.acc != null ? ` ±${Math.round(l.acc)} m` : ''}`;
  if (l.src === 'pick') return 'Wskazane na mapie';
  return 'Środek mapy';
}

function renderLoc() {
  const d = S.draft;
  if (!d) return;
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

async function addPhotos(files) {
  const d = S.draft;
  if (!d) return;
  for (const f of files) {
    if (d.keep.length + d.add.length >= 12) {
      toast('Maksymalnie 12 zdjęć przy jednym znalezisku.');
      break;
    }
    d.busy++;
    refreshSave();
    try {
      const blob = await resizeImage(f);
      if (S.draft !== d) return;
      d.add.push({ id: store.uid(), blob, url: URL.createObjectURL(blob) });
      renderThumbs();
    } catch (e) {
      toast('Nie udało się przetworzyć zdjęcia.');
    } finally {
      d.busy--;
      refreshSave();
    }
  }
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
        h('button', { type: 'button', class: 'btn', onClick: () => camInput.click() }, icon('camera', 18), 'Zrób zdjęcie'),
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
    updated: Date.now()
  };
  try {
    for (const a of d.add) await store.put('photos', { id: a.id, blob: a.blob, ts: Date.now() });
    await store.put('pins', p);
    for (const id of d.removed) await store.del('photos', id);
  } catch (e) {
    toast('Nie udało się zapisać. Czy w telefonie jest wolne miejsce?', 6000);
    return;
  }
  const wasNew = d.isNew;
  S.pins.set(p.id, p);
  renderPin(p);
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

function openList() {
  const pins = [...S.pins.values()].sort((a, b) => b.ts - a.ts);
  let body;
  if (!pins.length) {
    body = h('p', { class: 'hint' }, 'Brak znalezisk. Dotknij „Znalezisko”, żeby dodać pierwsze. Możesz też przytrzymać palec na mapie.');
  } else {
    body = h(
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
  openSheet(`Znaleziska (${pins.length})`, body);
}

/* ------------------------------------------------------------------ warstwy */

function overlayRow(def) {
  const on = !!layerState.on[def.id];
  const op = layerState.opacity[def.id] ?? def.opacity ?? 1;
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'opt',
      'aria-pressed': String(on),
      onClick: () => {
        layerState.on[def.id] = !on;
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
    on && h('label', { class: 'hint' }, 'Przezroczystość', slider)
  );
}

function openLayers(keepScroll = false) {
  const base = CONFIG.base.map((def) =>
    h(
      'button',
      {
        type: 'button',
        class: 'radio-row',
        role: 'radio',
        'aria-checked': String(layerState.base === def.id),
        onClick: () => {
          layerState.base = def.id;
          applyLayers();
          openLayers(true);
        }
      },
      h('span', { class: 'mark' }),
      def.name
    )
  );
  const hist = (CONFIG.historical || []).map((d) => overlayRow({ ...d, kind: 'hist' }));
  openSheet(
    'Warstwy mapy',
    [
      h('div', { class: 'section' }, h('h3', null, 'Podkład'), h('div', { role: 'radiogroup', class: 'section' }, base)),
      h('div', { class: 'section' }, h('h3', null, 'Nakładki'), CONFIG.overlays.map((d) => overlayRow({ ...d, kind: 'overlay' }))),
      h(
        'div',
        { class: 'section' },
        h('h3', null, 'Mapy historyczne'),
        hist.length
          ? hist
          : h(
              'p',
              { class: 'hint' },
              'Brak map historycznych. Po georeferencji dodasz je w pliku config.js (instrukcja w README, krok 5).'
            )
      )
    ],
    keepScroll
  );
}

/* ------------------------------------------------------------------ menu: dane, ślady, ustawienia */

async function exportGeoJSON() {
  const text = JSON.stringify(toGeoJSON([...S.pins.values()], [...S.tracks.values()]), null, 1);
  download(`detektor-${stamp()}.geojson`, text, 'application/geo+json');
}
function exportGPX(onlyTrack) {
  const pins = onlyTrack ? [] : [...S.pins.values()];
  const tracks = onlyTrack ? [onlyTrack] : [...S.tracks.values()];
  download(`detektor-${stamp()}.gpx`, toGPX(pins, tracks), 'application/gpx+xml');
}
async function exportBackup() {
  try {
    const photos = await store.getAll('photos');
    const text = await makeBackup([...S.pins.values()], [...S.tracks.values()], photos);
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
  for (const p of data.pins) {
    await store.put('pins', p);
    S.pins.set(p.id, p);
    renderPin(p);
  }
  for (const t of data.tracks) {
    await store.put('tracks', t);
    S.tracks.set(t.id, t);
    renderTrack(t);
  }
  toast(`Zaimportowano: ${data.pins.length} znalezisk, ${data.tracks.length} śladów.`, 4000);
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
      `Plik zawiera: ${data.pins.length} znalezisk, ${data.photos.length} zdjęć, ${data.tracks.length} śladów. Dane zostaną scalone z obecnymi (ten sam identyfikator oznacza nadpisanie).`
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

function trackRow(t) {
  const wrap = h('div', { class: 'layer-row' });
  const actions = () =>
    wrap.replaceChildren(
      h('div', { class: 'top' }, h('strong', null, t.name), h('span', { class: 'hint' }, fmtDist(t.dist))),
      h(
        'div',
        { class: 'row-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () => {
              if (!S.settings.showTracks) {
                S.settings.showTracks = true;
                LS.set('showTracks', true);
                tracksGroup.addTo(map);
              }
              const line = S.trackLines.get(t.id);
              if (line) map.fitBounds(line.getBounds(), { padding: [40, 40] });
              closeSheet();
            }
          },
          'Pokaż'
        ),
        h('button', { type: 'button', class: 'btn', onClick: () => exportGPX(t) }, 'GPX'),
        h('button', { type: 'button', class: 'btn danger', onClick: confirmDel }, 'Usuń')
      )
    );
  const confirmDel = () =>
    wrap.replaceChildren(
      h('p', { class: 'hint' }, `Usunąć ślad „${t.name}”?`),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn', onClick: actions }, 'Anuluj'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn danger',
            onClick: async () => {
              await store.del('tracks', t.id).catch(() => {});
              S.tracks.delete(t.id);
              const line = S.trackLines.get(t.id);
              if (line) tracksGroup.removeLayer(line);
              S.trackLines.delete(t.id);
              openMenu(true);
            }
          },
          'Tak, usuń'
        )
      )
    );
  actions();
  return wrap;
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

async function openMenu(keepScroll = false) {
  const info = await store.storageInfo();
  const photoCount = [...S.pins.values()].reduce((n, p) => n + (p.photos ? p.photos.length : 0), 0);
  const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1).replace('.', ',');
  const last = LS.get('lastBackup', null);
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
  const tracks = [...S.tracks.values()].sort((a, b) => b.start - a.start);
  const diag = ALL_DEFS.filter((d) => layerObjs.has(d.id)).map((d) => {
    const x = S.diag[d.id] || { ok: 0, err: 0 };
    return h('div', { class: 'hint' }, `${d.name}: ${x.ok} kafelków OK, ${x.err} błędów`);
  });

  openSheet(
    'Dane i ustawienia',
    [
      h(
        'div',
        { class: 'section' },
        h('h3', null, 'Twoje dane'),
        h(
          'p',
          { class: 'hint' },
          `${S.pins.size} znalezisk · ${photoCount} zdjęć · ${S.tracks.size} śladów`,
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
      h(
        'div',
        { class: 'section' },
        h('h3', null, 'Eksport do innych programów'),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn', onClick: exportGeoJSON }, icon('download', 18), 'GeoJSON (QGIS)'),
          h('button', { type: 'button', class: 'btn', onClick: () => exportGPX() }, icon('download', 18), 'GPX')
        ),
        h('p', { class: 'hint' }, 'GeoJSON i GPX zawierają znaleziska i ślady, bez zdjęć.')
      ),
      h(
        'div',
        { class: 'section' },
        h('h3', null, `Ślady (${tracks.length})`),
        tracks.length ? tracks.map(trackRow) : h('p', { class: 'hint' }, 'Brak zapisanych śladów. Użyj przycisku „Ślad” na dole ekranu.')
      ),
      h(
        'div',
        { class: 'section' },
        h('h3', null, 'Ustawienia'),
        switchRow('Pokazuj zapisane ślady na mapie', 'showTracks', (on) => {
          if (on) tracksGroup.addTo(map);
          else map.removeLayer(tracksGroup);
        }),
        switchRow('Nie wygaszaj ekranu', 'keepAwake', (on) => {
          if (on) acquireWake();
          else releaseWake();
        })
      ),
      h('div', { class: 'section' }, h('h3', null, 'Diagnostyka warstw'), diag.length ? diag : h('p', { class: 'hint' }, 'Brak danych.')),
      h(
        'div',
        { class: 'section' },
        h('h3', null, 'O aplikacji'),
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

/* ------------------------------------------------------------------ podpięcie przycisków i start */

$('#btn-list').addEventListener('click', openList);
$('#btn-add').addEventListener('click', () => openForm(null));
$('#btn-rec').addEventListener('click', toggleRec);
$('#btn-layers').addEventListener('click', () => openLayers());
$('#btn-menu').addEventListener('click', () => openMenu());
$('#btn-locate').addEventListener('click', onLocate);
$('#gps-chip').addEventListener('click', onChip);

async function boot() {
  applyLayers();
  updateChip();
  updateRecUI();
  updateLocateBtn();
  try {
    const [pins, tracks] = await Promise.all([store.getAll('pins'), store.getAll('tracks')]);
    for (const p of pins || []) {
      S.pins.set(p.id, p);
      renderPin(p);
    }
    for (const t of tracks || []) {
      if (t.open) {
        // Ślad przerwany (np. zamknięcie aplikacji w trakcie nagrywania): odzyskujemy to, co zapisano.
        t.open = false;
        if (!t.end) t.end = t.pts.length ? t.pts[t.pts.length - 1][2] : t.start;
        if (t.pts.length >= 2) store.put('tracks', t).catch(() => {});
      }
      if (t.pts && t.pts.length >= 2) {
        S.tracks.set(t.id, t);
        renderTrack(t);
      }
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
