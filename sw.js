/* TransApple service worker.
   - Page loads: network first, cached copy when offline.
   - Same-origin static files: cache first, refreshed in the background.
   - Cross-origin requests (Supabase API, Google Fonts) are never touched.
   All *.github.io repos share one origin and one Cache Storage, so this file
   only ever creates or deletes caches that start with PREFIX. */

const PREFIX = 'transapple-';
const CACHE = PREFIX + 'v1';
const SCOPE = self.registration.scope;                 // e.g. https://user.github.io/repo-name/
const INDEX = new URL('index.html', SCOPE).href;
const PRECACHE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not block the install, so add them one by one.
    await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // never intercept the database/API or fonts

  if (req.mode === 'navigate') {
    event.respondWith(pageNetworkFirst(event, req, url));
  } else {
    event.respondWith(staticCacheFirst(event, req));
  }
});

async function pageNetworkFirst(event, req, url) {
  try {
    const res = await fetch(req);
    const scopePath = new URL(SCOPE).pathname;
    const isAppPage = url.pathname === scopePath || url.pathname === scopePath + 'index.html';
    if (res && res.ok && res.type === 'basic' && isAppPage) {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE).then((c) => c.put(INDEX, copy)).catch(() => {}));
    }
    return res;
  } catch (err) {
    const cache = await caches.open(CACHE);
    return (
      (await cache.match(INDEX)) ||
      (await cache.match(req, { ignoreSearch: true })) ||
      new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
}

async function staticCacheFirst(event, req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  try {
    return await refresh;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
