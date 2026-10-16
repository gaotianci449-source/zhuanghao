// 轨迹：边走边记录，保存后可改名改色、显示隐藏、算周长面积、导出 KML
import { distLL, measureLL, lenText, areaText } from "./geo.js";
import { tracksDB, askPersist, newId } from "./store.js";
import { S, hooks } from "./state.js";
import { map, liveLayer } from "./map.js";
import { $, esc, toast, openSheet, closeSheet, colorPicker, bindColors, confirmTwice, nextColor, dateText, durText, ICON } from "./ui.js";
import { shareKML } from "./kmlout.js";
import { T } from "./i18n.js";

const MAX_ACC = 30;   // 精度差于 30 米的点不要
const MIN_STEP = 3;   // 离上一个点不到 3 米不记（站着不动时 GPS 会飘）
let live = null, timer = null, weak = 0;

export async function loadTracks() {
  const all = await tracksDB.all();
  // 上次记录到一半页面被关掉：把已记录的部分保存下来
  let fixed = 0;
  for (const t of all) {
    if (t.recording && t.pts.length < 2) { await tracksDB.remove(t.id); continue; }
    if (t.recording) { t.recording = false; t.end = t.end || t.pts[t.pts.length - 1]?.[2] || t.start; await tracksDB.put(t); fixed++; }
  }
  S.tracks = all.filter((t) => !t.recording);
  hooks.drawOverlays();
  if (fixed && !S.rec) toast(T("上次记录的轨迹已经保存在“轨迹”里"));
}

const titleOf = (d = new Date()) => T("轨迹 {d}", { d: dateText(d.toISOString()) });

export async function startRec() {
  if (S.rec) return;
  hooks.startGPS();
  const now = Date.now();
  const t = { id: newId(), name: titleOf(), color: nextColor([...S.roads, ...S.tracks, ...S.shapes].map((x) => x.color)), visible: true,
    pts: [], length: 0, start: now, end: now, recording: true, order: now };
  await tracksDB.put(t);
  S.rec = { t, saved: now };
  weak = 0;
  $("recbar").hidden = false;
  drawLive();
  tick();
  timer = setInterval(tick, 1000);
  hooks.updateWake();
  askPersist();
  if (S.me) addPoint(S.me);
}

function addPoint(me) {
  const R = S.rec; if (!R) return;
  if (me.acc > MAX_ACC) { weak++; tick(); return; }
  weak = 0;
  const t = R.t, p = [me.lat, me.lon, me.t || Date.now(), Math.round(me.acc * 10) / 10];
  const last = t.pts[t.pts.length - 1];
  if (last) {
    const d = distLL(last, p);
    if (d < MIN_STEP) return;
    const dt = (p[2] - last[2]) / 1000;
    if (dt > 0 && d / dt > 60) return; // 超过 60 米/秒，是跳点
    t.length += d;
  }
  t.pts.push(p);
  t.end = p[2];
  if (live) live.addLatLng([p[0], p[1]]);
  tick();
  if (Date.now() - R.saved > 10000) { R.saved = Date.now(); tracksDB.put(t); }
}
hooks.onPos.push((me) => { if (S.rec) addPoint(me); });

function drawLive() {
  liveLayer.eachLayer((l) => { if (l.options.rec) liveLayer.removeLayer(l); });
  if (!S.rec) { live = null; return; }
  live = L.polyline(S.rec.t.pts.map((p) => [p[0], p[1]]), { rec: true, color: S.rec.t.color, weight: 4, opacity: 1, interactive: false }).addTo(liveLayer);
}

function tick() {
  const R = S.rec; if (!R) return;
  $("recDist").textContent = lenText(R.t.length);
  $("recTime").textContent = durText(Date.now() - R.t.start);
  const w = $("recWarn");
  if (S.watchId == null || !S.me) { w.hidden = false; w.textContent = T("等待定位…"); }
  else if (weak >= 3) { w.hidden = false; w.textContent = T("信号弱，暂时不记"); }
  else w.hidden = true;
}

export async function stopRec() {
  const R = S.rec; if (!R) return;
  clearInterval(timer); timer = null;
  S.rec = null;
  $("recbar").hidden = true;
  drawLive();
  hooks.updateWake();
  const t = R.t;
  t.recording = false;
  if (t.pts.length < 2) { await tracksDB.remove(t.id); toast(T("轨迹太短，没有保存")); return; }
  await tracksDB.put(t);
  S.tracks.push(t);
  hooks.drawOverlays();
  sheetEditTrack(t, true);
}
$("recStop").addEventListener("click", stopRec);

const metaOf = (t) => `${dateText(new Date(t.start).toISOString())} · ${lenText(t.length)} · ${durText(t.end - t.start)}`;
const zoomTo = (pts) => { if (pts.length) { hooks.setFollow(false); map.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]])), { padding: [40, 40], maxZoom: 18 }); } };

export function sheetTracks() {
  const body = openSheet(T("轨迹"), `
    ${S.rec ? `<div class="result live"><p><b>${T("正在记录")}</b> ${lenText(S.rec.t.length)}</p></div>
      <div class="actions"><button class="btn danger" id="tkStop">${T("停止并保存")}</button></div>`
    : `<div class="actions"><button class="btn primary" id="tkStart">${T("开始记录轨迹")}</button></div>`}
    <p class="note">${T("记录时请让屏幕保持亮着、停在这个页面。锁屏或切到别的软件后，手机会暂停定位，那一段会变成一条直线。")}</p>
    ${S.tracks.length ? `<ul class="list">${S.tracks.map((t) => `
      <li data-id="${t.id}">
        <span class="swatch line dash" style="background:${t.color}"></span>
        <div class="meta"><b>${esc(t.name)}</b><small>${metaOf(t)}</small></div>
        <button class="icon-btn" data-act="zoom" aria-label="${T("在地图上查看")} ${esc(t.name)}">${ICON.zoom}</button>
        <button class="icon-btn" data-act="toggle" aria-pressed="${t.visible}" aria-label="${T("显示或隐藏")} ${esc(t.name)}">${ICON.eye}</button>
        <button class="icon-btn" data-act="edit" aria-label="${T("修改")} ${esc(t.name)}">${ICON.edit}</button>
      </li>`).join("")}</ul>` : `<p class="empty">${T("还没有保存的轨迹。")}</p>`}`);
  body.querySelector("#tkStart")?.addEventListener("click", async () => { await startRec(); closeSheet(); toast(T("开始记录。走完后点下方的“停止”")); });
  body.querySelector("#tkStop")?.addEventListener("click", stopRec);
  body.querySelectorAll("li[data-id]").forEach((li) => {
    const t = S.tracks.find((x) => x.id === li.dataset.id);
    li.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "zoom") { if (!t.visible) { t.visible = true; await tracksDB.put(t); hooks.drawOverlays(); } closeSheet(); zoomTo(t.pts); }
      if (act === "toggle") { t.visible = !t.visible; await tracksDB.put(t); btn.setAttribute("aria-pressed", t.visible); hooks.drawOverlays(); }
      if (act === "edit") sheetEditTrack(t);
    }));
  });
}

function sheetEditTrack(t, justStopped = false) {
  let color = t.color;
  const m = measureLL(t.pts);
  const area = areaText(m.area);
  const body = openSheet(justStopped ? T("轨迹已保存") : T("修改轨迹"), `
    <label class="field"><span>${T("名称")}</span><input id="tkName" value="${esc(t.name)}" maxlength="40"></label>
    <div class="field"><span>${T("颜色")}</span>${colorPicker(t.color)}</div>
    <div class="summary"><dl>
      <dt>${T("长度")}</dt><dd><span class="num">${lenText(t.length)}</span></dd>
      <dt>${T("用时")}</dt><dd>${durText(t.end - t.start)}</dd>
      <dt>${T("开始")}</dt><dd>${dateText(new Date(t.start).toISOString())}</dd>
      <dt>${T("点数")}</dt><dd>${t.pts.length}</dd>
    </dl></div>
    ${t.pts.length >= 3 ? `<div class="summary"><p class="sum-title">${T("当成闭合图形计算（首尾连起来）")}</p><dl>
      <dt>${T("周长")}</dt><dd><span class="num">${lenText(m.perimeter)}</span></dd>
      <dt>${T("面积")}</dt><dd>${area.map((x) => `<span class="num">${x}</span>`).join("<br>")}</dd>
      <dt>${T("首尾相距")}</dt><dd>${lenText(m.gap)}${m.gap > 20 ? `<br><small class="warn">${T("起点和终点离得比较远，这个面积只能参考。绕一圈回到起点再停止，面积才准。")}</small>` : ""}</dd>
    </dl></div>` : ""}
    <p class="note">${T("手机定位误差一般 3～5 米，量出来的长度和面积只能参考，不能代替全站仪或 RTK。")}</p>
    <div class="actions"><button class="btn" id="tkKml">${T("导出 KML")}</button><button class="btn primary" id="tkSave">${T("保存")}</button></div>
    <div class="actions"><button class="btn danger" id="tkDel">${T("删除这条轨迹")}</button></div>`);
  bindColors(body, (c) => { color = c; });
  const apply = async () => {
    t.name = body.querySelector("#tkName").value.trim() || t.name; t.color = color;
    await tracksDB.put(t); hooks.drawOverlays();
  };
  body.querySelector("#tkSave").addEventListener("click", async () => { await apply(); sheetTracks(); toast(T("已保存")); });
  body.querySelector("#tkKml").addEventListener("click", async () => {
    await apply();
    shareKML(t.name, [{ name: t.name, color: t.color, pts: t.pts, desc: `${T("长度")} ${lenText(t.length)}` }]);
  });
  confirmTwice(body.querySelector("#tkDel"), T("再点一次，确认删除"), async () => {
    await tracksDB.remove(t.id);
    S.tracks = S.tracks.filter((x) => x.id !== t.id);
    hooks.drawOverlays(); sheetTracks(); toast(T("已删除：{name}", { name: t.name }));
  });
}

// 刷新页面或页面被系统关掉前，把正在记录的轨迹存一下
window.addEventListener("pagehide", () => { if (S.rec) tracksDB.put(S.rec.t); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && S.rec) tracksDB.put(S.rec.t); });
