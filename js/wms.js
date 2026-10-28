// Warstwa WMS z kolejką i ponawianiem nieudanych kafelków (patrz tilequeue.js).
import { enqueue, noteError, withRetry, backoff, MAX_TRIES, stats, watch } from './tilequeue.js';

const L = window.L;

const retryTile = {
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
            let over = false;
            const stop = watch(tile, (gone) => {
              if (over) return;
              over = true;
              tile.onload = tile.onerror = null;
              finish(); // zwalniamy miejsce w kolejce
              if (gone) return; // kafelek już niepotrzebny
              tile.src = '';
              retry();
            }, true);
            const retry = () => {
              noteError();
              if (++n < MAX_TRIES) {
                stats.retries++;
                setTimeout(attempt, backoff(n));
              } else {
                stats.failed++;
                done(new Error('kafelek'), tile);
              }
            };
            tile.onload = () => {
              over = true;
              stop();
              stats.ok++;
              finish();
              done(null, tile);
            };
            tile.onerror = () => {
              over = true;
              stop();
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
};

export const RetryWms = L.TileLayer.WMS.extend(retryTile);
export const RetryXyz = L.TileLayer.extend(retryTile);
