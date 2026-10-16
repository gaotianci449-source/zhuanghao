// 离线缓存：程序文件先用缓存（后台更新），地图影像走网络
const CACHE = "zhuanghao-v1";
const APP = [
  "./", "index.html", "manifest.json", "css/app.css",
  "js/app.js", "js/geo.js", "js/road.js", "js/importers.js", "js/store.js", "js/kmz.js",
  "vendor/leaflet.js", "vendor/leaflet.css", "vendor/barlow-cond-600.woff",
  "icons/icon-192.png", "icons/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
