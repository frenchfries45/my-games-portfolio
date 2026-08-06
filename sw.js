// sgames.me Service Worker
// HTML: network-first (always fresh, falls back to cache offline)
// Static assets: stale-while-revalidate (instant, updates in background)

const VERSION = 'v2';
const CACHE_NAME = `sgames-${VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: cache the shell, take over immediately
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: nuke every old cache, claim clients, and refresh any
// open tabs that were being served the stale version.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const stale = names.filter(name => name !== CACHE_NAME);
    await Promise.all(stale.map(name => caches.delete(name)));

    await self.clients.claim();

    // Only reload if we actually replaced an older SW's cache.
    if (stale.length > 0) {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        if ('navigate' in client) client.navigate(client.url);
      }
    }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Never touch non-GET (form posts, analytics beacons, etc.)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // External game URLs (lovable.app, vercel.app) go straight to network
  if (!url.hostname.endsWith('sgames.me') && url.origin !== self.location.origin) {
    return;
  }

  // --- HTML / navigation: NETWORK FIRST ---
  // This is the fix. Updated pages and links are picked up immediately.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (err) {
        // Offline: serve whatever we have
        const cached = await caches.match(request);
        return cached || await caches.match('/index.html');
      }
    })());
    return;
  }

  // --- manifest.json: network first, it holds game shortcut URLs ---
  if (url.pathname === '/manifest.json') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (err) {
        return (await caches.match(request)) || Response.error();
      }
    })());
    return;
  }

  // --- Everything else (icons, images): STALE-WHILE-REVALIDATE ---
  // Instant from cache, but quietly refreshed for next time.
  event.respondWith((async () => {
    const cached = await caches.match(request);

    const network = fetch(request).then(response => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      }
      return response;
    }).catch(() => null);

    return cached || (await network) || Response.error();
  })());
});
