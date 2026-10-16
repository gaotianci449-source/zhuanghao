// 读取 KML 与坐标文件（XYZ / CSV / DAT / TXT）
import { parseCh, toUTM, zoneOf } from "./geo.js";
import { buildRoad, pickCenterline, cumLen } from "./road.js";

const KML_NS = "http://www.opengis.net/kml/2.2";

function coordsOf(el) {
  return el.textContent.trim().split(/\s+/).map((c) => c.split(",").map(Number)).filter((c) => c.length >= 2 && isFinite(c[0]) && isFinite(c[1]));
}

function folderPath(el) {
  const names = [];
  let p = el.parentElement;
  while (p) {
    if (p.localName === "Folder" || p.localName === "Document") {
      const nm = [...p.children].find((c) => c.localName === "name");
      if (nm && p.localName === "Folder") names.unshift(nm.textContent.trim());
    }
    p = p.parentElement;
  }
  return names.join(" / ");
}

// 返回 { lines:[{name, folder, ll:[[lon,lat]...]}], points:[{name, folder, lon, lat}] }
export function parseKML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("这个文件不是有效的 KML。");
  const lines = [], points = [];
  for (const pm of doc.getElementsByTagNameNS("*", "Placemark")) {
    const nmEl = [...pm.children].find((c) => c.localName === "name");
    const name = nmEl ? nmEl.textContent.trim() : "";
    const folder = folderPath(pm);
    for (const ls of pm.getElementsByTagNameNS("*", "LineString")) {
      const c = ls.getElementsByTagNameNS("*", "coordinates")[0];
      if (c) { const ll = coordsOf(c); if (ll.length >= 2) lines.push({ name, folder, ll }); }
    }
    for (const pt of pm.getElementsByTagNameNS("*", "Point")) {
      const c = pt.getElementsByTagNameNS("*", "coordinates")[0];
      if (c) { const ll = coordsOf(c)[0]; if (ll) points.push({ name, folder, lon: ll[0], lat: ll[1] }); }
    }
  }
  return { lines, points };
}

// 从 KML 内容里分析出：候选中线、桩号点
export function analyzeKML(kml) {
  const all = [...kml.lines.flatMap((l) => l.ll), ...kml.points.map((p) => [p.lon, p.lat])];
  if (!all.length) throw new Error("文件里没有找到线或点。");
  const lon = all.reduce((s, c) => s + c[0], 0) / all.length;
  const lat = all.reduce((s, c) => s + c[1], 0) / all.length;
  const crs = { zone: zoneOf(lon), south: lat < 0 };
  const P = (lo, la) => toUTM(la, lo, crs);

  let stations = kml.points.map((p) => ({ name: p.name, ch: parseCh(p.name), ...xy(P(p.lon, p.lat)) })).filter((p) => p.ch != null);
  let plainUsed = false;
  if (stations.length < 2) {
    const plain = kml.points.map((p) => ({ name: p.name, ch: parseCh(p.name, true), ...xy(P(p.lon, p.lat)) })).filter((p) => p.ch != null);
    if (plain.length >= 5) { stations = plain; plainUsed = true; }
  }
  const lines = kml.lines.map((l, i) => {
    const pts = l.ll.map(([lo, la]) => P(lo, la));
    const L = cumLen(pts);
    return { id: i, name: l.name, folder: l.folder, pts, len: L[L.length - 1] };
  }).filter((l) => l.len > 50);
  // 太多短线（横断面线等）时，只保留最长的 40 条做候选
  lines.sort((a, b) => b.len - a.len);
  const cands = lines.slice(0, 40);
  const ranked = pickCenterline(cands, stations) || [];
  return { crs, stations, plainUsed, candidates: ranked.map((r) => ({ ...r.ln, hit: r.hit })) };
}

function xy([e, n]) { return { e, n }; }

// 坐标文件：按行拆分，自动识别分隔符和各列含义
export function parseTable(text) {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/\s*[,\t;，]\s*|\s+/).filter((c) => c !== ""));
  if (!rows.length) throw new Error("文件是空的。");
  const width = Math.max(...rows.map((r) => r.length));
  const isNum = (v) => v != null && /^-?\d+(\.\d+)?$/.test(v);
  const body = rows.filter((r) => r.some(isNum));
  const header = rows[0].some(isNum) ? null : rows[0];
  const cols = [];
  for (let c = 0; c < width; c++) {
    const vals = body.map((r) => r[c]);
    const nums = vals.filter(isNum).map(Number);
    cols.push({
      index: c,
      title: header ? header[c] || `第${c + 1}列` : `第${c + 1}列`,
      sample: vals.slice(0, 3).join("  "),
      numeric: nums.length >= body.length * 0.9,
      min: Math.min(...nums), max: Math.max(...nums),
      chainLike: vals.filter((v) => parseCh(v) != null).length >= body.length * 0.8,
    });
  }
  // 猜测：东坐标 10 万~90 万；北坐标通常更大（几内亚一带约 100 万多）
  const guess = { name: -1, north: -1, east: -1, height: -1 };
  const chainCol = cols.find((c) => c.chainLike);
  const textCol = cols.find((c) => !c.numeric);
  guess.name = chainCol ? chainCol.index : textCol ? textCol.index : -1;
  const numCols = cols.filter((c) => c.numeric && c.index !== guess.name);
  const eastC = numCols.filter((c) => c.min >= 100000 && c.max <= 900000);
  const northC = numCols.filter((c) => c.min >= 0 && c.max > 900000 && c.max < 10000000);
  if (eastC.length === 1 && northC.length >= 1) { guess.east = eastC[0].index; guess.north = northC[0].index; }
  else if (eastC.length >= 2) { guess.north = eastC[0].index; guess.east = eastC[1].index; } // 无法判断时按“先北后东”的测量习惯
  const rest = numCols.filter((c) => c.index !== guess.east && c.index !== guess.north && c.max < 10000);
  if (rest.length) guess.height = rest[rest.length - 1].index;
  if (guess.name < 0) {
    // 可能有一列是纯数字桩号（米），挑单调递增且不是坐标的那一列
    const mono = numCols.find((c) => c.index !== guess.east && c.index !== guess.north && isMonotonic(body.map((r) => Number(r[c.index]))));
    if (mono) guess.name = mono.index;
  }
  return { rows: body, cols, guess, header };
}

function isMonotonic(a) {
  let up = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[i - 1]) up++;
  return up >= (a.length - 1) * 0.95;
}

// 坐标文件 -> 桩号点
export function tableStations(table, map, crs) {
  const out = [];
  for (const r of table.rows) {
    const ch = parseCh(r[map.name], true);
    const n = Number(r[map.north]), e = Number(r[map.east]);
    if (ch == null || !isFinite(n) || !isFinite(e)) continue;
    out.push({ ch, e, n, name: r[map.name] });
  }
  return out;
}

export { buildRoad };
