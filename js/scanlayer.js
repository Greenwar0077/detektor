// Skan starej mapy jako warstwa dopasowana do terenu przekształceniem afinicznym.
// Przekształcenie: piksel skanu (x w prawo, y w dół) -> metry EPSG:3857:
//   X = a*x + b*y + e,   Y = c*x + d*y + f
const L = window.L;
export const SM = L.Projection.SphericalMercator;

export const applyT = (T, x, y) => [T.a * x + T.b * y + T.e, T.c * x + T.d * y + T.f];
export function applyInv(T, X, Y) {
  const det = T.a * T.d - T.b * T.c;
  const dx = X - T.e;
  const dy = Y - T.f;
  return [(T.d * dx - T.b * dy) / det, (-T.c * dx + T.a * dy) / det];
}

function similarity(p, q) {
  // dwa punkty: przesunięcie + skala + obrót (obraz ma oś y w dół, metry w górę)
  const ux = q.px - p.px;
  const uy = -(q.py - p.py);
  const vx = q.X - p.X;
  const vy = q.Y - p.Y;
  const n = ux * ux + uy * uy;
  if (n < 1e-9) return null;
  const a = (vx * ux + vy * uy) / n;
  const b = (vy * ux - vx * uy) / n;
  return { a, b, c: b, d: -a, e: p.X - a * p.px - b * p.py, f: p.Y - b * p.px + a * p.py };
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = i + 1; r < 3; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = M[i][3];
    for (let c = i + 1; c < 3; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

// Z jednego punktu: tylko przesunięcie. Z dwóch: przesunięcie, skala i obrót.
// Z trzech i więcej: przekształcenie afiniczne (metoda najmniejszych kwadratów).
export function fitTransform(init, pts) {
  const n = pts.length;
  if (n === 0) return { ...init };
  if (n === 1) {
    const p = pts[0];
    return { ...init, e: p.X - (init.a * p.px + init.b * p.py), f: p.Y - (init.c * p.px + init.d * p.py) };
  }
  const far = () => {
    let best = null;
    let bd = -1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(pts[i].px - pts[j].px, pts[i].py - pts[j].py);
        if (d > bd) {
          bd = d;
          best = [pts[i], pts[j]];
        }
      }
    }
    return similarity(best[0], best[1]);
  };
  if (n === 2) return far() || fitTransform(init, [pts[0]]);
  // normalne równania dla [x y 1]
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const p of pts) {
    const r = [p.px, p.py, 1];
    for (let i = 0; i < 3; i++) {
      bx[i] += r[i] * p.X;
      by[i] += r[i] * p.Y;
      for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j];
    }
  }
  const sx = solve3(A, bx);
  const sy = solve3(A, by);
  if (!sx || !sy) return far() || fitTransform(init, [pts[0]]);
  return { a: sx[0], b: sx[1], e: sx[2], c: sy[0], d: sy[1], f: sy[2] };
}

export const ScanLayer = L.Layer.extend({
  options: { opacity: 0.8, zIndex: 5 },

  initialize(url, T, w, h, options) {
    L.setOptions(this, options);
    this._url = url;
    this._T = T;
    this._w = w;
    this._h = h;
  },

  setTransform(T) {
    this._T = T;
    if (this._map) this._reset();
  },

  setOpacity(o) {
    this.options.opacity = o;
    if (this._img) this._img.style.opacity = o;
    return this;
  },

  getContainer() {
    return this._el;
  },

  onAdd(map) {
    this._el = L.DomUtil.create('div', 'leaflet-layer scan-layer');
    this._el.style.zIndex = this.options.zIndex;
    this._img = L.DomUtil.create('img', 'leaflet-zoom-animated scan-img', this._el);
    this._img.alt = '';
    this._img.draggable = false;
    this._img.style.cssText += `;width:${this._w}px;height:${this._h}px;opacity:${this.options.opacity}`;
    this._img.src = this._url;
    map.getPane('tilePane').appendChild(this._el);
    this._reset();
  },

  onRemove() {
    L.DomUtil.remove(this._el);
  },

  getEvents() {
    return { zoomanim: this._animate, viewreset: this._reset, moveend: this._reset };
  },

  _corner(x, y, e) {
    const [X, Y] = applyT(this._T, x, y);
    const ll = SM.unproject(L.point(X, Y));
    return e ? this._map._latLngToNewLayerPoint(ll, e.zoom, e.center) : this._map.latLngToLayerPoint(ll);
  },

  _place(e) {
    const p0 = this._corner(0, 0, e);
    const p1 = this._corner(this._w, 0, e);
    const p2 = this._corner(0, this._h, e);
    const m = [(p1.x - p0.x) / this._w, (p1.y - p0.y) / this._w, (p2.x - p0.x) / this._h, (p2.y - p0.y) / this._h, p0.x, p0.y];
    this._img.style.transform = `matrix(${m.join(',')})`;
  },

  _reset() {
    this._place(null);
  },

  _animate(e) {
    this._place(e);
  }
});
