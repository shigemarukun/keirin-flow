// KEIRIN FLOW service worker
// 方針: 通信できるときは必ず最新版を取りに行き(古い版が出る問題を防ぐ)、
// 電波がないときだけ前回保存した版で動かす。
const CACHE = 'keirin-flow-v9';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./', './index.html', './style.css', './main.js'])).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh.ok && !new URL(req.url).searchParams.has('s')) (await caches.open(CACHE)).put(req, fresh.clone()); // 共有リンク (?s=) は保存しない
      return fresh;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      throw new Error('offline and not cached');
    }
  })());
});
