// 离线缓存：程序文件先用缓存（打开快、网差不卡），后台更新；共享数据优先联网；地图影像不经过这里
const CACHE = "zhuanghao-v14";
const APP = [
  "./", "index.html", "manifest.json", "css/app.css",
  "js/app.js", "js/state.js", "js/i18n.js", "js/fr.js", "js/ui.js", "js/map.js", "js/gps.js",
  "js/roads.js", "js/find.js", "js/tracks.js", "js/measure.js", "js/more.js", "js/backup.js",
  "js/geo.js", "js/road.js", "js/importers.js", "js/store.js", "js/zip.js", "js/xlsx.js", "js/kmlout.js",
  "js/crypto.js", "js/shared.js", "js/admin.js", "js/marks.js", "js/photo.js", "js/dxf.js", "js/dwg.js", "js/heading.js",
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
  const isData = url.pathname.includes("/data/");
  // 共享数据每次带不同的 ?t= 参数，缓存时去掉参数，只留一份
  const key = isData ? new Request(url.origin + url.pathname) : e.request;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(e.request, { cache: "no-cache" }).then((res) => {
      if (res.ok) c.put(key, res.clone());
      return res;
    });
    if (isData) {
      // 共享数据要新的：联网最多等 4 秒，网差就先用上次的
      if (!hit) return net;
      const timeout = new Promise((ok) => setTimeout(() => ok(null), 4000));
      try { const res = await Promise.race([net, timeout]); if (res) return res; } catch (err) { /* 没网 */ }
      e.waitUntil(net.catch(() => {}));
      // 标记一下这是上次存的，页面上可以提示“网慢，显示的是上次的数据”
      const h = new Headers(hit.headers); h.set("x-zh-cache", "1");
      return new Response(hit.body, { status: hit.status, headers: h });
    }
    // 程序文件：有缓存就马上用（网差也不卡），同时在后台更新；新版本由 sw.js 更新后自动刷新
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});
