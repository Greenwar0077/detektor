// Warstwa kafelków WMTS w układzie PL-1992 (EPSG:2180) wyświetlana na mapie internetowej (EPSG:3857).
// Geoportal wystawia cieniowanie NMT tylko w siatce PL-1992, więc każdy kafelek mapy składamy
// z kafelków źródłowych, przeliczając współrzędne. Obrazy tylko rysujemy (bez odczytu pikseli),
// dlatego nie jest potrzebna zgoda CORS serwera.
import { toPuwg1992 } from './geo.js';
import { loadImageRetry } from './tilequeue.js';

const L = window.L;
const PIXEL_M = 0.00028; // rozmiar piksela w definicji skali WMTS
const ORIGIN_N = 850000; // TopLeftCorner: northing, easting (kolejność osi EPSG:2180)
const ORIGIN_E = 100000;
const SRC = 512; // rozmiar kafelka źródłowego

// poziom: [id w usłudze, mianownik skali, minKol, maxKol, minWiersz, maxWiersz] (z GetCapabilities)
const mk = (rows) => rows.map(([id, sd, c0, c1, r0, r1]) => ({ id, pix: sd * PIXEL_M, c0, c1, r0, r1 }));

// Cieniowanie NMT (ShadedRelief): numeracja poziomów zaczyna się od skali 1:7,56 mln.
const NMT_LEVELS = mk(
  [
    [7559538.928571429, 0, 0, 0, 0],
    [3779769.4642857146, 0, 1, 0, 1],
    [1889884.7321428573, 0, 2, 0, 2],
    [944942.3660714286, 0, 5, 0, 5],
    [472471.1830357143, 0, 11, 0, 10],
    [236235.59151785716, 1, 22, 1, 21],
    [94494.23660714286, 4, 56, 4, 53],
    [47247.11830357143, 9, 113, 9, 107],
    [23623.559151785714, 19, 227, 19, 214],
    [9449.423660714287, 47, 568, 47, 535],
    [4724.711830357143, 95, 1136, 95, 1070],
    [1889.8847321428573, 239, 2842, 239, 2675],
    [944.9423660714286, 479, 5684, 479, 5351]
  ].map((r, i) => [i, ...r])
);

// Ortofotomapa HR (ORTO/WMTS/HighResolution): poziomy 5-16, zakresy z GetCapabilities.
const HR_LEVELS = mk([
  [5, 944942.3660714286, 0, 44, 0, 119],
  [6, 472471.1830357143, 0, 88, 0, 238],
  [7, 236235.59151785716, 0, 177, 0, 476],
  [8, 94494.23660714286, 0, 444, 0, 1191],
  [9, 47247.11830357143, 0, 888, 0, 2383],
  [10, 23623.559151785714, 0, 1777, 0, 4767],
  [11, 9449.423660714287, 0, 4443, 0, 11918],
  [12, 4724.711830357143, 0, 8886, 0, 23836],
  [13, 1889.8847321428573, 0, 22216, 0, 59590],
  [14, 944.9423660714286, 0, 44432, 0, 119180],
  [15, 472.4711830357143, 0, 88864, 0, 238360],
  [16, 236.23559151785716, 0, 177728, 0, 476720]
]);

// tol: ile razy grubszy od ekranu może być piksel źródła (1 = nie gorszy niż ekran).
const PROFILES = {
  nmt: { levels: NMT_LEVELS, tol: 1.5 },
  hr: { levels: HR_LEVELS, tol: 1 }
};
const profileOf = (def) => PROFILES[def.profile] || PROFILES.nmt;

function pickLevel(prof, z, lat) {
  const target = (156543.03392804097 / Math.pow(2, z)) * Math.cos((lat * Math.PI) / 180);
  const L2 = prof.levels;
  for (let i = 0; i < L2.length; i++) {
    if (L2[i].pix <= target * prof.tol) return i;
  }
  return L2.length - 1;
}

// Punkt kafelka mapy (piksele u,v) -> współrzędne "globalne" siatki źródłowej danego poziomu.
function toGlobal(z, tx, ty, u, v, pix) {
  const ll = L.CRS.EPSG3857.pointToLatLng(L.point(tx * 256 + u, ty * 256 + v), z);
  const p = toPuwg1992(ll.lat, ll.lng); // x = northing, y = easting
  return { gx: (p.y - ORIGIN_E) / pix, gy: (ORIGIN_N - p.x) / pix };
}

function affine(d, g) {
  // d, g: po 3 punkty. Zwraca [a,b,c,d,e,f] dla canvas.setTransform (global -> piksele kafelka).
  const g1x = g[1].gx - g[0].gx;
  const g1y = g[1].gy - g[0].gy;
  const g2x = g[2].gx - g[0].gx;
  const g2y = g[2].gy - g[0].gy;
  const det = g1x * g2y - g2x * g1y;
  if (!det) return null;
  const d1x = d[1].x - d[0].x;
  const d1y = d[1].y - d[0].y;
  const d2x = d[2].x - d[0].x;
  const d2y = d[2].y - d[0].y;
  // A = D * G^-1, G = [[g1x g2x],[g1y g2y]]
  const A00 = (d1x * g2y - d2x * g1y) / det;
  const A01 = (d2x * g1x - d1x * g2x) / det;
  const A10 = (d1y * g2y - d2y * g1y) / det;
  const A11 = (d2y * g1x - d1y * g2x) / det;
  const e = d[0].x - (A00 * g[0].gx + A01 * g[0].gy);
  const f = d[0].y - (A10 * g[0].gx + A11 * g[0].gy);
  return [A00, A10, A01, A11, e, f];
}

function expand(tri, px) {
  const cx = (tri[0].x + tri[1].x + tri[2].x) / 3;
  const cy = (tri[0].y + tri[1].y + tri[2].y) / 3;
  return tri.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * px, y: p.y + (dy / len) * px };
  });
}

// mix 0 = sam podkład, ok. 0.5 = podkład z pełnym cieniowaniem terenu (mnożenie), 1 = sam LiDAR.
function compose(tile, mix) {
  const m = tile._mix;
  const out = tile.getContext('2d');
  out.clearRect(0, 0, tile.width, tile.height);
  if (m.underImg) out.drawImage(m.underImg, 0, 0, tile.width, tile.height);
  const mul = Math.min(1, mix * 2);
  const fade = Math.max(0, mix * 2 - 1);
  if (mul > 0) {
    out.save();
    out.globalCompositeOperation = m.underImg ? 'multiply' : 'source-over';
    out.globalAlpha = mul;
    out.drawImage(m.shade, 0, 0);
    out.restore();
  }
  if (fade > 0) {
    out.save();
    out.globalAlpha = fade;
    out.drawImage(m.shade, 0, 0);
    out.restore();
  }
}

const loadImage = (url) => loadImageRetry(url);

// Adres obrazu tła (ortofoto WMS albo kafelki XYZ) dla kafelka mapy.
function underUrl(under, z, tx, ty, px) {
  if (under.type === 'xyz') {
    return under.url.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
  }
  const res = 156543.03392804097 / Math.pow(2, z);
  const W = 20037508.342789244;
  const minx = -W + tx * 256 * res;
  const maxy = W - ty * 256 * res;
  const bbox = [minx, maxy - 256 * res, minx + 256 * res, maxy].join(',');
  return (
    `${under.url}?service=WMS&request=GetMap&version=1.1.1&layers=${encodeURIComponent(under.layers)}` +
    `&styles=&format=${encodeURIComponent(under.format || 'image/jpeg')}&transparent=false` +
    `&srs=EPSG:3857&bbox=${bbox}&width=${px}&height=${px}`
  );
}

// Które kafelki źródłowe (PL-1992) potrzebne są do narysowania kafelka mapy.
function plan(def, z, tx, ty) {
  const prof = profileOf(def);
  const center = L.CRS.EPSG3857.pointToLatLng(L.point(tx * 256 + 128, ty * 256 + 128), z);
  const li = pickLevel(prof, z, center.lat);
  const lv = prof.levels[li];
  const n = z >= 14 ? 1 : 4; // przy małych zoomach dzielimy kafelek na siatkę n×n
  const step = 256 / n;
  const dp = [];
  const gp = [];
  for (let j = 0; j <= n; j++) {
    dp.push([]);
    gp.push([]);
    for (let i = 0; i <= n; i++) {
      dp[j].push({ x: i * step, y: j * step });
      gp[j].push(toGlobal(z, tx, ty, i * step, j * step, lv.pix));
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const row of gp) {
    for (const p of row) {
      minX = Math.min(minX, p.gx);
      maxX = Math.max(maxX, p.gx);
      minY = Math.min(minY, p.gy);
      maxY = Math.max(maxY, p.gy);
    }
  }
  const c0 = Math.max(lv.c0, Math.floor(minX / SRC));
  const c1 = Math.min(lv.c1, Math.floor(maxX / SRC));
  const r0 = Math.max(lv.r0, Math.floor(minY / SRC));
  const r1 = Math.min(lv.r1, Math.floor(maxY / SRC));
  return { li, lv, n, dp, gp, c0, c1, r0, r1 };
}

const srcUrl = (def, li, row, col) =>
  `${def.url}?service=WMTS&request=GetTile&version=1.0.0&layer=${encodeURIComponent(def.layer)}` +
  `&style=default&format=${encodeURIComponent(def.format || 'image/jpeg')}` +
  `&TileMatrixSet=EPSG:2180&TileMatrix=EPSG:2180:${profileOf(def).levels[li].id}&TileRow=${row}&TileCol=${col}`;

// Rysuje na płótnie kafelek mapy (z,tx,ty) złożony ze źródłowych kafelków PL-1992 usługi `def`.
// Zwraca false, gdy nie udało się pobrać żadnego kafelka źródłowego.
async function warpInto(def, canvas, z, tx, ty, r) {
  const { li, n, dp, gp, c0, c1, r0, r1 } = plan(def, z, tx, ty);
  if (c1 < c0 || r1 < r0) return true; // poza zasięgiem usługi: pusty kafelek, nie błąd
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > 16) return false;
  const jobs = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      jobs.push(loadImage(srcUrl(def, li, row, col)).then((img) => ({ img, col, row })));
    }
  }
  const got = (await Promise.all(jobs)).filter((t) => t.img);
  if (!got.length) return false;
  const ctx = canvas.getContext('2d');
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const tris = [
        [[i, j], [i + 1, j], [i, j + 1]],
        [[i + 1, j], [i + 1, j + 1], [i, j + 1]]
      ];
      for (const t of tris) {
        const d = t.map(([a, b]) => dp[b][a]);
        const g = t.map(([a, b]) => gp[b][a]);
        const m = affine(d, g);
        if (!m) continue;
        const clip = expand(d, 1.2);
        for (const { img, col, row } of got) {
          ctx.save();
          ctx.setTransform(r, 0, 0, r, 0, 0);
          ctx.beginPath();
          ctx.moveTo(clip[0].x, clip[0].y);
          ctx.lineTo(clip[1].x, clip[1].y);
          ctx.lineTo(clip[2].x, clip[2].y);
          ctx.closePath();
          ctx.clip();
          const [a, b, c, dd, e, f] = m;
          const ox = col * SRC;
          const oy = row * SRC;
          ctx.setTransform(r * a, r * b, r * c, r * dd, r * (e + a * ox + c * oy), r * (f + b * ox + dd * oy));
          ctx.drawImage(img, -0.5, -0.5, SRC + 1, SRC + 1); // lekki zakład: bez szwów między kafelkami
          ctx.restore();
        }
      }
    }
  }
  return true;
}

export function createWmts2180Layer(def, options) {
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('canvas');
      const r = (window.devicePixelRatio || 1) >= 1.5 ? 2 : 1;
      tile.width = tile.height = 256 * r;
      tile.style.width = tile.style.height = '256px';
      this._draw(tile, coords, r).then(
        (ok) => done(ok ? null : new Error('brak kafelków'), tile),
        (e) => done(e, tile)
      );
      return tile;
    },

    async _draw(tile, coords, r) {
      const { x: tx, y: ty, z } = coords;
      if (!def.under) return warpInto(def, tile, z, tx, ty, r);
      // Z tłem: cieniowanie rysujemy na osobnym płótnie i mnożymy z tłem raz, na końcu
      // (to działa w każdej przeglądarce, nie wymaga mix-blend-mode).
      const shade = document.createElement('canvas');
      shade.width = tile.width;
      shade.height = tile.height;
      let underImg = null;
      const under = def.under;
      const jobs = [warpInto(def, shade, z, tx, ty, r)];
      if (under.type === 'wmts2180') {
        underImg = document.createElement('canvas');
        underImg.width = tile.width;
        underImg.height = tile.height;
        jobs.push(warpInto(under.def, underImg, z, tx, ty, r));
      } else {
        jobs.push(loadImage(underUrl(under, z, tx, ty, tile.width)).then((img) => (underImg = img)));
      }
      const [okShade] = await Promise.all(jobs);
      if (!okShade) return false;
      tile._mix = { underImg, shade };
      compose(tile, this.options.shadeAlpha ?? 0.5);
      return true;
    },

    // adresy wszystkich plików potrzebnych do narysowania kafelka (do zapisu offline)
    urlsFor(coords) {
      const out = [];
      const { li, c0, c1, r0, r1 } = plan(def, coords.z, coords.x, coords.y);
      if (c1 >= c0 && r1 >= r0 && (c1 - c0 + 1) * (r1 - r0 + 1) <= 16) {
        for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) out.push(srcUrl(def, li, row, col));
      }
      if (def.under && def.under.type === 'wmts2180') {
        const u = plan(def.under.def, coords.z, coords.x, coords.y);
        if (u.c1 >= u.c0 && u.r1 >= u.r0 && (u.c1 - u.c0 + 1) * (u.r1 - u.r0 + 1) <= 16) {
          for (let row = u.r0; row <= u.r1; row++) for (let col = u.c0; col <= u.c1; col++) out.push(srcUrl(def.under.def, u.li, row, col));
        }
      } else if (def.under) {
        const r = (window.devicePixelRatio || 1) >= 1.5 ? 2 : 1;
        out.push(underUrl(def.under, coords.z, coords.x, coords.y, 256 * r));
      }
      return out;
    },

    // zmiana siły cieniowania na żywo, bez ponownego pobierania kafelków
    setShadeAlpha(alpha) {
      this.options.shadeAlpha = alpha;
      for (const k in this._tiles) {
        const t = this._tiles[k].el;
        if (t && t._mix) compose(t, alpha);
      }
    }
  });

  const layer = new Layer({ ...options, tileSize: 256, shadeAlpha: def.shadeAlpha });
  if (def.blend) {
    layer.on('add', () => {
      const c = layer.getContainer();
      if (c) c.style.mixBlendMode = def.blend;
    });
  }
  return layer;
}
