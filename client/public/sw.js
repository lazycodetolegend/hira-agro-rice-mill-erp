const CACHE_NAME = 'ricemill-erp-v11';
const CORE_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

async function precacheAppBundle() {
  const cache = await caches.open(CACHE_NAME);
  let files = [...CORE_SHELL];
  try {
    const manifestRes = await fetch('/sw-precache.json', { cache: 'no-store' });
    if (manifestRes.ok) {
      const data = await manifestRes.json();
      if (Array.isArray(data?.files)) {
        files = Array.from(new Set([...CORE_SHELL, ...data.files]));
      }
    }
  } catch {
    // dev mode or unavailable: keep CORE_SHELL
  }
  await Promise.all(
    files.map((url) =>
      cache.add(url).catch(() => {
        // Ignore individual asset failure so one missing icon doesn't abort install
      })
    )
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppBundle());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api') || url.pathname === '/sw.js') {
    return;
  }

  // App navigations: network-first (short timeout feel via fallback), offline -> cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', res.clone()));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Static JS/CSS/images/icons: cache-first with background refresh
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        fetch(event.request)
          .then((res) => {
            if (res && res.status === 200) {
              caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }
      return fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
