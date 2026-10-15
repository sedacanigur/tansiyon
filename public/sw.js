// Ana ekrana eklenebilmesi için basit service worker.
// Sadece uygulama kabuğunu önbelleğe alır; ölçüm verileri (/api) her zaman sunucudan gelir.
const CACHE = "tansiyon-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // önce ağ, bağlantı yoksa önbellek
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
