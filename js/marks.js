// 地标：拌合站、营地、料场、桥涵等。自己加的存在本机；管理员可以发布成共享地标
import { toUTM, zoneOf, bearingText, distText } from "./geo.js";
import { marksDB, prefs, newId } from "./store.js";
import { S, hooks } from "./state.js";
import { map, markLayer } from "./map.js";
import { $, esc, toast, openSheet, closeSheet, confirmTwice, ICON } from "./ui.js";
import { T } from "./i18n.js";

export const TYPES = [
  ["camp", "营地", "#2D7FF9"], ["plant", "拌合站", "#FF7A1A"], ["stock", "料场", "#9C6B3F"],
  ["bridge", "桥涵", "#B04BE0"], ["fuel", "加油站", "#E0312A"], ["office", "办公区", "#14A06F"], ["other", "其他", "#5B6168"],
];
const typeOf = (k) => TYPES.find((t) => t[0] === k) || TYPES[TYPES.length - 1];

export async function loadMarks() {
  const local = await marksDB.all();
  const shared = (S.shared?.marks || []).map((m) => ({ ...m, shared: true }));
  const ids = new Set(shared.map((m) => m.id));
  S.marks = [...shared, ...local.filter((m) => !ids.has(m.id))];
  drawMarks();
}

export function drawMarks() {
  markLayer.clearLayers();
  if (!prefs.get("showMarks", true)) return;
  const z = map.getZoom();
  if (z < 12) return;
  const b = map.getBounds().pad(0.2);
  for (const m of S.marks) {
    if (!b.contains([m.lat, m.lon])) continue;
    const [, label, color] = typeOf(m.type);
    L.marker([m.lat, m.lon], { keyboard: false, interactive: false, icon: L.divIcon({ className: "", iconSize: [0, 0],
      html: `<div class="mark" style="--c:${color}"><i></i>${z >= 14 ? `<span>${esc(m.name)}</span>` : ""}</div>`, title: T(label) }) }).addTo(markLayer);
  }
}
map.on("zoomend moveend", drawMarks);

// 离某点最近的地标（默认 3 公里内），用于读数和照片水印
export function nearestMark(lat, lon, maxD = 3000) {
  let best = null;
  const crs = { zone: zoneOf(lon), south: lat < 0 };
  const [e, n] = toUTM(lat, lon, crs);
  for (const m of S.marks) {
    const [me, mn] = toUTM(m.lat, m.lon, crs);
    const d = Math.hypot(me - e, mn - n);
    if (d <= maxD && (!best || d < best.d)) best = { m, d, dir: bearingText(e - me, n - mn) };
  }
  return best;
}
// “拌合站 东北 320 米”：我在地标的哪个方向
export const nearText = (lat, lon) => {
  const b = nearestMark(lat, lon);
  return b ? T("{name} {dir} {d}", { name: b.m.name, dir: b.dir, d: distText(b.d) }) : "";
};

/* ---------- 添加、修改 ---------- */
function typeSeg(sel) {
  return `<div class="types" role="radiogroup">${TYPES.map(([k, label, c]) => `<button type="button" role="radio" data-k="${k}" aria-checked="${k === sel}"><i style="background:${c}"></i>${T(label)}</button>`).join("")}</div>`;
}
export function sheetAddMark(lat, lon, onSave = null) {
  let type = "other";
  const body = openSheet(T("添加地标"), `
    <label class="field"><span>${T("名称")}</span><input id="mkName" maxlength="30" placeholder="${T("例如 1 号拌合站")}"></label>
    <div class="field"><span>${T("类型")}</span>${typeSeg(type)}</div>
    <p class="note">${T("位置：{p}", { p: `${lat.toFixed(6)}, ${lon.toFixed(6)}` })}</p>
    <div class="actions"><button class="btn" id="mkCancel">${T("取消")}</button><button class="btn primary" id="mkSave">${T("保存")}</button></div>`);
  body.querySelectorAll(".types button").forEach((b) => b.addEventListener("click", () => {
    type = b.dataset.k; body.querySelectorAll(".types button").forEach((x) => x.setAttribute("aria-checked", x === b));
  }));
  body.querySelector("#mkCancel").addEventListener("click", closeSheet);
  body.querySelector("#mkSave").addEventListener("click", async () => {
    const name = body.querySelector("#mkName").value.trim();
    if (!name) { toast(T("请填写地标名称")); return; }
    const m = { id: newId(), name, type, lat, lon, created: new Date().toISOString(), order: Date.now() };
    if (onSave) await onSave(m); else await marksDB.put(m);
    await loadMarks(); closeSheet(); toast(T("已保存：{name}", { name }));
  });
  setTimeout(() => body.querySelector("#mkName").focus(), 50);
}

function sheetEditMark(m) {
  let type = m.type;
  const body = openSheet(T("修改地标"), `
    <label class="field"><span>${T("名称")}</span><input id="mkName" maxlength="30" value="${esc(m.name)}"></label>
    <div class="field"><span>${T("类型")}</span>${typeSeg(type)}</div>
    <div class="actions"><button class="btn primary" id="mkSave">${T("保存")}</button></div>
    <div class="actions"><button class="btn danger" id="mkDel">${T("删除")}</button></div>`);
  body.querySelectorAll(".types button").forEach((b) => b.addEventListener("click", () => {
    type = b.dataset.k; body.querySelectorAll(".types button").forEach((x) => x.setAttribute("aria-checked", x === b));
  }));
  body.querySelector("#mkSave").addEventListener("click", async () => {
    m.name = body.querySelector("#mkName").value.trim() || m.name; m.type = type;
    await marksDB.put(m); await loadMarks(); sheetMarks(); toast(T("已保存"));
  });
  confirmTwice(body.querySelector("#mkDel"), T("再点一次，确认删除"), async () => {
    await marksDB.remove(m.id); await loadMarks(); sheetMarks(); toast(T("已删除：{name}", { name: m.name }));
  });
}

export function sheetMarks() {
  const show = prefs.get("showMarks", true);
  const body = openSheet(T("地标"), `
    <div class="actions"><button class="btn primary" id="mkHere">${T("在我现在的位置添加")}</button></div>
    <p class="note">${T("也可以在地图上长按，在按住的位置添加。")}</p>
    ${S.marks.length ? `<ul class="list">${S.marks.map((m) => { const [, label, c] = typeOf(m.type); return `
      <li data-id="${m.id}">
        <span class="swatch" style="background:${c};border-radius:50%"></span>
        <div class="meta"><b>${esc(m.name)}${m.shared ? ` <span class="tag">${T("共享")}</span>` : ""}</b><small>${T(label)}</small></div>
        <button class="icon-btn" data-act="zoom" aria-label="${T("在地图上查看")} ${esc(m.name)}">${ICON.zoom}</button>
        ${m.shared ? "" : `<button class="icon-btn" data-act="edit" aria-label="${T("修改")} ${esc(m.name)}">${ICON.edit}</button>`}
      </li>`; }).join("")}</ul>` : `<p class="empty">${T("还没有地标。")}</p>`}
    <label class="check"><input type="checkbox" id="mkShow" ${show ? "checked" : ""}> ${T("在地图上显示地标")}</label>`);
  body.querySelector("#mkHere").addEventListener("click", () => {
    if (!S.me) { hooks.startGPS(); toast(T("还没有定位，等定位成功后再点。")); return; }
    sheetAddMark(S.me.lat, S.me.lon);
  });
  body.querySelector("#mkShow").addEventListener("change", (e) => { prefs.set("showMarks", e.target.checked); drawMarks(); });
  body.querySelectorAll("li[data-id]").forEach((li) => {
    const m = S.marks.find((x) => x.id === li.dataset.id);
    li.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", () => {
      if (btn.dataset.act === "zoom") { closeSheet(); hooks.setFollow(false); map.setView([m.lat, m.lon], Math.max(map.getZoom(), 16)); }
      if (btn.dataset.act === "edit") sheetEditMark(m);
    }));
  });
}

// 长按地图添加地标（测量时长按不处理）
map.on("contextmenu", (e) => { if (!S.measure) sheetAddMark(e.latlng.lat, e.latlng.lng); });

hooks.sheetMarks = sheetMarks;
hooks.nearText = nearText;
