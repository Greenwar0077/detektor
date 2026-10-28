// Warstwa WMS z kolejką i ponawianiem nieudanych kafelków (patrz tilequeue.js).
import { enqueue, noteError, withRetry, backoff, MAX_TRIES, stats } from './tilequeue.js';

const L = window.L;

export const RetryWms = L.TileLayer.WMS.extend({
  createTile(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    const url = this.getTileUrl(coords);
    let n = 0;
    const attempt = () =>
      enqueue(
        () =>
          // mikrozadanie: Leaflet dołącza kafelek do mapy zaraz po createTile
          Promise.resolve().then(() => new Promise((finish) => {
            if (!tile.parentNode) {
              finish(); // kafelek już niepotrzebny (przesunięto mapę)
              return;
            }
            tile.onload = () => {
              stats.ok++;
              finish();
              done(null, tile);
            };
            tile.onerror = () => {
              finish();
              noteError();
              if (++n < MAX_TRIES) {
                stats.retries++;
                setTimeout(attempt, backoff(n));
              } else {
                stats.failed++;
                done(new Error('kafelek'), tile);
              }
            };
            tile.src = withRetry(url, n);
          }))
      );
    attempt();
    return tile;
  }
});
