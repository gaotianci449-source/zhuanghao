// 路段模型：中线（UTM 米坐标）+ 桩号标定表（沿线距离 s -> 桩号 ch）
// 存储结构 { id, name, color, visible, crs:{zone,south}, pts:[[E,N]...], cal:[[s,ch]...], info:{} }

export function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.001) out.push(p);
  }
  return out;
}

export function cumLen(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return L;
}

// 点到折线的最近投影；返回 s（沿线距离）、d（距离）、off（带符号偏距，左正右负）
export function project(pts, L, e, n, hint) {
  let best = null;
  const tryRange = (i0, i1) => {
    for (let i = Math.max(0, i0); i < Math.min(pts.length - 1, i1); i++) {
      const ax = pts[i][0], ay = pts[i][1];
      const dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((e - ax) * dx + (n - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx, qy = ay + t * dy;
      const d = Math.hypot(e - qx, n - qy);
      if (!best || d < best.d) {
        const cross = dx * (n - ay) - dy * (e - ax);
        best = { d, s: L[i] + t * Math.sqrt(l2), off: cross >= 0 ? d : -d, i };
      }
    }
  };
  tryRange(0, pts.length - 1);
  return best;
}

// 标定表插值，两端按 1:1 外推
function interp(table, x, xi, yi) {
  const n = table.length;
  if (n === 0) return x;
  if (n === 1) return table[0][yi] + (x - table[0][xi]);
  if (x <= table[0][xi]) return table[0][yi] + (x - table[0][xi]);
  if (x >= table[n - 1][xi]) return table[n - 1][yi] + (x - table[n - 1][xi]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid][xi] <= x) lo = mid; else hi = mid;
  }
  const a = table[lo], b = table[hi];
  const t = (x - a[xi]) / (b[xi] - a[xi] || 1);
  return a[yi] + t * (b[yi] - a[yi]);
}

export class Road {
  constructor(data) {
    Object.assign(this, data);
    this.L = cumLen(this.pts);
    this.length = this.L[this.L.length - 1];
    this.chMin = this.s2ch(0);
    this.chMax = this.s2ch(this.length);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of this.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    this.bbox = [x0, y0, x1, y1];
  }
  s2ch(s) { return interp(this.cal, s, 0, 1); }
  ch2s(ch) { return interp(this.cal, ch, 1, 0); }
  // 沿线 s 处的点和切线方向
  at(s) {
    const L = this.L, P = this.pts;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    const seg = L[hi] - L[lo] || 1;
    const t = (s - L[lo]) / seg;
    const dx = (P[hi][0] - P[lo][0]) / seg, dy = (P[hi][1] - P[lo][1]) / seg;
    return { e: P[lo][0] + t * (P[hi][0] - P[lo][0]), n: P[lo][1] + t * (P[hi][1] - P[lo][1]), ux: dx, uy: dy };
  }
  // 桩号 + 偏距（左正右负）-> 坐标
  pointAt(ch, off = 0) {
    const p = this.at(this.ch2s(ch));
    return [p.e - p.uy * off, p.n + p.ux * off];
  }
  locate(e, n) {
    const [x0, y0, x1, y1] = this.bbox;
    const far = Math.max(x0 - e, e - x1, y0 - n, n - y1, 0);
    if (far > 20000) return { d: far, far: true };
    const r = project(this.pts, this.L, e, n);
    // 超出起终点时偏距按端点方向计算，不算在线内
    r.ch = this.s2ch(r.s);
    r.beyond = r.s <= 0.01 && this.length > 0 ? "start" : r.s >= this.length - 0.01 ? "end" : null;
    return r;
  }
}

// 用中线 + 桩号点生成标定表；会自动纠正方向（桩号增大方向 = 折线前进方向）
export function buildRoad({ name, crs, line, stations, startCh = 0 }) {
  let pts = line && line.length >= 2 ? dedupe(line) : null;
  let stn = (stations || []).filter((p) => isFinite(p.ch)).sort((a, b) => a.ch - b.ch);
  let info = { mode: "", used: 0, total: stn.length, maxOff: 0 };

  if (!pts) {
    // 只有桩号点：按桩号顺序连成中线
    const uniq = [];
    for (const p of stn) if (!uniq.length || p.ch > uniq[uniq.length - 1].ch) uniq.push(p);
    pts = uniq.map((p) => [p.e, p.n]);
    const L = cumLen(pts);
    const cal = uniq.map((p, i) => [L[i], p.ch]);
    info.mode = "points"; info.used = uniq.length;
    return { name, crs, pts, cal, info };
  }

  if (stn.length >= 2) {
    let L = cumLen(pts);
    let pr = stn.map((p) => ({ ...p, ...project(pts, L, p.e, p.n) }));
    // 方向：桩号越大 s 越大
    const first = pr[0].s, last = pr[pr.length - 1].s;
    if (last < first) {
      pts = pts.slice().reverse();
      L = cumLen(pts);
      pr = stn.map((p) => ({ ...p, ...project(pts, L, p.e, p.n) }));
    }
    // 只采用离中线 30 米以内、且 s 单调递增的点
    const cal = [];
    for (const p of pr) {
      if (p.d > 30) continue;
      if (cal.length && p.s <= cal[cal.length - 1][0] + 0.01) continue;
      cal.push([p.s, p.ch]);
      info.maxOff = Math.max(info.maxOff, p.d);
    }
    info.used = cal.length;
    if (cal.length >= 2) {
      info.mode = "line+points";
      return { name, crs, pts, cal, info };
    }
  }
  info.mode = "line";
  const L = cumLen(pts);
  return { name, crs, pts, cal: [[0, startCh], [L[L.length - 1], startCh + L[L.length - 1]]], info };
}

// 在若干候选线中挑与桩号点最吻合的一条
export function pickCenterline(lines, stations) {
  if (!lines.length) return null;
  const scored = lines.map((ln) => {
    const L = cumLen(ln.pts);
    let hit = 0;
    if (stations.length) {
      const sample = stations.length > 200 ? stations.filter((_, i) => i % Math.ceil(stations.length / 200) === 0) : stations;
      for (const p of sample) if (project(ln.pts, L, p.e, p.n).d < 15) hit++;
      hit /= sample.length;
    }
    return { ln, hit, len: L[L.length - 1] };
  });
  scored.sort((a, b) => (b.hit - a.hit) || (b.len - a.len));
  return scored;
}
