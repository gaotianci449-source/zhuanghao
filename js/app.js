import { toUTM, fromUTM, formatCh, parseCh, bearingText, distText } from "./geo.js";
import { Road, buildRoad } from "./road.js";
import { parseKML, analyzeKML, parseTable, tableStations } from "./importers.js";
import { store, askPersist, prefs } from "./store.js";
import { readKMZ } from "./kmz.js";

const VERSION = "1.0";
const COLORS = ["#FFC81E", "#2D7FF9", "#E0312A", "#14A06F", "#B04BE0", "#FF7A1A"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = {
  roads: [],
  lock: prefs.get("lock", null),
  maxOff: prefs.get("maxOff", 300),
  base: prefs.get("base", "esri"),
  me: null, watchId: null, follow: false, wake: null,
  find: null, last: null, installEvt: null,
};

/* ---------- 地图 ---------- */
const view = prefs.get("view", { c: [10.9447, -14.3015], z: 15 });
const map = L.map("map", { zoomControl: false, maxZoom: 20, attributionControl: true }).setView(view.c, view.z);
L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
const BASES = {
  esri: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 17, maxZoom: 20, attribution: "影像 © Esri, Maxar, Earthstar Geographics" }),
  osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19, maxZoom: 20, attribution: "© OpenStreetMap" }),
  none: null,
};
let baseLayer = null;
function setBase(k) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = BASES[k] || null;
  if (baseLayer) baseLayer.addTo(map);
  S.base = k; prefs.set("base", k);
}
setBase(S.base in BASES ? S.base : "esri");

const roadLayer = L.layerGroup().addTo(map);
const labelLayer = L.layerGroup().addTo(map);
const previewLayer = L.layerGroup().addTo(map);
const findLayer = L.layerGroup().addTo(map);
let meMarker = null, accCircle = null;

map.on("moveend", () => {
  const c = map.getCenter();
  prefs.set("view", { c: [c.lat, c.lng], z: map.getZoom() });
  drawLabels();
});
map.on("dragstart", () => setFollow(false));

const llOf = (road, e, n) => fromUTM(e, n, road.crs);

function drawRoads() {
  roadLayer.clearLayers();
  for (const r of S.roads) {
    if (!r.visible) continue;
    if (!r.ll) r.ll = r.pts.map(([e, n]) => llOf(r, e, n));
    L.polyline(r.ll, { color: "#111", weight: 7, opacity: 0.55, interactive: false }).addTo(roadLayer);
    L.polyline(r.ll, { color: r.color, weight: 3.5, opacity: 1, interactive: false }).addTo(roadLayer);
  }
  drawLabels();
}

function labelStep(z) {
  if (z >= 17) return 100;
  if (z >= 16) return 200;
  if (z >= 15) return 500;
  if (z >= 14) return 1000;
  if (z >= 13) return 2000;
  if (z >= 11) return 5000;
  return 0;
}
function drawLabels() {
  labelLayer.clearLayers();
  const step = labelStep(map.getZoom());
  if (!step) return;
  const b = map.getBounds().pad(0.1);
  let count = 0;
  for (const r of S.roads) {
    if (!r.visible) continue;
    const k0 = Math.ceil(r.chMin / step), k1 = Math.floor(r.chMax / step);
    if (k1 - k0 > 4000) continue;
    for (let k = k0; k <= k1 && count < 160; k++) {
      const ch = k * step;
      const [e, n] = r.pointAt(ch);
      const ll = llOf(r, e, n);
      if (!b.contains(ll)) continue;
      const major = ch % 1000 === 0;
      L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0],
        html: `<div class="ch-dot"></div><div class="ch-label${major ? "" : " minor"}">${formatCh(ch)}</div>` }) }).addTo(labelLayer);
      count++;
    }
  }
}

/* ---------- 路段 ---------- */
async function loadRoads() {
  const raw = await store.all();
  S.roads = raw.map((d) => new Road(d));
  drawRoads();
  update();
}

/* ---------- 定位 ---------- */
function startGPS() {
  if (S.watchId != null) return;
  if (!navigator.geolocation) { toast("这个浏览器不能定位，请用 Chrome 或手机自带浏览器打开。"); return; }
  $("acc").textContent = "正在定位…";
  S.watchId = navigator.geolocation.watchPosition(onPos, (err) => {
    // 已经定到位后偶尔一次失败，不打扰
    if (err.code !== 1 && S.me) return;
    const msg = err.code === 1 ? "没有定位权限。请在浏览器设置里允许这个网站使用位置，再点定位按钮。"
      : err.code === 3 ? "定位超时，到开阔的地方再试。" : "暂时拿不到位置。";
    $("acc").textContent = "定位失败"; $("acc").dataset.level = "poor";
    toast(msg);
    if (err.code === 1) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; setFollow(false); }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  prefs.set("gps", true);
}
function onPos(p) {
  const first = !S.me;
  S.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
  const ll = [S.me.lat, S.me.lon];
  if (!meMarker) {
    accCircle = L.circle(ll, { radius: S.me.acc, color: "#2D7FF9", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    meMarker = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "", iconSize: [0, 0], html: '<div class="me-dot"></div>' }) }).addTo(map);
  } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(S.me.acc); }
  const a = S.me.acc;
  $("acc").textContent = "精度 ±" + (a < 10 ? a.toFixed(1) : Math.round(a)) + " 米";
  $("acc").dataset.level = a <= 5 ? "good" : a <= 15 ? "fair" : "poor";
  if (S.follow || first) map.setView(ll, Math.max(map.getZoom(), first ? 17 : 0), { animate: !first });
  update();
  if (S.find) drawFindLine();
}
async function setFollow(on) {
  S.follow = on;
  $("locate").setAttribute("aria-pressed", on ? "true" : "false");
  try {
    if (on && "wakeLock" in navigator && !S.wake) { S.wake = await navigator.wakeLock.request("screen"); S.wake.addEventListener("release", () => { S.wake = null; }); }
    if (!on && S.wake) { S.wake.release(); S.wake = null; }
  } catch (e) { /* 屏幕常亮不可用时忽略 */ }
}
$("locate").addEventListener("click", () => {
  startGPS();
  if (S.follow) { setFollow(false); return; }
  setFollow(true);
  if (S.me) map.setView([S.me.lat, S.me.lon], Math.max(map.getZoom(), 17));
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.follow) setFollow(true); });

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
function setChip(r, prefix = "") {
  $("roadSwatch").style.background = r ? r.color : "#6B7177";
  $("roadName").textContent = r ? prefix + r.name : S.roads.length ? "选择路段" : "还没有路段";
}
function update() {
  const ch = $("ch"), off = $("off");
  ch.className = "ch";
  if (!S.roads.length) {
    setChip(null); ch.textContent = "—"; ch.classList.add("dim");
    off.textContent = "点下方“路段”，导入 KML 或坐标文件";
    S.last = null; return;
  }
  const lockRoad = S.lock && S.roads.find((r) => r.id === S.lock);
  if (!S.me) {
    setChip(lockRoad || null, lockRoad ? "锁定 " : ""); if (!lockRoad) $("roadName").textContent = "自动选最近的路段";
    ch.textContent = "—"; ch.classList.add("dim");
    off.textContent = "点右下角的定位按钮开始";
    return;
  }
  const b = nearest();
  S.last = b;
  if (!b) { setChip(null); ch.textContent = "—"; ch.classList.add("dim"); off.textContent = "所有路段都隐藏了"; return; }
  setChip(b.r, S.lock ? "锁定 " : "");
  if (b.q.far || b.q.d > S.maxOff) {
    ch.textContent = "不在路段范围内"; ch.classList.add("small");
    const [num, unit] = distText(b.q.d).split(" ");
    off.innerHTML = `离 ${esc(b.r.name)} 最近处 <b>${num}</b>${unit}`;
    return;
  }
  ch.textContent = formatCh(b.q.ch, 0);
  const d = Math.abs(b.q.off);
  const side = d < 0.5 ? "中线上" : b.q.off > 0 ? "左" : "右";
  if (b.q.beyond) {
    const extra = b.q.beyond === "start" ? b.r.chMin - b.q.ch : b.q.ch - b.r.chMax;
    off.innerHTML = `已超出${b.q.beyond === "start" ? "起点" : "终点"}，距离 <b>${Math.round(b.q.d)}</b>米`;
    ch.textContent = formatCh(b.q.beyond === "start" ? b.r.chMin : b.r.chMax, 0);
    ch.classList.add("dim");
    return;
  }
  off.innerHTML = side === "中线上" ? `<span class="side">中线上</span>`
    : `<span class="side">${side}</span> 离中线 <b>${d < 100 ? d.toFixed(1) : Math.round(d)}</b>米`;
}

/* ---------- 面板 ---------- */
let sheetCleanup = null;
function openSheet(title, html, opts = {}) {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  $("sheetTitle").textContent = title;
  $("sheetBody").innerHTML = html;
  $("sheet").hidden = false;
  $("sheet").classList.toggle("peek", !!opts.peek);
  $("scrim").hidden = !!opts.peek;
  sheetCleanup = opts.onClose || null;
  return $("sheetBody");
}
function closeSheet() {
  $("sheet").hidden = true; $("scrim").hidden = true;
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
}
$("sheetClose").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
document.querySelectorAll(".bar [data-sheet]").forEach((b) => b.addEventListener("click", () => SHEETS[b.dataset.sheet]()));
$("roadChip").addEventListener("click", () => sheetPickRoad());

let toastT = null;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}

/* 选择/锁定路段 */
function sheetPickRoad() {
  if (!S.roads.length) { SHEETS.roads(); return; }
  const body = openSheet("当前路段", `
    <p class="note">默认自动选离你最近的路段。在路段交叉的地方，可以锁定一条。</p>
    <div class="list" role="radiogroup">
      <button class="choice" role="radio" data-id="" aria-checked="${!S.lock}">自动选最近的路段</button>
      ${S.roads.map((r) => `<button class="choice" role="radio" data-id="${r.id}" aria-checked="${S.lock === r.id}"><span class="swatch" style="background:${r.color}"></span>锁定 ${esc(r.name)}</button>`).join("")}
    </div>`);
  body.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => {
    S.lock = b.dataset.id || null; prefs.set("lock", S.lock); closeSheet(); update();
  }));
}

const SHEETS = {
  roads() {
    const body = openSheet("路段", `
      ${S.roads.length ? `<ul class="list">${S.roads.map((r) => `
        <li data-id="${r.id}">
          <span class="swatch" style="background:${r.color}"></span>
          <div class="meta"><b>${esc(r.name)}</b><small><span class="num">${formatCh(r.chMin)}</span> ～ <span class="num">${formatCh(r.chMax)}</span>，长 ${(r.length / 1000).toFixed(2)} 公里</small></div>
          <button class="icon-btn" data-act="zoom" aria-label="在地图上查看 ${esc(r.name)}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg></button>
          <button class="icon-btn" data-act="toggle" aria-pressed="${r.visible}" aria-label="显示或隐藏 ${esc(r.name)}"><svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="icon-btn" data-act="edit" aria-label="修改 ${esc(r.name)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        </li>`).join("")}</ul>`
        : `<p class="empty">还没有路段。导入测量组的 KML（从奥维导出）或坐标文件（XYZ / CSV / DAT），就能显示桩号。</p>`}
      <div class="actions"><button class="btn primary" id="btnImport">导入路段</button></div>
      <p class="note">支持 KML、KMZ，以及每行“桩号、北坐标、东坐标”的坐标文件。数据只保存在这台手机里。</p>`);
    body.querySelector("#btnImport").addEventListener("click", () => $("fileRoad").click());
    body.querySelectorAll("li[data-id]").forEach((li) => {
      const r = S.roads.find((x) => x.id === li.dataset.id);
      li.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        if (act === "zoom") { closeSheet(); setFollow(false); map.fitBounds(L.latLngBounds(r.ll || r.pts.map(([e, n]) => llOf(r, e, n))), { padding: [30, 30] }); }
        if (act === "toggle") { r.visible = !r.visible; await saveRoad(r); btn.setAttribute("aria-pressed", r.visible); drawRoads(); update(); }
        if (act === "edit") sheetEditRoad(r);
      }));
    });
  },
  find() { sheetFind(); },
  more() { sheetMore(); },
};

function plainRoad(r) {
  return { id: r.id, name: r.name, color: r.color, visible: r.visible, crs: r.crs, pts: r.pts, cal: r.cal, info: r.info, order: r.order, created: r.created, source: r.source };
}
async function saveRoad(r) { await store.put(plainRoad(r)); }

function colorPicker(sel) {
  return `<div class="colors" role="radiogroup" aria-label="颜色">${COLORS.map((c) => `<button type="button" role="radio" data-c="${c}" aria-checked="${c === sel}" style="background:${c}" aria-label="颜色 ${c}"></button>`).join("")}</div>`;
}
function bindColors(root, onPick) {
  root.querySelectorAll(".colors button").forEach((b) => b.addEventListener("click", () => {
    root.querySelectorAll(".colors button").forEach((x) => x.setAttribute("aria-checked", x === b));
    onPick(b.dataset.c);
  }));
}

function sheetEditRoad(r) {
  let color = r.color, confirmDel = false;
  const body = openSheet("修改路段", `
    <label class="field"><span>名称</span><input id="edName" value="${esc(r.name)}" maxlength="40"></label>
    <div class="field"><span>颜色</span>${colorPicker(r.color)}</div>
    <div class="summary"><dl>
      <dt>桩号范围</dt><dd><span class="num">${formatCh(r.chMin)}</span> ～ <span class="num">${formatCh(r.chMax)}</span></dd>
      <dt>中线长度</dt><dd>${(r.length / 1000).toFixed(3)} 公里</dd>
      <dt>来源</dt><dd>${esc(r.source || "")}</dd>
    </dl></div>
    <div class="actions"><button class="btn primary" id="edSave">保存</button></div>
    <div class="actions"><button class="btn danger" id="edDel">删除这条路段</button></div>`);
  bindColors(body, (c) => { color = c; });
  body.querySelector("#edSave").addEventListener("click", async () => {
    r.name = body.querySelector("#edName").value.trim() || r.name; r.color = color;
    await saveRoad(r); drawRoads(); update(); SHEETS.roads(); toast("已保存");
  });
  body.querySelector("#edDel").addEventListener("click", async (e) => {
    if (!confirmDel) { confirmDel = true; e.currentTarget.textContent = "再点一次，确认删除"; return; }
    await store.remove(r.id);
    if (S.lock === r.id) { S.lock = null; prefs.set("lock", null); }
    await loadRoads(); SHEETS.roads(); toast("已删除：" + r.name);
  });
}

/* ---------- 导入 ---------- */
$("fileRoad").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const base = f.name.replace(/\.[^.]+$/, "");
  try {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (ext === "kmz") { importKML(await readKMZ(f), base); return; }
    const text = await readText(f);
    if (ext === "kml" || /<kml[\s>]/i.test(text.slice(0, 2000))) importKML(text, base);
    else importTable(text, base);
  } catch (err) {
    openSheet("导入路段", `<p class="err">${esc(err.message || String(err))}</p><div class="actions"><button class="btn" id="again">换一个文件</button></div>`)
      .querySelector("#again").addEventListener("click", () => $("fileRoad").click());
  }
});
async function readText(f) {
  const buf = await f.arrayBuffer();
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) { try { t = new TextDecoder("gbk").decode(buf); } catch (e) { /* 保持 utf-8 */ } }
  return t.replace(/^﻿/, "");
}
function nextColor() { return COLORS[S.roads.length % COLORS.length]; }

function previewRoad(data) {
  previewLayer.clearLayers();
  const r = new Road(data);
  const ll = r.pts.map(([e, n]) => fromUTM(e, n, r.crs));
  L.polyline(ll, { color: "#fff", weight: 8, opacity: 0.8, dashArray: "1 10", lineCap: "round", interactive: false }).addTo(previewLayer);
  L.polyline(ll, { color: data.color || "#FFC81E", weight: 4, interactive: false }).addTo(previewLayer);
  map.fitBounds(L.latLngBounds(ll), { padding: [20, 20] });
  return r;
}

function roadSummary(r, extra = "") {
  const i = r.info || {};
  const how = i.mode === "line+points" ? `中线 + ${i.used} 个桩号点校正` : i.mode === "points" ? `${i.used} 个桩号点连线` : "只有中线，按起点桩号推算";
  return `<div class="summary"><dl>
    <dt>桩号范围</dt><dd><span class="num">${formatCh(r.chMin)}</span> ～ <span class="num">${formatCh(r.chMax)}</span></dd>
    <dt>中线长度</dt><dd>${(r.length / 1000).toFixed(3)} 公里</dd>
    <dt>桩号来源</dt><dd>${how}${i.mode === "line+points" ? `，桩号点离中线最远 ${i.maxOff.toFixed(1)} 米` : ""}</dd>
    ${extra}
  </dl></div>`;
}

async function saveNew(data, name, color, source) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await store.put({ ...data, id, name, color, visible: true, order: Date.now(), created: new Date().toISOString(), source });
  previewLayer.clearLayers();
  await askPersist();
  await loadRoads();
  closeSheet();
  toast("已保存：" + name);
}

function importKML(text, base) {
  const kml = parseKML(text);
  const a = analyzeKML(kml);
  // 默认名称：用最外层文件夹名（奥维导出时就是路段名），去掉 .dxf、-奥维 之类的后缀
  const top = (kml.lines[0]?.folder || kml.points[0]?.folder || "").split(" / ")[0];
  if (top) base = top.replace(/\.dxf$/i, "").replace(/[-_ ]?奥维$/, "").trim() || base;
  const st = a.stations, cands = a.candidates;
  const chs = st.map((p) => p.ch);
  let color = nextColor();
  const best = cands[0];
  let mode = best && best.hit >= 0.7 ? "line:" + best.id : st.length >= 2 ? "points" : best ? "line:" + best.id : "";
  if (!mode) throw new Error("文件里没有找到可以当作中线的线，也没有桩号点。");
  const body = openSheet("导入路段", `
    <div class="summary"><dl>
      <dt>桩号点</dt><dd>${st.length ? `${st.length} 个，<span class="num">${formatCh(Math.min(...chs))}</span> ～ <span class="num">${formatCh(Math.max(...chs))}</span>${a.plainUsed ? "（点名是米数）" : ""}` : "没有找到（点名不是桩号格式）"}</dd>
      <dt>线</dt><dd>${cands.length} 条可选</dd>
    </dl></div>
    <label class="field"><span>中线用哪条</span><select id="imLine">
      ${cands.slice(0, 15).map((c) => `<option value="line:${c.id}">${esc(c.name || "未命名线")}${c.folder ? "（" + esc(c.folder) + "）" : ""}，${(c.len / 1000).toFixed(2)} 公里${st.length ? `，${Math.round(c.hit * 100)}% 桩号点在线上` : ""}</option>`).join("")}
      ${st.length >= 2 ? `<option value="points">不用线，直接把桩号点连起来</option>` : ""}
    </select></label>
    <div id="imStart" hidden>
      <div class="row">
        <label class="field"><span>起点桩号</span><input id="imCh0" class="big" value="K0+000" inputmode="text"></label>
        <label class="field"><span>方向</span><select id="imDir"><option value="f">按画线方向</option><option value="r">反过来</option></select></label>
      </div>
    </div>
    <div id="imSum"></div>
    <label class="field"><span>路段名称</span><input id="imName" value="${esc(base)}" maxlength="40"></label>
    <div class="field"><span>颜色</span>${colorPicker(color)}</div>
    <div class="actions"><button class="btn" id="imCancel">取消</button><button class="btn primary" id="imSave">保存路段</button></div>`,
  { onClose: () => previewLayer.clearLayers() });
  const sel = body.querySelector("#imLine"); sel.value = mode;
  let data = null;
  const rebuild = () => {
    const v = sel.value;
    const line = v.startsWith("line:") ? cands.find((c) => "line:" + c.id === v).pts : null;
    const ch0 = parseCh(body.querySelector("#imCh0").value, true);
    const useStations = v === "points" || st.length >= 2;
    let ln = line;
    if (ln && body.querySelector("#imDir").value === "r") ln = ln.slice().reverse();
    data = buildRoad({ name: "", crs: a.crs, line: ln, stations: useStations ? st : [], startCh: ch0 ?? 0 });
    body.querySelector("#imStart").hidden = data.info.mode !== "line";
    data.color = color;
    try {
      const r = previewRoad(data);
      body.querySelector("#imSum").innerHTML = roadSummary(r, data.info.mode === "line" && st.length >= 2 ? `<dt>注意</dt><dd>这条线和桩号点对不上，桩号只按起点推算</dd>` : "");
    } catch (e) { body.querySelector("#imSum").innerHTML = `<p class="err">这条线无法生成路段。</p>`; data = null; }
  };
  sel.addEventListener("change", rebuild);
  body.querySelector("#imCh0").addEventListener("change", rebuild);
  body.querySelector("#imDir").addEventListener("change", rebuild);
  bindColors(body, (c) => { color = c; rebuild(); });
  body.querySelector("#imCancel").addEventListener("click", closeSheet);
  body.querySelector("#imSave").addEventListener("click", () => {
    if (!data) return;
    if (data.info.mode === "line" && parseCh(body.querySelector("#imCh0").value, true) == null) { toast("起点桩号格式不对，例如 K0+000"); return; }
    saveNew(data, body.querySelector("#imName").value.trim() || base, color, "KML 文件");
  });
  rebuild();
}

function importTable(text, base) {
  const t = parseTable(text);
  if (t.rows.length < 2) throw new Error("文件里有效的行太少，至少要两个点。");
  let color = nextColor();
  const opts = (sel) => `<option value="-1">（没有）</option>` + t.cols.map((c) => `<option value="${c.index}" ${c.index === sel ? "selected" : ""}>${esc(c.title)}：${esc(c.sample)}</option>`).join("");
  const crs0 = prefs.get("crs", { zone: 28, south: false });
  const body = openSheet("导入坐标文件", `
    <div class="preview-table"><table>
      <tr>${t.cols.map((c) => `<th>${esc(c.title)}</th>`).join("")}</tr>
      ${t.rows.slice(0, 4).map((r) => `<tr>${t.cols.map((c) => `<td>${esc(r[c.index] ?? "")}</td>`).join("")}</tr>`).join("")}
    </table></div>
    <p class="note">共 ${t.rows.length} 行。国内测量习惯里 X 是北坐标、Y 是东坐标，请对照上面的数据确认。</p>
    <label class="field"><span>桩号列</span><select id="tbName">${opts(t.guess.name)}</select></label>
    <div class="row">
      <label class="field"><span>北坐标（X）</span><select id="tbN">${opts(t.guess.north)}</select></label>
      <label class="field"><span>东坐标（Y）</span><select id="tbE">${opts(t.guess.east)}</select></label>
    </div>
    <div class="row">
      <label class="field"><span>坐标系 UTM 投影带</span><input id="tbZone" type="number" min="1" max="60" value="${crs0.zone}" inputmode="numeric"></label>
      <label class="field"><span>半球</span><select id="tbHemi"><option value="n">北半球</option><option value="s" ${crs0.south ? "selected" : ""}>南半球</option></select></label>
    </div>
    <div id="tbSum"></div>
    <label class="field"><span>路段名称</span><input id="tbNameIn" value="${esc(base)}" maxlength="40"></label>
    <div class="field"><span>颜色</span>${colorPicker(color)}</div>
    <div class="actions"><button class="btn" id="tbCancel">取消</button><button class="btn primary" id="tbSave">保存路段</button></div>`,
  { onClose: () => previewLayer.clearLayers() });
  let data = null, crs = null;
  const rebuild = () => {
    const map_ = { name: +body.querySelector("#tbName").value, north: +body.querySelector("#tbN").value, east: +body.querySelector("#tbE").value };
    crs = { zone: Math.min(60, Math.max(1, +body.querySelector("#tbZone").value || 28)), south: body.querySelector("#tbHemi").value === "s" };
    const out = body.querySelector("#tbSum");
    data = null;
    if (map_.name < 0 || map_.north < 0 || map_.east < 0) { out.innerHTML = `<p class="err">请选好桩号列和两列坐标。</p>`; return; }
    const st = tableStations(t, map_, crs);
    if (st.length < 2) { out.innerHTML = `<p class="err">按这样的列对应，读不出桩号和坐标。检查一下桩号列是不是选对了。</p>`; return; }
    const [lat] = fromUTM(st[0].e, st[0].n, crs);
    if (!isFinite(lat) || Math.abs(lat) > 84) { out.innerHTML = `<p class="err">坐标换算出来不在地球上，可能北、东两列选反了，或者不是 UTM 坐标。</p>`; return; }
    data = buildRoad({ name: "", crs, line: null, stations: st });
    data.color = color;
    const r = previewRoad(data);
    out.innerHTML = roadSummary(r, `<dt>检查</dt><dd>看地图上的线是否落在路上；不对就调换北、东两列</dd>`);
  };
  ["#tbName", "#tbN", "#tbE", "#tbZone", "#tbHemi"].forEach((s) => body.querySelector(s).addEventListener("change", rebuild));
  bindColors(body, (c) => { color = c; if (data) { data.color = c; previewRoad(data); } });
  body.querySelector("#tbCancel").addEventListener("click", closeSheet);
  body.querySelector("#tbSave").addEventListener("click", () => {
    if (!data) { toast("还不能保存，请先把列对应好"); return; }
    prefs.set("crs", crs);
    saveNew(data, body.querySelector("#tbNameIn").value.trim() || base, color, "坐标文件");
  });
  rebuild();
}

/* ---------- 找桩号 ---------- */
function parseFind(text) {
  const s = text.trim().replace(/\s+/g, "");
  const m = s.match(/^([Kk]?\d+(?:\+\d+(?:\.\d+)?)?(?:\.\d+)?)(?:(左|右|[LlRr])(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const ch = parseCh(m[1], true);
  if (ch == null) return null;
  let off = 0;
  if (m[2]) off = (/左|l/i.test(m[2]) ? 1 : -1) * parseFloat(m[3]);
  return { ch, off };
}
function sheetFind() {
  if (!S.roads.length) { SHEETS.roads(); return; }
  const cur = S.last?.r?.id || S.lock || S.roads[0].id;
  const body = openSheet("找桩号", `
    <label class="field"><span>桩号</span><input id="fdText" class="big" placeholder="例如 95+300 或 95+300左12" value="${esc(S.find?.text || "")}" autocomplete="off" enterkeyhint="search"></label>
    ${S.roads.length > 1 ? `<label class="field"><span>路段</span><select id="fdRoad">${S.roads.map((r) => `<option value="${r.id}" ${r.id === (S.find?.roadId || cur) ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>` : ""}
    <div class="actions"><button class="btn" id="fdClear" ${S.find ? "" : "hidden"}>清除标记</button><button class="btn primary" id="fdGo">在地图上标出</button></div>
    <div id="fdOut"></div>`);
  const go = () => {
    const q = parseFind(body.querySelector("#fdText").value);
    const out = body.querySelector("#fdOut");
    if (!q) { out.innerHTML = `<p class="err">没看懂这个桩号。可以输入 95+300、K95+300，或 95+300左12。</p>`; return; }
    const roadId = body.querySelector("#fdRoad")?.value || S.roads[0].id;
    const r = S.roads.find((x) => x.id === roadId);
    if (q.ch < r.chMin - 1 || q.ch > r.chMax + 1) { out.innerHTML = `<p class="err">${esc(r.name)} 的桩号范围是 ${formatCh(r.chMin)} ～ ${formatCh(r.chMax)}。</p>`; return; }
    S.find = { text: body.querySelector("#fdText").value.trim(), roadId, ...q };
    drawFind();
    closeSheet();
    showFindResult();
  };
  body.querySelector("#fdGo").addEventListener("click", go);
  body.querySelector("#fdText").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  body.querySelector("#fdClear").addEventListener("click", () => { S.find = null; findLayer.clearLayers(); closeSheet(); });
  setTimeout(() => body.querySelector("#fdText").focus(), 50);
}
function findTarget() {
  const f = S.find; if (!f) return null;
  const r = S.roads.find((x) => x.id === f.roadId); if (!r) return null;
  const [e, n] = r.pointAt(f.ch, f.off);
  return { r, e, n, ll: fromUTM(e, n, r.crs) };
}
function findLabel() {
  const f = S.find;
  return formatCh(f.ch, f.ch % 1 ? 1 : 0) + (f.off ? (f.off > 0 ? " 左" : " 右") + Math.abs(f.off) : "");
}
function drawFind() {
  findLayer.clearLayers();
  const t = findTarget(); if (!t) return;
  L.marker(t.ll, { keyboard: false, interactive: false, zIndexOffset: 900, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="stake"><span>${esc(findLabel())}</span></div>` }) }).addTo(findLayer);
  drawFindLine();
  setFollow(false);
  if (S.me) map.fitBounds(L.latLngBounds([t.ll, [S.me.lat, S.me.lon]]), { padding: [60, 60], maxZoom: 17 });
  else map.setView(t.ll, 17);
}
let findLine = null;
function drawFindLine() {
  const t = findTarget();
  if (findLine) { findLayer.removeLayer(findLine); findLine = null; }
  if (!t || !S.me) return;
  findLine = L.polyline([[S.me.lat, S.me.lon], t.ll], { color: "#E0312A", weight: 3, dashArray: "6 8", interactive: false }).addTo(findLayer);
}
function showFindResult() {
  const t = findTarget(); if (!t) return;
  let rows = `<p><span class="num">${esc(findLabel())}</span>（${esc(t.r.name)}）</p>
    <p>坐标 北 <span class="num">${t.n.toFixed(3)}</span> 东 <span class="num">${t.e.toFixed(3)}</span></p>`;
  if (S.me) {
    const [me, mn] = toUTM(S.me.lat, S.me.lon, t.r.crs);
    const d = Math.hypot(t.e - me, t.n - mn);
    rows += `<p>直线距离 <span class="num">${esc(distText(d))}</span>，方位：${bearingText(t.e - me, t.n - mn)}</p>`;
    const q = t.r.locate(me, mn);
    if (!q.far && q.d <= S.maxOff) {
      const diff = S.find.ch - q.ch;
      rows += `<p>沿路${diff >= 0 ? "往桩号增大方向" : "往桩号减小方向"}还有 <span class="num">${esc(distText(Math.abs(diff)))}</span></p>`;
    }
  } else rows += `<p class="note">打开定位后，可以看到离你多远、在哪个方向。</p>`;
  const body = openSheet("找桩号", `<div class="result">${rows}</div>
    <div class="actions"><button class="btn" id="frClear">清除标记</button><button class="btn" id="frAgain">换一个桩号</button></div>`, { peek: true });
  body.querySelector("#frClear").addEventListener("click", () => { S.find = null; findLayer.clearLayers(); findLine = null; closeSheet(); });
  body.querySelector("#frAgain").addEventListener("click", sheetFind);
}

/* ---------- 更多 ---------- */
function sheetMore() {
  const body = openSheet("更多", `
    <div class="field"><span>底图</span>
      <div class="seg" role="radiogroup">
        ${[["esri", "卫星影像"], ["osm", "道路图"], ["none", "不显示"]].map(([k, t]) => `<button type="button" role="radio" data-base="${k}" aria-checked="${S.base === k}">${t}</button>`).join("")}
      </div>
    </div>
    <label class="field"><span>离中线多远以内才显示桩号</span><select id="mMax">
      ${[100, 200, 300, 500, 1000, 2000].map((v) => `<option value="${v}" ${v === S.maxOff ? "selected" : ""}>${v} 米</option>`).join("")}
    </select></label>
    <div class="field"><span>备份</span>
      <div class="row"><button class="btn" id="mExport">导出备份</button><button class="btn" id="mImport">恢复备份</button></div>
    </div>
    <p class="note">路段只保存在这台手机的浏览器里。清理浏览器数据会把它们删掉，换手机前请先导出备份。备份文件也可以发给同事，对方点“恢复备份”就能用同样的路段。</p>
    <button class="btn" id="mInstall" ${S.installEvt ? "" : "hidden"}>添加到手机桌面</button>
    <p class="note" id="mInstallTip">${S.installEvt ? "" : "想像软件一样从桌面打开：安卓 Chrome 点右上角菜单，选“添加到主屏幕”；苹果 Safari 点分享按钮，选“添加到主屏幕”。"}</p>
    <p class="note">桩号由手机定位换算，误差一般 3～5 米，只用来知道自己在哪，不能用于放样。影像来自 Esri，放大到 17 级以上会变模糊。版本 ${VERSION}</p>`);
  body.querySelectorAll("[data-base]").forEach((b) => b.addEventListener("click", () => {
    setBase(b.dataset.base);
    body.querySelectorAll("[data-base]").forEach((x) => x.setAttribute("aria-checked", x === b));
  }));
  body.querySelector("#mMax").addEventListener("change", (e) => { S.maxOff = +e.target.value; prefs.set("maxOff", S.maxOff); update(); });
  body.querySelector("#mExport").addEventListener("click", exportBackup);
  body.querySelector("#mImport").addEventListener("click", () => $("fileBackup").click());
  body.querySelector("#mInstall").addEventListener("click", async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; closeSheet();
  });
}
async function exportBackup() {
  if (!S.roads.length) { toast("还没有路段可以备份"); return; }
  const data = { app: "zhuanghao", version: 1, exported: new Date().toISOString(), roads: S.roads.map(plainRoad) };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const d = new Date();
  const name = `桩号备份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("备份已下载：" + name);
}
$("fileBackup").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== "zhuanghao" || !Array.isArray(data.roads)) throw new Error("bad");
    let n = 0;
    const have = new Set(S.roads.map((r) => r.id));
    for (const r of data.roads) {
      if (!r.id || !Array.isArray(r.pts) || !Array.isArray(r.cal)) continue;
      if (have.has(r.id)) continue;
      await store.put(r); n++;
    }
    await loadRoads(); closeSheet();
    toast(n ? `已恢复 ${n} 条路段` : "这些路段手机里已经有了");
  } catch (err) { toast("这个文件不是桩号工具的备份。"); }
});

/* ---------- 启动 ---------- */
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
loadRoads().then(async () => {
  let granted = false;
  try { granted = (await navigator.permissions.query({ name: "geolocation" })).state === "granted"; } catch (e) { granted = prefs.get("gps", false); }
  if (granted) { startGPS(); }
  update();
});
window.__zh = { S, map, loadRoads, update }; // 调试用
