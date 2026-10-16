// 地图：底图、路段中线、桩号标注（和奥维一样路边写桩号，放大后每 20 米一道横线），轨迹和测量图形
import { fromUTM, formatCh } from "./geo.js";
import { S, hooks } from "./state.js";
import { prefs } from "./store.js";
import { haloOf } from "./ui.js";
import { T } from "./i18n.js";

const view = prefs.get("view", { c: [10.9447, -14.3015], z: 15 });
export const map = L.map("map", { zoomControl: false, maxZoom: 20, attributionControl: true }).setView(view.c, view.z);
L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
export const BASES = {
  esri: () => L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 17, maxZoom: 20, attribution: T("影像") + " © Esri, Maxar, Earthstar Geographics" }),
  osm: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19, maxZoom: 20, attribution: "© OpenStreetMap" }),
  none: () => null,
};
let baseLayer = null;
export function setBase(k) {
  if (!(k in BASES)) k = "esri";
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = BASES[k]();
  if (baseLayer) baseLayer.addTo(map);
  S.base = k; prefs.set("base", k);
}
setBase(S.base);

// 路网和地名（Esri 透明叠加层），叠在影像上面，效果类似奥维的“混合图”
map.createPane("refPane").style.zIndex = 250;
const refLayers = L.layerGroup([
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { pane: "refPane", maxNativeZoom: 19, maxZoom: 20 }),
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { pane: "refPane", maxNativeZoom: 19, maxZoom: 20 }),
]);
export function setRef(on) {
  prefs.set("ref", on);
  if (on && !map.hasLayer(refLayers)) refLayers.addTo(map);
  if (!on && map.hasLayer(refLayers)) map.removeLayer(refLayers);
}
setRef(prefs.get("ref", true));

export const overlayLayer = L.layerGroup().addTo(map);  // 已保存的轨迹、测量图形
export const roadLayer = L.layerGroup().addTo(map);
export const labelLayer = L.layerGroup().addTo(map);
export const previewLayer = L.layerGroup().addTo(map);
export const liveLayer = L.layerGroup().addTo(map);     // 正在记录的轨迹、正在测量的图形
export const markLayer = L.layerGroup().addTo(map);     // 地标
export const findLayer = L.layerGroup().addTo(map);

map.on("moveend", () => {
  const c = map.getCenter();
  prefs.set("view", { c: [c.lat, c.lng], z: map.getZoom() });
  drawLabels();
});
map.on("dragstart", () => hooks.setFollow(false));
map.on("click", (e) => { if (hooks.onMapClick) hooks.onMapClick(e.latlng); });
// 面板出现/消失时地图区域大小会变
if ("ResizeObserver" in window) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(document.getElementById("map"));

export const llOf = (road, e, n) => fromUTM(e, n, road.crs);

export function drawRoads() {
  roadLayer.clearLayers();
  for (const r of S.roads) {
    if (!r.visible) continue;
    if (!r.ll) r.ll = r.pts.map(([e, n]) => llOf(r, e, n));
    L.polyline(r.ll, { color: "#000", weight: 5, opacity: 0.4, interactive: false }).addTo(roadLayer);
    L.polyline(r.ll, { color: r.color, weight: 2.5, opacity: 1, interactive: false }).addTo(roadLayer);
  }
  drawLabels();
}

const tickRenderer = L.canvas({ padding: 0.2 });
function labelStep(z) {
  if (z >= 16) return 100;
  if (z >= 15) return 200;
  if (z >= 14) return 500;
  if (z >= 13) return 1000;
  if (z >= 12) return 2000;
  if (z >= 10) return 5000;
  return 0;
}
const chShort = (ch) => formatCh(ch).replace(/^K/, "");
export function drawLabels() {
  labelLayer.clearLayers();
  const z = map.getZoom();
  const step = labelStep(z);
  if (!step) return;
  // 路名：标在每条路的中间，同一种颜色的路挤在一起时也分得清
  // 标签互相压住时只留先放的那个（路名优先，其次是桩号）
  const placed = [];
  const free = (ll, w, h) => {
    const pt = map.latLngToContainerPoint(ll);
    if (placed.some((q) => Math.abs(q.x - pt.x) < (q.w + w) / 2 && Math.abs(q.y - pt.y) < (q.h + h) / 2)) return false;
    placed.push({ x: pt.x, y: pt.y, w, h });
    return true;
  };
  if (z >= 14) {
    const bb = map.getBounds();
    for (const r of S.roads) {
      if (!r.visible) continue;
      const p = r.at(r.length / 2), ll = llOf(r, p.e, p.n);
      if (!bb.contains(ll) || !free(ll, r.name.length * 8 + 20, 22)) continue;
      L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 500, icon: L.divIcon({ className: "", iconSize: [0, 0],
        html: `<div class="road-name" style="--c:${r.color}">${r.name.replace(/[&<>"]/g, "")}</div>` }) }).addTo(labelLayer);
    }
  }
  const tick = z >= 17 ? 20 : z >= 16 ? 100 : 0;
  const b = map.getBounds().pad(0.1);
  const mpp = 156543.03 * Math.cos(map.getCenter().lat * Math.PI / 180) / Math.pow(2, z); // 每像素多少米
  const half = Math.max(5, 7 * mpp);             // 横线半长：至少 5 米
  const gap = tick ? half * 1.6 + 4 * mpp : 9 * mpp; // 标签放在横线外侧
  let labels = 0, ticks = 0;
  for (const r of S.roads) {
    if (!r.visible) continue;
    const halo = haloOf(r.color);
    const st = tick || step;
    const k0 = Math.ceil(r.chMin / st), k1 = Math.floor(r.chMax / st);
    if (k1 - k0 > 8000) continue;
    for (let k = k0; k <= k1; k++) {
      const ch = k * st;
      const p = r.at(r.ch2s(ch));
      const ll = llOf(r, p.e, p.n);
      if (!b.contains(ll)) continue;
      const nx = -p.uy, ny = p.ux;               // 左侧法线
      if (tick && ticks < 800) {
        const big = ch % 100 === 0;
        const h = big ? half * 1.6 : half;
        const seg = [llOf(r, p.e + nx * h, p.n + ny * h), llOf(r, p.e - nx * h, p.n - ny * h)];
        L.polyline(seg, { renderer: tickRenderer, color: "#000", weight: big ? 4 : 3, opacity: 0.45, interactive: false }).addTo(labelLayer);
        L.polyline(seg, { renderer: tickRenderer, color: r.color, weight: big ? 2 : 1.4, opacity: 1, interactive: false }).addTo(labelLayer);
        ticks++;
      }
      if (Math.abs(ch / step - Math.round(ch / step)) < 1e-6 && labels < 160) {
        // 标签放在桩号增大方向的右侧，按右侧法线在屏幕上的朝向对齐文字，避免压住中线
        const ll2 = llOf(r, p.e - nx * gap, p.n - ny * gap);
        const major = ch % 1000 === 0;
        const rx = -nx, ry = -ny;
        const side = Math.abs(rx) >= Math.abs(ry) ? (rx >= 0 ? "e" : "w") : (ry >= 0 ? "n" : "s");
        // 按文字实际所在的位置（对齐方式不同，中心会偏）检查是否和别的标签重叠
        const text = chShort(ch), tw = text.length * 8 + 4, th = 18;
        const c0 = map.latLngToContainerPoint(ll2);
        const cx = c0.x + (side === "e" ? tw / 2 : side === "w" ? -tw / 2 : 0), cy = c0.y + (side === "n" ? -th / 2 : side === "s" ? th / 2 : 0);
        if (!free(map.containerPointToLatLng([cx, cy]), tw, th)) continue;
        L.marker(ll2, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0],
          html: `<div class="ch-label ${side}${major ? " major" : ""}" style="color:${r.color};--halo:${halo}">${chShort(ch)}</div>` }) }).addTo(labelLayer);
        labels++;
      }
    }
  }
}

// 已保存的轨迹和测量图形
export function drawOverlays() {
  overlayLayer.clearLayers();
  for (const t of S.tracks) {
    if (!t.visible || t.pts.length < 2) continue;
    const ll = t.pts.map((p) => [p[0], p[1]]);
    L.polyline(ll, { color: "#000", weight: 5, opacity: 0.35, interactive: false }).addTo(overlayLayer);
    L.polyline(ll, { color: t.color, weight: 3, opacity: 0.95, dashArray: "8 5", interactive: false }).addTo(overlayLayer);
  }
  for (const s of S.shapes) {
    if (!s.visible || s.pts.length < 2) continue;
    const ring = s.closed && s.pts.length >= 3;
    if (ring) L.polygon(s.pts, { stroke: false, fillColor: s.color, fillOpacity: 0.18, interactive: false }).addTo(overlayLayer);
    const ll = ring ? [...s.pts, s.pts[0]] : s.pts;
    L.polyline(ll, { color: "#000", weight: 5, opacity: 0.4, interactive: false }).addTo(overlayLayer);
    L.polyline(ll, { color: s.color, weight: 3, opacity: 1, interactive: false }).addTo(overlayLayer);
  }
}

hooks.drawRoads = drawRoads;
hooks.drawOverlays = drawOverlays;
