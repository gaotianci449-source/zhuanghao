// 路段：列表、显示/隐藏、锁定、改名改色、导入（KML / KMZ / Excel / 坐标文件 / DXF / DWG）
// 共享路段由管理员发布，大家只能显示/隐藏，不能改
import { fromUTM, formatCh, parseCh } from "./geo.js";
import { Road, buildRoad, cumLen, project } from "./road.js";
import { parseKML, analyzeKML, parseTable, tableStations, splitRoads } from "./importers.js";
import { store, askPersist, prefs, newId } from "./store.js";
import { isZip, openZip, readKMZ } from "./zip.js";
import { readXlsx } from "./xlsx.js";
import { S, hooks } from "./state.js";
import { map, llOf, previewLayer } from "./map.js";
import { $, esc, toast, openSheet, closeSheet, colorPicker, bindColors, confirmTwice, nextColor, ICON } from "./ui.js";
import { restoreData } from "./backup.js";
import { decodeDXF, parseDXF, dxfToKml } from "./dxf.js";
import { T } from "./i18n.js";

export async function loadRoads() {
  const raw = await store.all();
  const hidden = new Set(prefs.get("hidden", []));
  const shared = (S.shared?.roads || []).map((d) => new Road({ ...d, shared: true, visible: !hidden.has(d.id) }));
  const ids = new Set(shared.map((r) => r.id));
  S.roads = [...shared, ...raw.filter((d) => !ids.has(d.id)).map((d) => new Road(d))];
  if (S.lock && !S.roads.some((r) => r.id === S.lock)) { S.lock = null; prefs.set("lock", null); }
  hooks.drawRoads();
  hooks.update();
}

export function plainRoad(r) {
  return { id: r.id, name: r.name, color: r.color, visible: r.visible, crs: r.crs, pts: r.pts, cal: r.cal, info: r.info, order: r.order, created: r.created, source: r.source };
}
const saveRoad = (r) => store.put(plainRoad(r));
export async function setVisible(r, v) {
  r.visible = v;
  if (r.shared) {
    const h = new Set(prefs.get("hidden", []));
    if (v) h.delete(r.id); else h.add(r.id);
    prefs.set("hidden", [...h]);
  } else await saveRoad(r);
}
const tag = (r) => (r.shared ? ` <span class="tag">${T("共享")}</span>` : "");
const rangeText = (r) => `<span class="num">${formatCh(r.chMin)}</span> ～ <span class="num">${formatCh(r.chMax)}</span>`;
const kmText = (m, d = 2) => (m / 1000).toFixed(d) + " " + T("公里");

/* 点顶部路段名：图例 + 显示/隐藏 + 自动/锁定 */
export function sheetLegend() {
  if (!S.roads.length) { sheetRoads(); return; }
  const body = openSheet(T("路段图例"), `
    <p class="note">${T("点路段名可以锁定它：在路段交叉的地方，只按这一条算桩号。点眼睛显示或隐藏。")}</p>
    <div class="list legend" role="radiogroup">
      <div class="lg-row"><button class="choice" role="radio" data-id="" aria-checked="${!S.lock}"><span class="swatch auto"></span>${T("自动选最近的路段")}</button></div>
      ${S.roads.map((r) => `<div class="lg-row" data-id="${r.id}">
        <button class="choice" role="radio" data-id="${r.id}" aria-checked="${S.lock === r.id}"><span class="swatch line" style="background:${r.color}"></span><span class="meta"><b>${esc(r.name)}${tag(r)}</b><small>${rangeText(r)}</small></span></button>
        <button class="icon-btn" data-act="toggle" aria-pressed="${r.visible}" aria-label="${T("显示或隐藏")} ${esc(r.name)}">${ICON.eye}</button>
      </div>`).join("")}
    </div>
    <div class="actions"><button class="btn" id="lgManage">${T("管理路段")}</button></div>`);
  body.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", async () => {
    S.lock = b.dataset.id || null; prefs.set("lock", S.lock);
    const r = S.roads.find((x) => x.id === S.lock);
    if (r && !r.visible) { await setVisible(r, true); hooks.drawRoads(); }
    closeSheet(); hooks.update();
  }));
  body.querySelectorAll("[data-act=toggle]").forEach((btn) => btn.addEventListener("click", async () => {
    const r = S.roads.find((x) => x.id === btn.closest("[data-id]").dataset.id);
    await setVisible(r, !r.visible);
    btn.setAttribute("aria-pressed", r.visible);
    hooks.drawRoads(); hooks.update();
  }));
  body.querySelector("#lgManage").addEventListener("click", sheetRoads);
}

/* 底部“路段”：导入、改名、改色、删除 */
export function sheetRoads() {
  const body = openSheet(T("路段"), `
    ${S.roads.length ? `<ul class="list">${S.roads.map((r) => `
      <li data-id="${r.id}">
        <span class="swatch line" style="background:${r.color}"></span>
        <div class="meta"><b>${esc(r.name)}${tag(r)}</b><small>${rangeText(r)} · ${kmText(r.length)}</small></div>
        <button class="icon-btn" data-act="zoom" aria-label="${T("在地图上查看")} ${esc(r.name)}">${ICON.zoom}</button>
        <button class="icon-btn" data-act="toggle" aria-pressed="${r.visible}" aria-label="${T("显示或隐藏")} ${esc(r.name)}">${ICON.eye}</button>
        ${r.shared ? "" : `<button class="icon-btn" data-act="edit" aria-label="${T("修改")} ${esc(r.name)}">${ICON.edit}</button>`}
      </li>`).join("")}</ul>`
      : `<p class="empty">${T("还没有路段。用管理员发的链接打开，就能自动看到共享路段；也可以自己导入 KML、Excel、CAD 图（DXF / DWG）或坐标文件。")}</p>`}
    <div class="actions"><button class="btn primary" id="btnImport">${T("导入路段")}</button><button class="btn" id="btnMarks">${T("地标")}</button></div>
    <p class="note">${T("支持 KML、KMZ、Excel（.xlsx）、CAD 图（DXF / DWG），以及每行“桩号、北坐标、东坐标”的坐标文件。自己导入的只保存在这台手机里；标着“共享”的由管理员统一发布。")}</p>`);
  body.querySelector("#btnImport").addEventListener("click", () => pickRoadFile(null));
  body.querySelector("#btnMarks").addEventListener("click", () => hooks.sheetMarks());
  body.querySelectorAll("li[data-id]").forEach((li) => {
    const r = S.roads.find((x) => x.id === li.dataset.id);
    li.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "zoom") { closeSheet(); hooks.setFollow(false); map.fitBounds(L.latLngBounds(r.ll || r.pts.map(([e, n]) => llOf(r, e, n))), { padding: [30, 30] }); }
      if (act === "toggle") { await setVisible(r, !r.visible); btn.setAttribute("aria-pressed", r.visible); hooks.drawRoads(); hooks.update(); }
      if (act === "edit") sheetEditRoad(r);
    }));
  });
}

function sheetEditRoad(r) {
  let color = r.color;
  const body = openSheet(T("修改路段"), `
    <label class="field"><span>${T("名称")}</span><input id="edName" value="${esc(r.name)}" maxlength="40"></label>
    <div class="field"><span>${T("颜色")}</span>${colorPicker(r.color)}</div>
    <div class="summary"><dl>
      <dt>${T("桩号范围")}</dt><dd>${rangeText(r)}</dd>
      <dt>${T("中线长度")}</dt><dd>${kmText(r.length, 3)}</dd>
      <dt>${T("来源")}</dt><dd>${esc(T(r.source || ""))}</dd>
    </dl></div>
    <div class="actions"><button class="btn primary" id="edSave">${T("保存")}</button></div>
    <div class="actions"><button class="btn danger" id="edDel">${T("删除这条路段")}</button></div>`);
  bindColors(body, (c) => { color = c; });
  body.querySelector("#edSave").addEventListener("click", async () => {
    r.name = body.querySelector("#edName").value.trim() || r.name; r.color = color;
    await saveRoad(r); hooks.drawRoads(); hooks.update(); sheetRoads(); toast(T("已保存"));
  });
  confirmTwice(body.querySelector("#edDel"), T("再点一次，确认删除"), async () => {
    await store.remove(r.id);
    if (S.lock === r.id) { S.lock = null; prefs.set("lock", null); }
    await loadRoads(); sheetRoads(); toast(T("已删除：{name}", { name: r.name }));
  });
}

/* ---------- 导入：先看文件头判断是什么文件 ---------- */
function fail(msg) {
  openSheet(T("导入路段"), `<p class="err">${esc(msg)}</p><div class="actions"><button class="btn" id="again">${T("换一个文件")}</button></div>`)
    .querySelector("#again").addEventListener("click", () => $("fileRoad").click());
}
const startsWith = (buf, sig) => sig.every((b, i) => buf[i] === b);

// 导入到哪里：null = 本机；数据管理里导入时传入一个保存函数（存进共享草稿）
let sink = null;
export function pickRoadFile(fn) { sink = fn; $("fileRoad").click(); }

$("fileRoad").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try { await importFile(f); } catch (err) { fail(err.message || String(err)); }
});

export async function importFile(f) {
  const base = f.name.replace(/\.[^.]+$/, "");
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  const buf = new Uint8Array(await f.arrayBuffer());
  if (!buf.length) throw new Error(T("这个文件是空的。如果是从微信里选的，先在微信里打开文件，点“保存到手机”，再从手机存储里选。"));

  if (isZip(buf)) {
    const zip = openZip(buf);
    if (zip.has("xl/workbook.xml")) { importTable(await readXlsx(zip), base, "Excel"); return; }
    if (zip.names.some((n) => /\.kml$/i.test(n))) { importKML(await readKMZ(zip), base); return; }
    if (zip.names.some((n) => n.startsWith("word/"))) throw new Error(T("这是 Word 文件，里面的坐标读不出来。请把坐标表复制到 Excel 里保存成 .xlsx，再导入。"));
    if (zip.names.some((n) => n.startsWith("ppt/"))) throw new Error(T("这是 PPT 文件，不能导入。请导入 KML、Excel 或坐标文件。"));
    throw new Error(T("这是一个压缩包，里面没有找到 KML 或 Excel 表格。请先解压，再选里面的文件。"));
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0])) throw new Error(T("这是旧版 Excel（.xls）或 Word（.doc）文件，读不了。请在电脑上用 Excel 打开，“另存为” .xlsx 或 CSV，再导入。"));
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) throw new Error(T("这是 PDF 文件，里面的坐标读不出来。请找测量组要 Excel 坐标表或 KML。"));
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47]) || startsWith(buf, [0xff, 0xd8, 0xff]) || ext === "heic" || ext === "webp")
    throw new Error(T("这是图片，不能导入。请导入 KML、Excel 或坐标文件。"));
  if (startsWith(buf, [0x41, 0x43, 0x31, 0x30])) {
    const { dwgToDxf } = await import("./dwg.js");
    const out = await dwgToDxf(buf, (m) => toast(m, 15000));
    $("toast").hidden = true;
    importCAD(out, base); return;
  }
  if (startsWith(buf, [0x52, 0x61, 0x72, 0x21]) || startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf])) throw new Error(T("这是 RAR / 7z 压缩包，请先解压，再选里面的文件。"));
  if (ext === "ovobj" || ext === "ovkml" || ext === "ovjsn") throw new Error(T("这是奥维自己的格式，读不了。请在奥维里把路段导出成 KML。"));

  if (/^\s*0\s*\r?\n\s*SECTION/.test(new TextDecoder("latin1").decode(buf.subarray(0, 200)))) { importCAD(buf, base); return; }
  const text = decodeText(buf);
  const head = text.slice(0, 3000);
  if (head.includes("\u0000") || (text.match(/�/g) || []).length > 20) throw new Error(T("这个文件不是文字格式，读不了。请导入 KML、Excel 或坐标文件。"));
  if (/^\s*\{/.test(head) && head.includes('"zhuanghao"')) { await restoreData(JSON.parse(text)); return; }
  if (ext === "kml" || /<kml[\s>]/i.test(head)) { importKML(text, base); return; }
  if (/^\s*</.test(head)) throw new Error(T("这个文件是网页或别的 XML 格式，不是 KML。"));
  importTable(text, base, T("坐标文件"));
}
function decodeText(buf) {
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) { try { t = new TextDecoder("gbk").decode(buf); } catch (e) { /* 保持 utf-8 */ } }
  return t.replace(/^﻿/, "");
}

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
  const how = i.mode === "line+points" ? T("中线 + {n} 个桩号点校正", { n: i.used }) : i.mode === "points" ? T("{n} 个桩号点连线", { n: i.used }) : T("只有中线，按起点桩号推算");
  return `<div class="summary"><dl>
    <dt>${T("桩号范围")}</dt><dd>${rangeText(r)}</dd>
    <dt>${T("中线长度")}</dt><dd>${kmText(r.length, 3)}</dd>
    <dt>${T("桩号来源")}</dt><dd>${how}${i.mode === "line+points" ? T("，桩号点离中线最远 {d} 米", { d: i.maxOff.toFixed(1) }) : ""}</dd>
    ${extra}
  </dl></div>`;
}

async function saveNew(data, name, color, source) {
  const obj = { ...data, id: newId(), name, color, visible: true, order: Date.now(), created: new Date().toISOString(), source };
  if (sink) await sink(obj); else await store.put(obj);
  previewLayer.clearLayers();
  await askPersist();
  await loadRoads();
  closeSheet();
  toast(sink ? T("已加入共享（还没发布）：{name}", { name }) : T("已保存：{name}", { name }));
}

// CAD 图：解析后按 KML 的流程导入；坐标按 UTM，投影带用上次导入坐标文件时选的（默认 28 带）
function importCAD(bytes, base) {
  const d = parseDXF(decodeDXF(bytes));
  const crs = prefs.get("crs", { zone: 28, south: false });
  importKML(dxfToKml(d, crs), base, new Set(), "CAD 图");
}
const freshColor = () => nextColor(S.roads.map((r) => r.color));

// input：KML 文字，或已经整理好的 { lines, points }（CAD 图）
// done：同一个文件里已经导入过的线；一个文件里有好几段路时，存完一段接着导下一段
function importKML(input, base, done = new Set(), source = "KML 文件", a0 = null, taken = new Set()) {
  const kml = typeof input === "string" ? parseKML(input) : input;
  // 一个文件里有好几条路（每条路一个文件夹，各有中线和桩号点）：走批量导入
  if (!done.size && !a0) {
    const groups = splitRoads(kml);
    if (groups.length >= 2) { importBatch(groups, base, source); return; }
  }
  const a = a0 || analyzeKML(kml);
  if (typeof input === "string" && !done.size) {
    // 默认名称：用最外层文件夹名（奥维导出时就是路段名），去掉 .dxf、-奥维 之类的后缀
    const top = (kml.lines[0]?.folder || kml.points[0]?.folder || "").split(" / ")[0];
    if (top) base = top.replace(/\.dxf$/i, "").replace(/[-_ ]?奥维$/, "").trim() || base;
  }
  const st = a.stations, cands = a.candidates.filter((c) => !done.has(c.id));
  // 某条线 15 米内有哪些桩号点（序号）
  const cacheIdx = new Map();
  const nearIdx = (c) => {
    if (!c) return [];
    if (!cacheIdx.has(c.id)) {
      const Lc = cumLen(c.pts);
      cacheIdx.set(c.id, st.map((p, k) => (project(c.pts, Lc, p.e, p.n).d <= 15 ? k : -1)).filter((k) => k >= 0));
    }
    return cacheIdx.get(c.id);
  };
  // 文件里有几段路：按排名依次看，每条线带来 2 个以上新桩号点就算一段（边线、边沟线不算）
  let segs = 0;
  { const cov = new Set();
    for (const c of a.candidates.slice(0, 10)) {
      if (!c.hit) continue;
      const fresh = nearIdx(c).filter((k) => !cov.has(k));
      if (fresh.length >= 2) { segs++; fresh.forEach((k) => cov.add(k)); }
    } }
  let nameTouched = false;
  const chs = st.map((p) => p.ch);
  let color = freshColor();
  const best = cands[0];
  // 一个文件里有好几段路时，桩号点只有一部分在每条线上，这时也优先用线
  const mode = best && (best.hit >= 0.7 || (segs > 1 && best.hit > 0)) ? "line:" + best.id : st.length >= 2 ? "points" : best ? "line:" + best.id : "";
  if (!mode) throw new Error(T("文件里没有找到可以当作中线的线，也没有桩号点。"));
  const body = openSheet(T("导入路段"), `
    <div class="summary"><dl>
      <dt>${T("桩号点")}</dt><dd>${st.length ? `${T("{n} 个", { n: st.length })}，<span class="num">${formatCh(Math.min(...chs))}</span> ～ <span class="num">${formatCh(Math.max(...chs))}</span>${a.plainUsed ? T("（点名是米数）") : ""}` : T("没有找到（点名不是桩号格式）")}</dd>
      <dt>${T("线")}</dt><dd>${T("{n} 条可选", { n: cands.length })}</dd>
    </dl></div>
    <label class="field"><span>${T("中线用哪条")}</span><select id="imLine">
      ${cands.slice(0, 15).map((c) => `<option value="line:${c.id}">${esc(c.name || T("未命名线"))}${c.folder ? "（" + esc(c.folder) + "）" : ""}，${kmText(c.len)}${st.length ? T("，{p}% 桩号点在线上", { p: Math.round(c.hit * 100) }) : ""}</option>`).join("")}
      ${st.length >= 2 ? `<option value="points">${T("不用线，直接把桩号点连起来")}</option>` : ""}
    </select></label>
    <div id="imStart" hidden>
      <div class="row">
        <label class="field"><span>${T("起点桩号")}</span><input id="imCh0" class="big" value="K0+000" inputmode="text"></label>
        <label class="field"><span>${T("方向")}</span><select id="imDir"><option value="f">${T("按画线方向")}</option><option value="r">${T("反过来")}</option></select></label>
      </div>
    </div>
    <div id="imSum"></div>
    <label class="field"><span>${T("路段名称")}</span><input id="imName" value="${esc(base)}" maxlength="40"></label>
    <div class="field"><span>${T("颜色")}</span>${colorPicker(color)}</div>
    <div class="actions"><button class="btn" id="imCancel">${T("取消")}</button><button class="btn primary" id="imSave">${T("保存路段")}</button></div>`,
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
      body.querySelector("#imSum").innerHTML = roadSummary(r, data.info.mode === "line" && st.length >= 2 ? `<dt>${T("注意")}</dt><dd>${T("这条线和桩号点对不上，桩号只按起点推算")}</dd>` : "");
      // 一个文件有几段路时，名称里带上桩号范围，方便区分
      if (segs > 1 && !nameTouched) body.querySelector("#imName").value = `${base} ${formatCh(r.chMin)}～${formatCh(r.chMax)}`;
    } catch (e) { body.querySelector("#imSum").innerHTML = `<p class="err">${T("这条线无法生成路段。")}</p>`; data = null; }
  };
  body.querySelector("#imName").addEventListener("input", () => { nameTouched = true; });
  sel.addEventListener("change", rebuild);
  body.querySelector("#imCh0").addEventListener("change", rebuild);
  body.querySelector("#imDir").addEventListener("change", rebuild);
  bindColors(body, (c) => { color = c; rebuild(); });
  body.querySelector("#imCancel").addEventListener("click", closeSheet);
  body.querySelector("#imSave").addEventListener("click", () => {
    if (!data) return;
    if (data.info.mode === "line" && parseCh(body.querySelector("#imCh0").value, true) == null) { toast(T("起点桩号格式不对，例如 K0+000")); return; }
    const v = sel.value, keepSink = sink;
    saveNew(data, body.querySelector("#imName").value.trim() || base, color, source).then(() => {
      // 同一个文件里还有带桩号点的线没导入：接着导
      const used = new Set(done); if (v.startsWith("line:")) used.add(+v.slice(5));
      // 只提示：同一图层/文件夹里、并且有 2 个以上“还没用过的桩号点”落在线上的线
      // （路边线、边沟线也会经过同样的桩号点，那些不算新的一段）
      const chosen = a.candidates.find((c) => "line:" + c.id === v);
      const takenNow = new Set([...taken, ...nearIdx(chosen)]);
      const rest = a.candidates.filter((c) => !used.has(c.id) && c.folder === chosen?.folder &&
        nearIdx(c).filter((k) => !takenNow.has(k)).length >= 2);
      taken = takenNow;
      if (v.startsWith("line:") && rest.length) {
        sink = keepSink;
        const b2 = openSheet(T("还有一段路"), `<p>${T("这个文件里还有 {n} 段带桩号的线没有导入。", { n: rest.length })}</p>
          <div class="actions"><button class="btn" id="imNo">${T("不用了")}</button><button class="btn primary" id="imNext">${T("继续导入下一段")}</button></div>`);
        b2.querySelector("#imNo").addEventListener("click", () => { sink = null; closeSheet(); });
        b2.querySelector("#imNext").addEventListener("click", () => importKML(kml, base, used, source, a, taken));
      } else sink = null;
    });
  });
  rebuild();
}

// 坐标表：input 是文字，或 Excel 的工作表列表 [{name, rows}]
function importTable(input, base, kind) {
  const sheets = typeof input === "string" ? null : input.filter((s) => s.rows.length);
  if (sheets && !sheets.length) throw new Error(T("这个 Excel 文件里所有工作表都是空的。"));
  const tables = (sheets || [{ name: "", text: input }]).map((s) => {
    try { return { name: s.name, t: parseTable(s.rows || s.text) }; } catch (e) { return { name: s.name, t: null }; }
  });
  const usable = (x) => x.t && x.t.rows.length >= 2 && x.t.cols.filter((c) => c.numeric).length >= 2;
  let cur = tables.findIndex(usable);
  if (cur < 0) {
    throw new Error(sheets
      ? T("Excel 里没有找到坐标数据。需要有一列桩号、一列北坐标（X）、一列东坐标（Y），每行一个点，至少两行。")
      : T("文件里没有读到坐标。坐标文件每行要有桩号、北坐标、东坐标，例如：K0+000, 1208345.123, 512345.678"));
  }
  let color = freshColor();
  const crs0 = prefs.get("crs", { zone: 28, south: false });
  const body = openSheet(sheets ? T("导入 Excel 表格") : T("导入坐标文件"), `
    ${sheets && sheets.length > 1 ? `<label class="field"><span>${T("工作表")}</span><select id="tbSheet">${tables.map((x, i) => `<option value="${i}" ${i === cur ? "selected" : ""} ${usable(x) ? "" : "disabled"}>${esc(x.name)}${usable(x) ? T("（{n} 行）", { n: x.t.rows.length }) : T("（没有坐标）")}</option>`).join("")}</select></label>` : ""}
    <div id="tbTable"></div>
    <label class="field"><span>${T("桩号列")}</span><select id="tbName"></select></label>
    <div class="row">
      <label class="field"><span>${T("北坐标（X）")}</span><select id="tbN"></select></label>
      <label class="field"><span>${T("东坐标（Y）")}</span><select id="tbE"></select></label>
    </div>
    <div class="row">
      <label class="field"><span>${T("UTM 投影带")}</span><input id="tbZone" type="number" min="1" max="60" value="${crs0.zone}" inputmode="numeric"></label>
      <label class="field"><span>${T("半球")}</span><select id="tbHemi"><option value="n">${T("北半球")}</option><option value="s" ${crs0.south ? "selected" : ""}>${T("南半球")}</option></select></label>
    </div>
    <div id="tbSum"></div>
    <label class="field"><span>${T("路段名称")}</span><input id="tbNameIn" value="${esc(base)}" maxlength="40"></label>
    <div class="field"><span>${T("颜色")}</span>${colorPicker(color)}</div>
    <div class="actions"><button class="btn" id="tbCancel">${T("取消")}</button><button class="btn primary" id="tbSave">${T("保存路段")}</button></div>`,
  { onClose: () => previewLayer.clearLayers() });
  let data = null, crs = null, t = null;
  const opts = (sel) => `<option value="-1">${T("（没有）")}</option>` + t.cols.map((c) => `<option value="${c.index}" ${c.index === sel ? "selected" : ""}>${esc(c.title)}：${esc(c.sample)}</option>`).join("");
  const loadSheet = () => {
    t = tables[cur].t;
    body.querySelector("#tbTable").innerHTML = `<div class="preview-table"><table>
        <tr>${t.cols.map((c) => `<th>${esc(c.title)}</th>`).join("")}</tr>
        ${t.rows.slice(0, 4).map((r) => `<tr>${t.cols.map((c) => `<td>${esc(r[c.index] ?? "")}</td>`).join("")}</tr>`).join("")}
      </table></div>
      <p class="note">${T("共 {n} 行。国内测量习惯里 X 是北坐标、Y 是东坐标，请对照上面的数据确认。", { n: t.rows.length })}</p>`;
    body.querySelector("#tbName").innerHTML = opts(t.guess.name);
    body.querySelector("#tbN").innerHTML = opts(t.guess.north);
    body.querySelector("#tbE").innerHTML = opts(t.guess.east);
    const sn = tables[cur].name;
    if (sheets && sheets.length > 1 && sn && !base.includes(sn) && !/^sheet\d*$/i.test(sn)) body.querySelector("#tbNameIn").value = base + " " + sn;
  };
  const rebuild = () => {
    const map_ = { name: +body.querySelector("#tbName").value, north: +body.querySelector("#tbN").value, east: +body.querySelector("#tbE").value };
    crs = { zone: Math.min(60, Math.max(1, +body.querySelector("#tbZone").value || 28)), south: body.querySelector("#tbHemi").value === "s" };
    const out = body.querySelector("#tbSum");
    data = null; previewLayer.clearLayers();
    if (map_.name < 0 || map_.north < 0 || map_.east < 0) { out.innerHTML = `<p class="err">${T("请选好桩号列和两列坐标。")}</p>`; return; }
    if (map_.north === map_.east) { out.innerHTML = `<p class="err">${T("北坐标和东坐标选成了同一列。")}</p>`; return; }
    const st = tableStations(t, map_, crs);
    if (st.length < 2) { out.innerHTML = `<p class="err">${T("按这样的列对应，读不出桩号和坐标。检查一下桩号列是不是选对了。")}</p>`; return; }
    const [lat] = fromUTM(st[0].e, st[0].n, crs);
    if (!isFinite(lat) || Math.abs(lat) > 84) { out.innerHTML = `<p class="err">${T("坐标换算出来不在地球上，可能北、东两列选反了，或者不是 UTM 坐标。")}</p>`; return; }
    data = buildRoad({ name: "", crs, line: null, stations: st });
    data.color = color;
    const r = previewRoad(data);
    const skipped = t.rows.length - st.length;
    out.innerHTML = roadSummary(r, `${skipped > 0 ? `<dt>${T("跳过")}</dt><dd>${T("{n} 行读不出桩号或坐标", { n: skipped })}</dd>` : ""}<dt>${T("检查")}</dt><dd>${T("看地图上的线是否落在路上；不对就调换北、东两列")}</dd>`);
  };
  loadSheet();
  body.querySelector("#tbSheet")?.addEventListener("change", (e) => { cur = +e.target.value; loadSheet(); rebuild(); });
  ["#tbName", "#tbN", "#tbE", "#tbZone", "#tbHemi"].forEach((s) => body.querySelector(s).addEventListener("change", rebuild));
  bindColors(body, (c) => { color = c; if (data) { data.color = c; previewRoad(data); } });
  body.querySelector("#tbCancel").addEventListener("click", closeSheet);
  body.querySelector("#tbSave").addEventListener("click", () => {
    if (!data) { toast(T("还不能保存，请先把列对应好")); return; }
    prefs.set("crs", crs);
    saveNew(data, body.querySelector("#tbNameIn").value.trim() || base, color, sheets ? "Excel 表格" : "坐标文件");
  });
  rebuild();
}

/* 批量导入：一个文件里的多条路一次导完，统一一种颜色 */
function importBatch(groups, base, source) {
  const items = [];
  for (const g of groups) {
    try {
      const a = analyzeKML({ lines: g.lines, points: g.points });
      const best = a.candidates[0];
      const useLine = best && best.hit >= 0.5;
      const data = buildRoad({ name: "", crs: a.crs, line: useLine ? best.pts : null, stations: a.stations, startCh: 0 });
      const r = new Road(data);
      items.push({ name: g.name, data, r, ok: data.info.mode !== "line" });
    } catch (e) { /* 这一条读不出来，跳过 */ }
  }
  if (!items.length) throw new Error(T("文件里没有找到可以当作中线的线，也没有桩号点。"));
  // 重名的加上序号
  const seen = {};
  for (const it of items) { seen[it.name] = (seen[it.name] || 0) + 1; if (seen[it.name] > 1) it.name += ` (${seen[it.name]})`; }
  let color = freshColor();
  const quality = (it) => {
    const i = it.data.info;
    if (i.mode === "line+points") return T("{n} 个桩号点校正，最远偏 {d} 米", { n: i.used, d: i.maxOff.toFixed(1) });
    if (i.mode === "points") return T("{n} 个桩号点连线（没找到对得上的中线）", { n: i.used });
    return T("桩号点对不上中线，桩号可能不准");
  };
  const body = openSheet(T("批量导入"), `
    <p class="note">${T("这个文件里有 {n} 条路，每条路自动配好中线和桩号。取消勾选不要的，再点导入。", { n: items.length })}</p>
    <ul class="list batch">${items.map((it, k) => `
      <li><label class="check"><input type="checkbox" data-k="${k}" ${it.ok ? "checked" : ""}>
        <span class="meta"><b>${esc(it.name)}</b><small>${rangeText(it.r)} · ${kmText(it.r.length)}<br>${quality(it)}</small></span></label></li>`).join("")}</ul>
    <div class="field"><span>${T("颜色（这批路段统一用一种）")}</span>${colorPicker(color)}</div>
    <div class="actions"><button class="btn" id="baCancel">${T("取消")}</button><button class="btn primary" id="baGo"></button></div>`,
  { onClose: () => previewLayer.clearLayers() });
  const draw = () => {
    previewLayer.clearLayers();
    const all = [];
    body.querySelectorAll("[data-k]").forEach((cb) => {
      if (!cb.checked) return;
      const r = items[+cb.dataset.k].r;
      const ll = r.pts.map(([e, n]) => fromUTM(e, n, r.crs)); all.push(...ll);
      L.polyline(ll, { color, weight: 4, interactive: false }).addTo(previewLayer);
    });
    const n = all.length ? body.querySelectorAll("[data-k]:checked").length : 0;
    body.querySelector("#baGo").textContent = T("导入选中的 {n} 条", { n });
    body.querySelector("#baGo").disabled = !n;
    if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [20, 20] });
  };
  body.querySelectorAll("[data-k]").forEach((cb) => cb.addEventListener("change", draw));
  bindColors(body, (c) => { color = c; draw(); });
  body.querySelector("#baCancel").addEventListener("click", closeSheet);
  body.querySelector("#baGo").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const pick = [...body.querySelectorAll("[data-k]:checked")].map((cb) => items[+cb.dataset.k]);
    const now = Date.now();
    for (const [i, it] of pick.entries()) {
      const obj = { ...it.data, id: newId(), name: it.name, color, visible: true, order: now + i, created: new Date().toISOString(), source };
      if (sink) await sink(obj); else await store.put(obj);
    }
    const shared = !!sink; sink = null;
    previewLayer.clearLayers();
    await askPersist(); await loadRoads(); closeSheet();
    toast(shared ? T("已加入共享 {n} 条（还没发布）", { n: pick.length }) : T("已导入 {n} 条路段", { n: pick.length }));
  });
  draw();
}
