// 找桩号：输入 95+300 或 95+300左12，在地图上插一根桩，显示距离和方位
import { toUTM, fromUTM, formatCh, parseCh, bearingText, distText } from "./geo.js";
import { S, hooks } from "./state.js";
import { map, findLayer } from "./map.js";
import { esc, openSheet, closeSheet } from "./ui.js";
import { sheetRoads } from "./roads.js";
import { T } from "./i18n.js";

export function parseFind(text) {
  const s = text.trim().replace(/\s+/g, "");
  const m = s.match(/^((?:PK|pk|[Kk])?\d+(?:\+\d+(?:\.\d+)?)?(?:\.\d+)?)(?:(左|右|[LlRrGgDd])(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const ch = parseCh(m[1].replace(/^pk/i, ""), true);
  if (ch == null) return null;
  let off = 0;
  if (m[2]) off = (/左|l|g/i.test(m[2]) ? 1 : -1) * parseFloat(m[3]);
  return { ch, off };
}

export function sheetFind() {
  if (!S.roads.length) { sheetRoads(); return; }
  const cur = S.last?.r?.id || S.lock || S.roads[0].id;
  const body = openSheet(T("找桩号"), `
    <label class="field"><span>${T("桩号")}</span><input id="fdText" class="big" placeholder="${T("例如 95+300 或 95+300左12")}" value="${esc(S.find?.text || "")}" autocomplete="off" enterkeyhint="search"></label>
    ${S.roads.length > 1 ? `<label class="field"><span>${T("路段")}</span><select id="fdRoad">${S.roads.map((r) => `<option value="${r.id}" ${r.id === (S.find?.roadId || cur) ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>` : ""}
    <div class="actions"><button class="btn" id="fdClear" ${S.find ? "" : "hidden"}>${T("清除标记")}</button><button class="btn primary" id="fdGo">${T("在地图上标出")}</button></div>
    <div id="fdOut"></div>`);
  const go = () => {
    const q = parseFind(body.querySelector("#fdText").value);
    const out = body.querySelector("#fdOut");
    if (!q) { out.innerHTML = `<p class="err">${T("没看懂这个桩号。可以输入 95+300、K95+300，或 95+300左12。")}</p>`; return; }
    const roadId = body.querySelector("#fdRoad")?.value || S.roads[0].id;
    const r = S.roads.find((x) => x.id === roadId);
    if (q.ch < r.chMin - 1 || q.ch > r.chMax + 1) { out.innerHTML = `<p class="err">${T("{name} 的桩号范围是 {a} ～ {b}。", { name: esc(r.name), a: formatCh(r.chMin), b: formatCh(r.chMax) })}</p>`; return; }
    S.find = { text: body.querySelector("#fdText").value.trim(), roadId, ...q };
    drawFind();
    closeSheet();
    showFindResult();
  };
  body.querySelector("#fdGo").addEventListener("click", go);
  body.querySelector("#fdText").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  body.querySelector("#fdClear").addEventListener("click", () => { clearFind(); closeSheet(); });
  setTimeout(() => body.querySelector("#fdText").focus(), 50);
}
function clearFind() { S.find = null; findLayer.clearLayers(); findLine = null; }
function findTarget() {
  const f = S.find; if (!f) return null;
  const r = S.roads.find((x) => x.id === f.roadId); if (!r) return null;
  const [e, n] = r.pointAt(f.ch, f.off);
  return { r, e, n, ll: fromUTM(e, n, r.crs) };
}
function findLabel() {
  const f = S.find;
  return formatCh(f.ch, f.ch % 1 ? 1 : 0) + (f.off ? " " + T(f.off > 0 ? "左" : "右") + Math.abs(f.off) : "");
}
function drawFind() {
  findLayer.clearLayers(); findLine = null;
  const t = findTarget(); if (!t) return;
  L.marker(t.ll, { keyboard: false, interactive: false, zIndexOffset: 900, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="stake"><span>${esc(findLabel())}</span></div>` }) }).addTo(findLayer);
  drawFindLine();
  hooks.setFollow(false);
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
hooks.onPos.push(() => { if (S.find) drawFindLine(); });

function showFindResult() {
  const t = findTarget(); if (!t) return;
  let rows = `<p><span class="num">${esc(findLabel())}</span>（${esc(t.r.name)}）</p>
    <p>${T("坐标")} ${T("北")} <span class="num">${t.n.toFixed(3)}</span> ${T("东")} <span class="num">${t.e.toFixed(3)}</span></p>`;
  if (S.me) {
    const [me, mn] = toUTM(S.me.lat, S.me.lon, t.r.crs);
    const d = Math.hypot(t.e - me, t.n - mn);
    rows += `<p>${T("直线距离 {d}，方位：{b}", { d: `<span class="num">${esc(distText(d))}</span>`, b: bearingText(t.e - me, t.n - mn) })}</p>`;
    const q = t.r.locate(me, mn);
    if (!q.far && q.d <= S.maxOff) {
      const diff = S.find.ch - q.ch;
      rows += `<p>${T(diff >= 0 ? "沿路往桩号增大方向还有 {d}" : "沿路往桩号减小方向还有 {d}", { d: `<span class="num">${esc(distText(Math.abs(diff)))}</span>` })}</p>`;
    }
  } else rows += `<p class="note">${T("打开定位后，可以看到离你多远、在哪个方向。")}</p>`;
  const body = openSheet(T("找桩号"), `<div class="result">${rows}</div>
    <div class="actions"><button class="btn" id="frClear">${T("清除标记")}</button><button class="btn" id="frAgain">${T("换一个桩号")}</button></div>`, { peek: true });
  body.querySelector("#frClear").addEventListener("click", () => { clearFind(); closeSheet(); });
  body.querySelector("#frAgain").addEventListener("click", sheetFind);
}
