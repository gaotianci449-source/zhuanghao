// 离线缓存：程序文件优先联网取最新的，没网时才用缓存；地图影像不经过这里
const CACHE = "zhuanghao-v7";
const APP = [
  "./", "index.html", "manifest.json", "css/app.css",
  "js/app.js", "js/state.js", "js/i18n.js", "js/fr.js", "js/ui.js", "js/map.js", "js/gps.js",
  "js/roads.js", "js/find.js", "js/tracks.js", "js/measure.js", "js/more.js", "js/backup.js",
  "js/geo.js", "js/road.js", "js/importers.js", "js/store.js", "js/zip.js", "js/xlsx.js", "js/kmlout.js",
  "js/crypto.js", "js/shared.js", "js/admin.js", "js/marks.js", "js/photo.js", "js/dxf.js", "js/dwg.js",
  "vendor/leaflet.js", "vendor/leaflet.css", "vendor/barlow-cond-600.woff",
  "icons/icon-192.png", "icons/icon-512.png",
];
self.addEventListener("install", (e) => {
  // cache: "reload" 绕过浏览器的 HTTP 缓存，确保存进去的是最新文件
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(APP.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(e.request, { cache: "no-cache" });
      // 共享数据每次带不同的 ?t= 参数，缓存时去掉参数，只留一份
      if (res.ok) c.put(url.pathname.includes("/data/") ? new Request(url.origin + url.pathname) : e.request, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
