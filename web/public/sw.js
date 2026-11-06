// Spörssi service worker.
// - Sovelluksen kuori (index.html, config.js, manifest) haetaan ensin verkosta, ilman verkkoa välimuistista.
// - Käännetyt tiedostot (assets/, nimessä sisällön tiiviste) välimuistista; vanhat versiot poistetaan,
//   kun uusi index.html on haettu.
// - Rajapinta: verkko ensin (4 s aikaraja), muuten tallennettu vastaus. Välimuistista tullut vastaus
//   merkitään otsakkeella x-sporssi-offline, jotta sivu voi kertoa tietojen olevan tallennettuja.
//   Tallennetut rajapintavastaukset siivotaan: päiväkohtaisista säilytetään 14 viimeistä päivää.
// HTTP-välimuisti hoitaa muuttumattomat vastaukset (menneiden päivien hinnat) ilman verkkoa.
const SHELL = 'sporssi-shell-v2';
const DATA = 'sporssi-data-v2';
const KEEP_DAYS = 14;
const NETWORK_TIMEOUT_MS = 4000;
const STORED_HEADER = 'x-sporssi-stored';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './config.js', './manifest.webmanifest', './favicon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sporssi-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k)));
    await pruneData();
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Tallennetaan kopio, jossa on tallennusaika.
async function store(cache, request, response) {
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set(STORED_HEADER, String(Date.now()));
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
}

async function fromCacheMarked(cache, request) {
  const cached = await cache.match(request);
  if (!cached) return null;
  const headers = new Headers(cached.headers);
  headers.set('x-sporssi-offline', '1');
  return new Response(await cached.arrayBuffer(), { status: cached.status, statusText: cached.statusText, headers });
}

async function api(event) {
  const { request } = event;
  const cache = await caches.open(DATA);
  const network = fetch(request);
  try {
    const response = await withTimeout(network, NETWORK_TIMEOUT_MS);
    if (response.ok) {
      const copy = response.clone(); // kopio ennen kuin sivu lukee vastauksen
      event.waitUntil(store(cache, request, copy).then(pruneData));
    }
    return response;
  } catch (err) {
    const cached = await fromCacheMarked(cache, request);
    if (cached) {
      // Hidas verkko: vastaus päivitetään välimuistiin, kun se lopulta tulee.
      event.waitUntil(network.then((r) => (r.ok ? store(cache, request, r) : null)).catch(() => {}));
      return cached;
    }
    return network; // ei tallennettua: odotetaan verkkoa (tai virhe)
  }
}

async function pruneData() {
  const cache = await caches.open(DATA);
  const limit = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const req of await cache.keys()) {
    const d = new URL(req.url).searchParams.get('date');
    if (d && d < limit) await cache.delete(req);
  }
}

// Poistetaan välimuistista assets-tiedostot, joihin uusi index.html ei enää viittaa.
async function pruneAssets(html) {
  const current = new Set([...html.matchAll(/assets\/[^"'\s)]+/g)].map((m) => m[0]));
  if (!current.size) return;
  const cache = await caches.open(SHELL);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    const i = path.indexOf('assets/');
    if (i >= 0 && !current.has(path.slice(i))) await cache.delete(req);
  }
}

async function shell(event) {
  const { request } = event;
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (request.mode === 'navigate' || (response.headers.get('content-type') || '').includes('text/html')) {
        event.waitUntil(response.clone().text().then(pruneAssets));
      }
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    throw err;
  }
}

async function asset(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) {
    if (url.pathname.endsWith('/api/health')) return; // aina verkosta
    event.respondWith(api(event));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(asset(req));
  } else {
    event.respondWith(shell(event));
  }
});
