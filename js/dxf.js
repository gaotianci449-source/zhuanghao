// 读取 CAD 的 DXF：取出线（中线）和写着桩号的文字，交给 KML 那套导入流程
// DWG 先在 dwg.js 里转成 DXF，再走这里
import { fromUTM, parseCh } from "./geo.js";
import { T } from "./i18n.js";

// 中文版 CAD 存的文字是 GBK（$DWGCODEPAGE = ANSI_936），2007 及以后的 DXF 是 UTF-8
export function decodeDXF(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 65536));
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head)?.[1]?.toUpperCase() || "";
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/.exec(head)?.[1];
  let label = "utf-8";
  if (!ver || +ver < 1021) {
    if (cp === "ANSI_936" || cp === "GB2312" || cp === "GBK") label = "gbk";
    else if (cp === "ANSI_950") label = "big5";
    else if (/^ANSI_125\d$/.test(cp)) label = "windows-" + cp.slice(5);
  }
  let t = new TextDecoder(label).decode(bytes);
  if (label === "utf-8" && t.includes("�")) t = new TextDecoder("gbk").decode(bytes);
  return t;
}

// 圆弧 / 带凸度的多段线拆成短直线，每段不超过 2 米
function arcPts(cx, cy, r, a0, a1) {
  let sweep = a1 - a0;
  const n = Math.max(2, Math.ceil(Math.abs(sweep * r) / 2));
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
function bulgePts(p, q, b) {
  if (!b) return [q];
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (d < 1e-9) return [q];
  const th = 4 * Math.atan(b);                  // 圆心角，正数为逆时针
  const h = d / (2 * Math.tan(th / 2));         // 弦中点到圆心（带符号，正数在左侧）
  const ux = -(q[1] - p[1]) / d, uy = (q[0] - p[0]) / d;
  const cx = (p[0] + q[0]) / 2 + ux * h, cy = (p[1] + q[1]) / 2 + uy * h;
  const r = Math.hypot(p[0] - cx, p[1] - cy);
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  const pts = arcPts(cx, cy, r, a0, a0 + th).slice(1);
  pts[pts.length - 1] = q;
  return pts;
}

function cleanText(s) {
  return s.replace(/\\P/g, " ").replace(/\{\\[^;{}]*;|\}|\{/g, "").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/%%[cdpCDP]/g, "").trim();
}

// 返回 { lines:[{layer, pts:[[E,N]...]}], points:[[E,N]], texts:[{text, layer, x, y}], codepageOK }
export function parseDXF(text) {
  const L = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < L.length; i += 2) pairs.push([L[i].trim(), L[i + 1]]);
  let i = pairs.findIndex(([c, v], k) => c === "2" && v.trim() === "ENTITIES" && pairs[k - 1]?.[1].trim() === "SECTION");
  if (i < 0) throw new Error(T("这个 CAD 文件里没有找到图形。"));
  const ents = [];
  let cur = null;
  for (i++; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === "0") {
      if (cur) ents.push(cur);
      const t = v.trim();
      if (t === "ENDSEC") { cur = null; break; }
      cur = { type: t, g: [] };
    } else if (cur) cur.g.push([+c, v]);
  }
  const lines = [], points = [], texts = [];
  let poly = null;
  const num = (g, code) => { const x = g.find(([c]) => c === code); return x ? parseFloat(x[1]) : NaN; };
  const str = (g, code) => g.find(([c]) => c === code)?.[1] ?? "";
  for (const e of ents) {
    const layer = str(e.g, 8).trim();
    if (e.type === "LWPOLYLINE") {
      const pts = []; let x = null, b = 0;
      const closed = (num(e.g, 70) & 1) === 1;
      for (const [c, v] of e.g) {
        if (c === 10) x = parseFloat(v);
        else if (c === 20 && x != null) {
          const p = [x, parseFloat(v)];
          if (pts.length) pts.push(...bulgePts(pts[pts.length - 1], p, b)); else pts.push(p);
          b = 0; x = null;
        } else if (c === 42) b = parseFloat(v);
      }
      if (closed && pts.length > 2) pts.push(...bulgePts(pts[pts.length - 1], pts[0], b));
      if (pts.length >= 2) lines.push({ layer, pts });
    } else if (e.type === "POLYLINE") {
      poly = { layer, pts: [], b: 0, closed: (num(e.g, 70) & 1) === 1 };
    } else if (e.type === "VERTEX" && poly) {
      const p = [num(e.g, 10), num(e.g, 20)];
      if (poly.pts.length) poly.pts.push(...bulgePts(poly.pts[poly.pts.length - 1], p, poly.b)); else poly.pts.push(p);
      poly.b = num(e.g, 42) || 0;
    } else if (e.type === "SEQEND" && poly) {
      if (poly.pts.length >= 2) lines.push({ layer: poly.layer, pts: poly.pts });
      poly = null;
    } else if (e.type === "LINE") {
      lines.push({ layer, pts: [[num(e.g, 10), num(e.g, 20)], [num(e.g, 11), num(e.g, 21)]], piece: true });
    } else if (e.type === "ARC") {
      const r = num(e.g, 40), a0 = num(e.g, 50) * Math.PI / 180;
      let a1 = num(e.g, 51) * Math.PI / 180;
      if (a1 <= a0) a1 += 2 * Math.PI;
      lines.push({ layer, pts: arcPts(num(e.g, 10), num(e.g, 20), r, a0, a1), piece: true });
    } else if (e.type === "POINT") {
      points.push([num(e.g, 10), num(e.g, 20)]);
    } else if (e.type === "TEXT" || e.type === "MTEXT") {
      let s = e.type === "MTEXT" ? e.g.filter(([c]) => c === 3).map(([, v]) => v).join("") + str(e.g, 1) : str(e.g, 1);
      s = cleanText(s);
      const ax = num(e.g, 11), ay = num(e.g, 21);
      const useAlign = e.type === "TEXT" && (num(e.g, 72) || num(e.g, 73)) && isFinite(ax);
      if (s) texts.push({ text: s, layer, x: useAlign ? ax : num(e.g, 10), y: useAlign ? ay : num(e.g, 20) });
    }
  }
  return { lines: joinPieces(lines).filter((l) => l.pts.every(([x, y]) => isFinite(x) && isFinite(y))), points, texts };
}

// CAD 里中线常常是一段段直线和圆弧分开画的：首尾相接的连成一条
function joinPieces(lines) {
  const out = lines.filter((l) => !l.piece);
  const byLayer = {};
  for (const l of lines.filter((l) => l.piece)) (byLayer[l.layer] ||= []).push(l.pts.slice());
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;
  for (const [layer, segs] of Object.entries(byLayer)) {
    if (segs.length > 20000) continue;
    const used = new Array(segs.length).fill(false);
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let chain = segs[i];
      let grown = true;
      while (grown) {
        grown = false;
        for (let j = 0; j < segs.length; j++) {
          if (used[j]) continue;
          const s = segs[j], h = chain[0], t = chain[chain.length - 1];
          if (near(t, s[0])) chain = chain.concat(s.slice(1));
          else if (near(t, s[s.length - 1])) chain = chain.concat(s.slice(0, -1).reverse());
          else if (near(h, s[s.length - 1])) chain = s.concat(chain.slice(1));
          else if (near(h, s[0])) chain = s.slice().reverse().concat(chain.slice(1));
          else continue;
          used[j] = true; grown = true;
        }
      }
      out.push({ layer, pts: chain });
    }
  }
  return out;
}

// 转成和 KML 一样的结构：线 + 带桩号名的点（经纬度）
// 桩号文字一般写在桩点旁边几米，优先用 15 米内最近的 POINT 当桩位
export function dxfToKml(d, crs) {
  const all = d.lines.flatMap((l) => l.pts);
  if (!all.length) throw new Error(T("这个 CAD 文件里没有找到线。"));
  const ok = all.filter(([x, y]) => x > 100000 && x < 900000 && y > 0 && y < 10000000).length / all.length;
  if (ok < 0.9) throw new Error(T("这张图的坐标不是 UTM 坐标（可能是工程独立坐标系），暂时不能直接导入。请找测量组要 UTM 坐标的图，或者坐标转换参数。"));
  const ll = ([x, y]) => { const [lat, lon] = fromUTM(x, y, crs); return [lon, lat]; };
  const lines = d.lines.map((l) => ({ name: l.layer || "0", folder: l.layer || "0", ll: l.pts.map(ll) }));
  const points = [];
  for (const t of d.texts) {
    if (parseCh(t.text) == null) continue;
    let best = null;
    for (const p of d.points) { const dd = Math.hypot(p[0] - t.x, p[1] - t.y); if (dd < 15 && (!best || dd < best.d)) best = { d: dd, p }; }
    const [lon, lat] = ll(best ? best.p : [t.x, t.y]);
    points.push({ name: t.text, folder: t.layer, lon, lat });
  }
  return { lines, points };
}
