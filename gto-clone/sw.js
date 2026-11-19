// Always the newest files. GitHub Pages lets browsers keep each file 10
// minutes, so right after a publish a page could run new and old modules
// together (v1.17.1 ran the old chart saving that way). Every file of the
// site is asked to the server again ("no-cache": a tiny 304 when it did not
// change). Pages and other sites are left alone.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode === 'navigate' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => fetch(req)));
});
