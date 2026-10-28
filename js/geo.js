// Narzędzia geograficzne: układ PL-1992 (EPSG:2180), zapis DMS, odległości.

const A = 6378137; // GRS80
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);

// WGS84 → PL-1992. Zwraca { x: północ, y: wschód } (konwencja Geoportalu: X to północ, Y to wschód).
export function toPuwg1992(lat, lng) {
  const phi = (lat * Math.PI) / 180;
  const lam = ((lng - 19) * Math.PI) / 180;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const AA = lam * c;
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const M =
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));
  const k0 = 0.9993;
  const east =
    k0 *
    N *
    (AA +
      ((1 - T + C) * AA ** 3) / 6 +
      ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * AA ** 5) / 120);
  const north =
    k0 *
    (M +
      N *
        t *
        ((AA * AA) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * AA ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * AA ** 6) / 720));
  return { x: north - 5300000, y: east + 500000 };
}

function dms(v, pos, neg) {
  const hemi = v >= 0 ? pos : neg;
  let a = Math.abs(v);
  let d = Math.floor(a);
  let m = Math.floor((a - d) * 60);
  let s = ((a - d) * 60 - m) * 60;
  if (s >= 59.995) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(2).padStart(5, '0')}″${hemi}`;
}

export function toDMS(lat, lng) {
  return `${dms(lat, 'N', 'S')} ${dms(lng, 'E', 'W')}`;
}

export function fmtLL(lat, lng) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  return d;
}

export function fmtDist(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1).replace('.', ',')} km`;
}

export function bearing(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}
