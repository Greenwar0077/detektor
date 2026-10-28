// Eksport i import danych: GeoJSON, GPX, kopia zapasowa JSON (ze zdjęciami).

import { catLabel, isCat } from './data.js';
import { pathLength } from './geo.js';

const iso = (ts) => new Date(ts).toISOString();

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toGeoJSON(pins, tracks) {
  const features = [];
  for (const p of pins) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        kind: 'find',
        outing: p.outing || null,
        category: catLabel(p.cat),
        time: iso(p.ts),
        depth_cm: p.depth ?? null,
        soil: p.soil || null,
        detector_signal: p.signal || null,
        notes: p.notes || null,
        hazard: !!p.hazard,
        accuracy_m: p.acc ?? null,
        position_source: p.src === 'gps' ? 'gps' : 'map',
        photo_count: (p.photos || []).length
      }
    });
  }
  for (const t of tracks) {
    if (!t.pts || t.pts.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: t.pts.map((q) => [q[1], q[0]]) },
      properties: {
        id: t.id,
        kind: 'track',
        outing: t.outing || null,
        name: t.name,
        start: iso(t.start),
        end: t.end ? iso(t.end) : null,
        length_m: Math.round(t.dist ?? pathLength(t.pts))
      }
    });
  }
  return { type: 'FeatureCollection', name: 'detektor', features };
}

export function toGPX(pins, tracks) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<gpx version="1.1" creator="Detektor" xmlns="http://www.topografix.com/GPX/1/1">'
  );
  out.push(`<metadata><name>Detektor</name><time>${iso(Date.now())}</time></metadata>`);
  for (const p of pins) {
    const desc = [
      p.notes || '',
      p.depth != null ? `głębokość ${p.depth} cm` : '',
      p.soil ? `podłoże: ${p.soil}` : '',
      p.signal ? `sygnał: ${p.signal}` : '',
      p.hazard ? 'NIEBEZPIECZNE' : ''
    ]
      .filter(Boolean)
      .join('; ');
    out.push(`<wpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">`);
    out.push(`<time>${iso(p.ts)}</time>`);
    out.push(`<name>${esc((p.hazard ? '! ' : '') + catLabel(p.cat))}</name>`);
    if (desc) out.push(`<desc>${esc(desc)}</desc>`);
    out.push('</wpt>');
  }
  for (const t of tracks) {
    if (!t.pts || t.pts.length < 2) continue;
    out.push(`<trk><name>${esc(t.name)}</name><trkseg>`);
    for (const q of t.pts) {
      out.push(
        `<trkpt lat="${q[0].toFixed(7)}" lon="${q[1].toFixed(7)}"><time>${iso(q[2])}</time></trkpt>`
      );
    }
    out.push('</trkseg></trk>');
  }
  out.push('</gpx>');
  return out.join('\n');
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function makeBackup(pins, tracks, photos, outings = [], places = []) {
  const ph = [];
  for (const p of photos) {
    ph.push({ id: p.id, ts: p.ts, dataUrl: await blobToDataURL(p.blob) });
  }
  return JSON.stringify({
    format: 'detektor-backup',
    version: 2,
    exported: iso(Date.now()),
    outings,
    places,
    pins,
    tracks,
    photos: ph
  });
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Plik z zewnątrz traktujemy jako niezaufany: sprawdzamy i oczyszczamy każde pole.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('to nie jest poprawny plik JSON');
  }
  if (!data || data.format !== 'detektor-backup' || !Array.isArray(data.pins)) {
    throw new Error('to nie jest kopia zapasowa Detektora');
  }
  const pins = [];
  for (const p of data.pins) {
    if (!p || typeof p.id !== 'string') continue;
    const lat = num(p.lat);
    const lng = num(p.lng);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    pins.push({
      id: p.id.slice(0, 80),
      lat,
      lng,
      acc: num(p.acc),
      src: p.src === 'gps' ? 'gps' : 'map',
      ts: num(p.ts) ?? Date.now(),
      cat: isCat(p.cat) ? p.cat : 'other',
      depth: num(p.depth),
      soil: str(p.soil, 80),
      signal: str(p.signal, 80),
      notes: str(p.notes, 5000),
      hazard: !!p.hazard,
      photos: Array.isArray(p.photos) ? p.photos.filter((x) => typeof x === 'string').slice(0, 40) : [],
      outing: str(p.outing, 80) || null,
      updated: num(p.updated) ?? Date.now()
    });
  }
  const tracks = [];
  for (const t of Array.isArray(data.tracks) ? data.tracks : []) {
    if (!t || typeof t.id !== 'string' || !Array.isArray(t.pts)) continue;
    const pts = t.pts
      .filter((q) => Array.isArray(q) && num(q[0]) != null && num(q[1]) != null)
      .map((q) => [q[0], q[1], num(q[2]) ?? 0, num(q[3]) ?? 0]);
    if (pts.length < 2) continue;
    tracks.push({
      id: t.id.slice(0, 80),
      name: str(t.name, 120) || 'Ślad',
      start: num(t.start) ?? pts[0][2],
      end: num(t.end) ?? pts[pts.length - 1][2],
      dist: num(t.dist) ?? pathLength(pts),
      open: false,
      outing: str(t.outing, 80) || null,
      pts
    });
  }
  const photos = [];
  for (const ph of Array.isArray(data.photos) ? data.photos : []) {
    if (!ph || typeof ph.id !== 'string') continue;
    if (typeof ph.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(ph.dataUrl)) continue;
    photos.push({ id: ph.id.slice(0, 80), ts: num(ph.ts) ?? Date.now(), dataUrl: ph.dataUrl });
  }
  const outings = [];
  for (const o of Array.isArray(data.outings) ? data.outings : []) {
    if (!o || typeof o.id !== 'string') continue;
    const start = num(o.start) ?? Date.now();
    outings.push({
      id: o.id.slice(0, 80),
      name: str(o.name, 80) || 'Wyjście',
      start,
      end: num(o.end) ?? start,
      open: false,
      track: !!o.track,
      quick: !!o.quick,
      legacy: !!o.legacy,
      note: str(o.note, 3000),
      place: str(o.place, 80) || null
    });
  }
  const places = [];
  for (const q of Array.isArray(data.places) ? data.places : []) {
    if (!q || typeof q.id !== 'string' || !Array.isArray(q.poly)) continue;
    const poly = q.poly.filter((c) => Array.isArray(c) && num(c[0]) !== null && num(c[1]) !== null).map((c) => [c[0], c[1]]);
    if (poly.length < 3) continue;
    places.push({
      id: q.id.slice(0, 80),
      name: str(q.name, 80) || 'Miejsce',
      poly,
      note: str(q.note, 5000),
      status: ['todo', 'plan', 'done', 'dry'].includes(q.status) ? q.status : 'todo',
      priority: Math.min(5, Math.max(1, Math.round(num(q.priority) ?? 3))),
      created: num(q.created) ?? Date.now(),
      updated: num(q.updated) ?? Date.now()
    });
  }
  return { pins, tracks, photos, outings, places };
}
