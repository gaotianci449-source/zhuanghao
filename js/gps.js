// 定位、跟随、屏幕常亮，以及顶部的桩号读数
import { toUTM, formatCh, distText } from "./geo.js";
import { S, hooks } from "./state.js";
import { prefs } from "./store.js";
import { map } from "./map.js";
import { $, esc, toast } from "./ui.js";
import { T } from "./i18n.js";

let meMarker = null, accCircle = null, wake = null;

export function startGPS() {
  if (S.watchId != null) return;
  if (!navigator.geolocation) { toast(T("这个浏览器不能定位，请用 Chrome 或手机自带浏览器打开。")); return; }
  $("acc").textContent = T("正在定位…");
  S.watchId = navigator.geolocation.watchPosition(onPos, (err) => {
    // 已经定到位后偶尔一次失败，不打扰
    if (err.code !== 1 && S.me) return;
    const msg = err.code === 1 ? T("没有定位权限。请在浏览器设置里允许这个网站使用位置，再点定位按钮。")
      : err.code === 3 ? T("定位超时，到开阔的地方再试。") : T("暂时拿不到位置。");
    $("acc").textContent = T("定位失败"); $("acc").dataset.level = "poor";
    toast(msg);
    if (err.code === 1) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; setFollow(false); }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  prefs.set("gps", true);
}

function onPos(p) {
  const first = !S.me;
  S.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp || Date.now(),
    speed: p.coords.speed, heading: p.coords.heading };
  const ll = [S.me.lat, S.me.lon];
  if (!meMarker) {
    accCircle = L.circle(ll, { radius: S.me.acc, color: "#2D7FF9", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    meMarker = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "", iconSize: [0, 0], html: '<div class="me"><svg class="me-arrow" viewBox="0 0 40 40" hidden><path d="M20 3 L33 35 L20 27.5 L7 35 Z"/></svg><div class="me-dot"></div></div>' }) }).addTo(map);
  } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(S.me.acc); }
  showAcc();
  if (S.follow || first) map.setView(ll, Math.max(map.getZoom(), first ? 17 : 0), { animate: !first });
  update();
  for (const f of hooks.onPos) f(S.me);
}
function showAcc() {
  if (!S.me) return;
  const a = S.me.acc;
  $("acc").textContent = T("精度 ±{a} 米", { a: a < 10 ? a.toFixed(1) : Math.round(a) });
  $("acc").dataset.level = a <= 5 ? "good" : a <= 15 ? "fair" : "poor";
}

// 跟随定位或记录轨迹时，保持屏幕常亮
export async function updateWake() {
  const want = S.follow || !!S.rec;
  try {
    if (want && !wake && "wakeLock" in navigator && document.visibilityState === "visible") {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    }
    if (!want && wake) { const w = wake; wake = null; await w.release(); }
  } catch (e) { /* 屏幕常亮不可用时忽略 */ }
}
export function setFollow(on) {
  S.follow = on;
  $("locate").setAttribute("aria-pressed", on ? "true" : "false");
  updateWake();
}
$("locate").addEventListener("click", () => {
  startGPS();
  hooks.enableCompass(); // 苹果手机要在点按钮时请求指南针权限
  if (S.follow) { setFollow(false); return; }
  setFollow(true);
  if (S.me) map.setView([S.me.lat, S.me.lon], Math.max(map.getZoom(), 17));
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") updateWake(); });

/* ---------- 读数 ---------- */
function nearest() {
  if (!S.me) return null;
  let best = null;
  const cands = S.lock ? S.roads.filter((r) => r.id === S.lock) : S.roads.filter((r) => r.visible);
  for (const r of cands) {
    const [e, n] = toUTM(S.me.lat, S.me.lon, r.crs);
    const q = r.locate(e, n);
    if (!best || q.d < best.q.d) best = { r, q, e, n };
  }
  return best;
}
function setChip(r, text) {
  $("roadSwatch").style.background = r ? r.color : "#6B7177";
  $("roadName").textContent = text;
  $("readout").style.setProperty("--road", r ? r.color : "transparent");
}
const lockName = (r) => T("锁定 {name}", { name: r.name });

export function update() {
  const ch = $("ch"), off = $("off");
  ch.className = "ch";
  showAcc();
  // 附近地标：“拌合站 东北 320 米”
  const nt = S.me ? hooks.nearText(S.me.lat, S.me.lon) : "";
  $("near").hidden = !nt; $("near").textContent = nt;
  if (!S.roads.length) {
    setChip(null, T("还没有路段")); ch.textContent = "—"; ch.classList.add("dim");
    off.textContent = T("点下方“路段”，导入 KML、Excel 或坐标文件");
    S.last = null; return;
  }
  const lockRoad = S.lock && S.roads.find((r) => r.id === S.lock);
  if (!S.me) {
    setChip(lockRoad || null, lockRoad ? lockName(lockRoad) : T("自动选最近的路段"));
    ch.textContent = "—"; ch.classList.add("dim");
    off.textContent = T("点右下角的定位按钮开始");
    return;
  }
  const b = nearest();
  S.last = b;
  if (!b) { setChip(null, T("所有路段都隐藏了")); ch.textContent = "—"; ch.classList.add("dim"); off.textContent = T("点上方路段名，打开要显示的路段"); return; }
  setChip(b.r, S.lock ? lockName(b.r) : b.r.name);
  if (b.q.far || b.q.d > S.maxOff) {
    ch.textContent = T("不在路段范围内"); ch.classList.add("small");
    const [num, unit] = distText(b.q.d).split(" ");
    off.innerHTML = T("离 {name} 最近处 {d}", { name: esc(b.r.name), d: `<b>${num}</b>${unit}` });
    return;
  }
  if (b.q.beyond) {
    off.innerHTML = T(b.q.beyond === "start" ? "已超出起点，距离 {d}" : "已超出终点，距离 {d}", { d: `<b>${Math.round(b.q.d)}</b>${T("米")}` });
    ch.textContent = formatCh(b.q.beyond === "start" ? b.r.chMin : b.r.chMax, 0);
    ch.classList.add("dim");
    return;
  }
  ch.textContent = formatCh(b.q.ch, 0);
  const d = Math.abs(b.q.off);
  if (d < 0.5) { off.innerHTML = `<span class="side">${T("中线上")}</span>`; return; }
  off.innerHTML = `<span class="side">${T(b.q.off > 0 ? "左" : "右")}</span> ` +
    T("离中线 {d}", { d: `<b>${d < 100 ? d.toFixed(1) : Math.round(d)}</b>${T("米")}` });
}

// 点读数区收起/展开（记住选择）
function setCollapsed(on) {
  $("readout").classList.toggle("collapsed", on);
  $("readoutMain").setAttribute("aria-expanded", on ? "false" : "true");
  prefs.set("collapsed", on);
}
setCollapsed(prefs.get("collapsed", false));
$("readoutMain").addEventListener("click", () => setCollapsed(!$("readout").classList.contains("collapsed")));
$("readoutMain").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("readoutMain").click(); } });

hooks.update = update;
hooks.setFollow = setFollow;
hooks.startGPS = startGPS;
hooks.updateWake = updateWake;
