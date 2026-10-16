// 测量：在地图上点点，或者走到位置点“取当前位置”；量距离或量面积（周长、平方米、公顷、亩）
import { measureLL, lenText, areaText } from "./geo.js";
import { shapesDB, askPersist, newId } from "./store.js";
import { S, hooks } from "./state.js";
import { map, liveLayer } from "./map.js";
import { $, esc, toast, openSheet, closeSheet, colorPicker, bindColors, confirmTwice, nextColor, dateText, ICON } from "./ui.js";
import { shareKML } from "./kmlout.js";
import { T } from "./i18n.js";

let exitArmed = false, clearArmed = false;

export function startMeasure(mode = "line") {
  closeSheet();
  S.measure = { mode, pts: [] };
  $("tool").hidden = false;
  document.body.classList.add("measuring");
  hooks.onMapClick = (ll) => addPt([ll.lat, ll.lng]);
  hooks.setFollow(false);
  setMode(mode);
  render();
}
function exitMeasure() {
  S.measure = null;
  $("tool").hidden = true;
  document.body.classList.remove("measuring");
  hooks.onMapClick = null;
  clearLive();
}
function setMode(mode) {
  S.measure.mode = mode;
  document.querySelectorAll("#msMode [data-mode]").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === mode));
  render();
}
function addPt(p) {
  if (!S.measure) return;
  S.measure.pts.push(p);
  disarm();
  render();
}
function disarm() {
  exitArmed = false; clearArmed = false;
  $("msClear").textContent = T("清空");
}

function clearLive() { liveLayer.eachLayer((l) => { if (l.options.ms) liveLayer.removeLayer(l); }); }
function render() {
  clearLive();
  const M = S.measure; if (!M) return;
  const pts = M.pts, area = M.mode === "area";
  // 白线加黑边：在卫星图上和各色路段都分得开
  const line = (ll, dash) => {
    L.polyline(ll, { ms: true, color: "#000", weight: 6, opacity: 0.5, interactive: false }).addTo(liveLayer);
    L.polyline(ll, { ms: true, color: "#fff", weight: 3, dashArray: dash, interactive: false }).addTo(liveLayer);
  };
  if (pts.length >= 2) {
    if (area && pts.length >= 3) {
      L.polygon(pts, { ms: true, stroke: false, fillColor: "#fff", fillOpacity: 0.25, interactive: false }).addTo(liveLayer);
      line([...pts, pts[0]]);
    } else line(pts, area ? "6 6" : null);
  }
  pts.forEach((p, i) => L.circleMarker(p, { ms: true, radius: i === 0 ? 7 : 5, color: "#1E2124", weight: 2, fillColor: i === 0 ? "#E0312A" : "#fff", fillOpacity: 1, interactive: false }).addTo(liveLayer));
  const m = measureLL(pts);
  const out = $("msOut");
  if (!pts.length) out.innerHTML = `<p class="hint">${T("点地图加点，或者走到位置上点“取当前位置”。")}</p>`;
  else if (!area) {
    const lastSeg = pts.length >= 2 ? measureLL(pts.slice(-2)).length : 0;
    out.innerHTML = `<div class="ms-big"><small>${T("总长")}</small><b>${lenText(m.length)}</b></div>
      <p class="hint">${T("{n} 个点", { n: pts.length })}${pts.length >= 2 ? " · " + T("最后一段 {d}", { d: lenText(lastSeg) }) : ""}</p>`;
  } else if (pts.length < 3) out.innerHTML = `<p class="hint">${T("{n} 个点，至少 3 个点才能算面积。", { n: pts.length })}</p>`;
  else {
    const a = areaText(m.area);
    out.innerHTML = `<div class="ms-big"><small>${T("面积")}</small><b>${a[0]}</b></div>
      <p class="hint">${a.slice(1).join(" · ")} · ${T("周长")} ${lenText(m.perimeter)} · ${T("{n} 个点", { n: pts.length })}</p>`;
  }
  $("msUndo").disabled = !pts.length;
  $("msClear").disabled = !pts.length;
  $("msSave").disabled = pts.length < (area ? 3 : 2);
}

$("msMode").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b && S.measure) setMode(b.dataset.mode); });
$("msHere").addEventListener("click", () => {
  if (!S.me) { hooks.startGPS(); toast(T("还没有定位，等定位成功后再点。")); return; }
  if (S.me.acc > 10) toast(T("现在定位误差 ±{a} 米，这个点可能不准。", { a: Math.round(S.me.acc) }));
  addPt([S.me.lat, S.me.lon]);
  map.panTo([S.me.lat, S.me.lon]);
});
$("msUndo").addEventListener("click", () => { if (S.measure) { S.measure.pts.pop(); disarm(); render(); } });
$("msClear").addEventListener("click", () => {
  if (!S.measure) return;
  if (!clearArmed) { clearArmed = true; $("msClear").textContent = T("再点清空"); return; }
  S.measure.pts = []; disarm(); render();
});
$("msExit").addEventListener("click", () => {
  if (S.measure && S.measure.pts.length >= 2 && !exitArmed) { exitArmed = true; toast(T("还没有保存。再点一次 × 退出，不保存。")); return; }
  exitMeasure();
});
$("msSave").addEventListener("click", () => {
  const M = S.measure; if (!M) return;
  const closed = M.mode === "area";
  const s = { id: newId(), name: (closed ? T("面积") : T("距离")) + " " + dateText(new Date().toISOString()), color: nextColor([...S.roads, ...S.tracks, ...S.shapes].map((x) => x.color)),
    visible: true, closed, pts: M.pts.slice(), created: new Date().toISOString(), order: Date.now() };
  sheetEditShape(s, true);
});

function statsOf(s) {
  const m = measureLL(s.pts);
  return s.closed ? { main: areaText(m.area)[0], m } : { main: lenText(m.length), m };
}

export function sheetMeasure() {
  const body = openSheet(T("测量"), `
    <div class="row">
      <button class="btn primary" id="msNewLine">${T("量距离")}</button>
      <button class="btn primary" id="msNewArea">${T("量面积")}</button>
    </div>
    <p class="note">${T("可以在地图上点点，也可以走到每个角上点“取当前位置”。手机定位误差一般 3～5 米，结果只能参考。")}</p>
    ${S.shapes.length ? `<ul class="list">${S.shapes.map((s) => `
      <li data-id="${s.id}">
        <span class="swatch ${s.closed ? "" : "line"}" style="background:${s.color}"></span>
        <div class="meta"><b>${esc(s.name)}</b><small>${statsOf(s).main}</small></div>
        <button class="icon-btn" data-act="zoom" aria-label="${T("在地图上查看")} ${esc(s.name)}">${ICON.zoom}</button>
        <button class="icon-btn" data-act="toggle" aria-pressed="${s.visible}" aria-label="${T("显示或隐藏")} ${esc(s.name)}">${ICON.eye}</button>
        <button class="icon-btn" data-act="edit" aria-label="${T("修改")} ${esc(s.name)}">${ICON.edit}</button>
      </li>`).join("")}</ul>` : `<p class="empty">${T("还没有保存的测量。")}</p>`}`);
  body.querySelector("#msNewLine").addEventListener("click", () => startMeasure("line"));
  body.querySelector("#msNewArea").addEventListener("click", () => startMeasure("area"));
  body.querySelectorAll("li[data-id]").forEach((li) => {
    const s = S.shapes.find((x) => x.id === li.dataset.id);
    li.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "zoom") {
        if (!s.visible) { s.visible = true; await shapesDB.put(s); hooks.drawOverlays(); }
        closeSheet(); hooks.setFollow(false); map.fitBounds(L.latLngBounds(s.pts), { padding: [40, 40], maxZoom: 19 });
      }
      if (act === "toggle") { s.visible = !s.visible; await shapesDB.put(s); btn.setAttribute("aria-pressed", s.visible); hooks.drawOverlays(); }
      if (act === "edit") sheetEditShape(s);
    }));
  });
}

function sheetEditShape(s, isNew = false) {
  let color = s.color;
  const { m } = statsOf(s);
  const area = areaText(m.area);
  const body = openSheet(isNew ? T("保存测量") : T("修改测量"), `
    <label class="field"><span>${T("名称")}</span><input id="shName" value="${esc(s.name)}" maxlength="40"></label>
    <div class="field"><span>${T("颜色")}</span>${colorPicker(s.color)}</div>
    <div class="summary"><dl>
      ${s.closed ? `<dt>${T("面积")}</dt><dd>${area.map((x) => `<span class="num">${x}</span>`).join("<br>")}</dd>
        <dt>${T("周长")}</dt><dd><span class="num">${lenText(m.perimeter)}</span></dd>`
      : `<dt>${T("总长")}</dt><dd><span class="num">${lenText(m.length)}</span></dd>`}
      <dt>${T("点数")}</dt><dd>${s.pts.length}</dd>
    </dl></div>
    <div class="actions">${isNew ? "" : `<button class="btn" id="shKml">${T("导出 KML")}</button>`}<button class="btn primary" id="shSave">${T("保存")}</button></div>
    ${isNew ? "" : `<div class="actions"><button class="btn danger" id="shDel">${T("删除")}</button></div>`}`);
  bindColors(body, (c) => { color = c; });
  const apply = async () => {
    s.name = body.querySelector("#shName").value.trim() || s.name; s.color = color;
    await shapesDB.put(s);
    if (!S.shapes.includes(s)) S.shapes.push(s);
    hooks.drawOverlays();
  };
  body.querySelector("#shSave").addEventListener("click", async () => {
    await apply();
    if (isNew) { exitMeasure(); closeSheet(); askPersist(); toast(T("已保存：{name}", { name: s.name })); }
    else { sheetMeasure(); toast(T("已保存")); }
  });
  body.querySelector("#shKml")?.addEventListener("click", async () => {
    await apply();
    shareKML(s.name, [{ name: s.name, color: s.color, pts: s.pts, closed: s.closed, desc: s.closed ? `${T("面积")} ${area.join(" / ")}` : `${T("总长")} ${lenText(m.length)}` }]);
  });
  const del = body.querySelector("#shDel");
  if (del) confirmTwice(del, T("再点一次，确认删除"), async () => {
    await shapesDB.remove(s.id);
    S.shapes = S.shapes.filter((x) => x.id !== s.id);
    hooks.drawOverlays(); sheetMeasure(); toast(T("已删除：{name}", { name: s.name }));
  });
}

export async function loadShapes() {
  S.shapes = await shapesDB.all();
  hooks.drawOverlays();
}
