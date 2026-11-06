// Spörssi service worker: sovelluksen kuori toimii ilman verkkoa, ja viimeisimmät
// rajapintavastaukset näytetään, jos verkko puuttuu.
const VERSION = 'v1';
const SHELL = `sporssi-shell-${VERSION}`;
const DATA = `sporssi-data-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './config.js', './manifest.webmanifest', './favicon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('sporssi-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) {
    event.respondWith(networkFirst(req, DATA));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(req)); // tiedostonimissä sisällön tiiviste
  } else {
    event.respondWith(networkFirst(req, SHELL));
  }
});
