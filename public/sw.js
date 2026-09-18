/* ============================================================
   PORTFEL — Service Worker
   Strategie:
   - HTML (nawigacja) → network-first  (zawsze świeża wersja aplikacji)
   - CSS / JS / ikony → stale-while-revalidate (szybko + samo się aktualizuje)
   - Firebase / CDN    → zawsze sieć (pomijamy cache)
   ============================================================ */

const VERSION = 'v2';
const STATIC_CACHE = `portfel-static-${VERSION}`;
const HTML_CACHE   = `portfel-html-${VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/firebase-config.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg'
];

const BYPASS = ['firebase', 'googleapis', 'gstatic', 'cdnjs', 'google.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  const keep = [STATIC_CACHE, HTML_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (BYPASS.some(host => req.url.includes(host))) return;

  // Dokumenty HTML: najpierw sieć, cache tylko gdy brak połączenia
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(HTML_CACHE).then(c => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Reszta zasobów: oddaj z cache, w tle pobierz nowszą wersję
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
