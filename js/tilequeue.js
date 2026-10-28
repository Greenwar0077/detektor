// Kolejka pobierania kafelków z ponawianiem. Geoportal przy większej liczbie równoległych zapytań
// potrafi odpowiadać szybkim błędem 404, więc ograniczamy współbieżność i ponawiamy z opóźnieniem.
const BASE_MAX = 4;
const queue = [];
let active = 0;
let slowUntil = 0; // po błędach na chwilę zwalniamy
export const stats = { retries: 0, failed: 0, ok: 0 };

function limit() {
  return Date.now() < slowUntil ? 2 : BASE_MAX;
}

function pump() {
  while (active < limit() && queue.length) {
    const job = queue.pop(); // najnowsze najpierw: widoczne kafelki wyprzedzają stare
    active++;
    job.task().then(job.resolve, job.resolve).finally(() => {
      active--;
      pump();
    });
  }
}

export function enqueue(task) {
  return new Promise((resolve) => {
    queue.push({ task, resolve });
    pump();
  });
}

export function noteError() {
  slowUntil = Date.now() + 5000;
}

export const withRetry = (url, n) => (n ? url + (url.includes('?') ? '&' : '?') + '_r=' + n : url);
export const backoff = (n) => 350 * 2 ** n + Math.random() * 250;
export const MAX_TRIES = 4;

// Obraz z kolejką i ponowieniami; zwraca element Image albo null.
export function loadImageRetry(url) {
  return new Promise((resolve) => {
    let n = 0;
    const attempt = () =>
      enqueue(
        () =>
          new Promise((done) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
              stats.ok++;
              done();
              resolve(img);
            };
            img.onerror = () => {
              done();
              noteError();
              if (++n < MAX_TRIES) {
                stats.retries++;
                setTimeout(attempt, backoff(n));
              } else {
                stats.failed++;
                resolve(null);
              }
            };
            img.src = withRetry(url, n);
          })
      );
    attempt();
  });
}
