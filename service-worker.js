/* ============================================================================
   Trade Desk — service worker
   Version 1.0 · Official Mobile PWA Release

   Two rules govern everything below:

   1. The app shell is cached so the desk opens instantly and works offline.
   2. Market data is NEVER cached. A stale BTC price is worse than no price,
      so every request to a price feed, TradingView or a calendar goes to the
      network and is left alone entirely if it fails.

   LocalStorage is untouched by any of this — the Cache API is a separate
   store, and nothing here reads or writes your trades.
   ========================================================================= */

const VERSION    = 'v1.0.0';
const SHELL      = `trade-desk-shell-${VERSION}`;
const RUNTIME    = `trade-desk-runtime-${VERSION}`;
const KEEP       = [SHELL, RUNTIME];

/* Relative paths only, so the worker works at a domain root AND under a
   GitHub Pages project path like /trade-desk/ without any edits. */
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/maskable-icon.png',
  './icons/monochrome-icon.png'
];

/* Hosts whose responses must always be live. Anything matching these is
   passed straight through to the network with no caching of any kind. */
const LIVE_ONLY = [
  'api.india.delta.exchange',
  'api.delta.exchange',
  'api.binance.com',
  'api1.binance.com',
  'stream.binance.com',
  'api.crypto.com',
  's3.tradingview.com',
  'www.tradingview.com',
  's.tradingview.com',
  'nfs.faireconomy.media',
  'economic-calendar'
];

/* ---------------------------------------------------------------- install */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* addAll() rejects the whole batch if a single file 404s, which would
       leave the app with no offline support at all. Each file is added
       individually so one missing icon cannot break the install. */
    await Promise.all(SHELL_FILES.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] skipped', url, err.message); }
    }));
  })());
  /* No skipWaiting here on purpose: the page asks for it once the user
     confirms the update, so a refresh never happens mid-trade. */
});

/* --------------------------------------------------------------- activate */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => KEEP.includes(n) ? null : caches.delete(n)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

/* ------------------------------------------------------ update handshake */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: VERSION });
  }
});

/* ------------------------------------------------------------------ fetch */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only GET is cacheable; POST/PUT go straight out.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never touch market data, widgets or calendars.
  if (LIVE_ONLY.some(host => url.hostname.includes(host) || url.href.includes(host))) return;

  // Never touch Cloudflare Access / auth redirects.
  if (url.pathname.startsWith('/cdn-cgi/')) return;

  /* Navigations: network first so a fresh deploy is picked up immediately,
     falling back to the cached shell when the connection is gone. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) { cachePut(SHELL, req, preload.clone()); return preload; }
        const fresh = await fetch(req);
        cachePut(SHELL, req, fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match(req)) ||
               (await caches.match('./index.html')) ||
               (await caches.match('./')) ||
               offlineFallback();
      }
    })());
    return;
  }

  // Same-origin assets: cache first, refreshed quietly in the background.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      const network = fetch(req)
        .then(res => { if (res && res.ok) cachePut(RUNTIME, req, res.clone()); return res; })
        .catch(() => null);
      return hit || (await network) || offlineFallback();
    })());
  }
  // Everything else (fonts, third-party scripts) is left to the browser.
});

/* ---------------------------------------------------------------- helpers */
async function cachePut(cacheName, req, res) {
  try {
    if (!res || !res.ok || res.type === 'opaque') return;
    const cache = await caches.open(cacheName);
    await cache.put(req, res);
  } catch (err) { /* quota or opaque response — not worth failing over */ }
}

function offlineFallback() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Trade Desk — offline</title>' +
    '<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#faf9f6;color:#1a1a18;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:2rem">' +
    '<div><h1 style="font-size:18px;margin:0 0 8px">Offline</h1>' +
    '<p style="font-size:14px;color:#5f5e5a;margin:0;line-height:1.6">Trade Desk has not been opened online yet, ' +
    'so there is nothing cached to show.<br>Reconnect once and it will work offline from then on.</p></div>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
