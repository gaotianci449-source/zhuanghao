import { T, lang } from "./i18n.js";

// 坐标换算：WGS84 经纬度 <-> UTM（横轴墨卡托，Krüger 级数，毫米级精度）
const A = 6378137.0;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N_ = F / (2 - F);
const AA = (A / (1 + N_)) * (1 + N_ * N_ / 4 + N_ ** 4 / 64);
const E = Math.sqrt(F * (2 - F));
const ALPHA = [
  N_ / 2 - (2 * N_ * N_) / 3 + (5 * N_ ** 3) / 16,
  (13 * N_ * N_) / 48 - (3 * N_ ** 3) / 5,
  (61 * N_ ** 3) / 240,
];
const BETA = [
  N_ / 2 - (2 * N_ * N_) / 3 + (37 * N_ ** 3) / 96,
  N_ * N_ / 48 + N_ ** 3 / 15,
  (17 * N_ ** 3) / 480,
];
const DELTA = [
  2 * N_ - (2 * N_ * N_) / 3 - 2 * N_ ** 3,
  (7 * N_ * N_) / 3 - (8 * N_ ** 3) / 5,
  (56 * N_ ** 3) / 15,
];
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function zoneOf(lon) {
  return Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));
}

// crs: { zone: 28, south: false }
export function toUTM(lat, lon, crs) {
  const lon0 = rad(crs.zone * 6 - 183);
  const phi = rad(lat);
  const lam = rad(lon) - lon0;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - E * Math.atanh(E * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam));
  const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let x = eta, y = xi;
  for (let j = 1; j <= 3; j++) {
    x += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [500000 + K0 * AA * x, (crs.south ? 10000000 : 0) + K0 * AA * y];
}

export function fromUTM(e, n, crs) {
  const lon0 = rad(crs.zone * 6 - 183);
  const xi = (n - (crs.south ? 10000000 : 0)) / (K0 * AA);
  const eta = (e - 500000) / (K0 * AA);
  let xp = xi, ep = eta;
  for (let j = 1; j <= 3; j++) {
    xp -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    ep -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lam = Math.atan2(Math.sinh(ep), Math.cos(xp));
  return [deg(phi), deg(lon0 + lam)];
}

// 桩号文字 <-> 米数
export function formatCh(m, digits = 0) {
  if (!isFinite(m)) return "—";
  const v = Math.abs(m);
  const neg = m < 0 && parseFloat(v.toFixed(digits)) !== 0; // -0.0001 不显示成 -K0+000
  let km = Math.floor(v / 1000);
  let rest = v - km * 1000;
  let restStr = rest.toFixed(digits);
  if (parseFloat(restStr) >= 1000) { km += 1; restStr = (0).toFixed(digits); }
  const [ip, fp] = restStr.split(".");
  return (neg ? "-" : "") + "K" + km + "+" + ip.padStart(3, "0") + (fp ? "." + fp : "");
}

// 接受 K12+345.6 / 12+345 / k12 + 345 ；plain=true 时也接受纯数字（米）
export function parseCh(text, plain = false) {
  if (text == null) return null;
  const s = String(text).trim().replace(/\s+/g, "");
  let m = s.match(/^[Kk]?(\d+)\+(\d+(?:\.\d+)?)$/);
  if (m) return parseInt(m[1], 10) * 1000 + parseFloat(m[2]);
  if (plain) {
    m = s.match(/^[Kk]?(\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

const DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
export function bearingText(dE, dN) {
  const b = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
  return T(DIRS[Math.round(b / 45) % 8]);
}

export function distText(d) {
  if (d >= 1000) return (d / 1000).toFixed(d >= 10000 ? 1 : 2) + " " + T("公里");
  return Math.round(d) + " " + T("米");
}

// 测量用：更精细的长度
export function lenText(d) {
  if (d >= 1000) return (d / 1000).toFixed(3) + " " + T("公里");
  return d.toFixed(1) + " " + T("米");
}

// 一组经纬度点 [[lat, lon]...] 的长度、闭合周长、面积（换到第一个点所在的 UTM 带里算，再换回地面距离）
export function measureLL(pts) {
  if (!pts.length) return { length: 0, perimeter: 0, area: 0, gap: 0 };
  const crs = { zone: zoneOf(pts[0][1]), south: pts[0][0] < 0 };
  const xy = pts.map((p) => toUTM(p[0], p[1], crs));
  let length = 0, area = 0;
  for (let i = 1; i < xy.length; i++) length += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  const a = xy[0], z = xy[xy.length - 1];
  let gap = Math.hypot(a[0] - z[0], a[1] - z[1]);
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i], q = xy[(i + 1) % xy.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  // UTM 图上距离要除以投影比例 k，才是地面上的实际距离（离中央经线越远差得越多，这里约万分之三）
  const ce = xy.reduce((t, p) => t + p[0], 0) / xy.length - 500000;
  const k = K0 * (1 + (ce * ce) / (2 * 6371000 * 6371000));
  length /= k; gap /= k;
  return { length, perimeter: length + gap, area: xy.length >= 3 ? Math.abs(area) / 2 / (k * k) : 0, gap };
}

// 两个经纬度点之间的距离（米）
// 用椭球上每度的长度，适合相邻轨迹点这样的短距离
export function distLL(a, b) {
  const f = ((a[0] + b[0]) / 2) * Math.PI / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f);
  const mLon = 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f);
  return Math.hypot((b[0] - a[0]) * mLat, (b[1] - a[1]) * mLon);
}

// 面积：平方米、公顷，中文再加亩
export function areaText(m2) {
  const parts = [`${m2 < 100 ? m2.toFixed(1) : Math.round(m2).toLocaleString("en-US").replace(/,/g, " ")} ${T("平方米")}`, `${(m2 / 10000).toFixed(m2 < 10000 ? 4 : 2)} ${T("公顷")}`];
  if (lang === "zh") parts.push(`${(m2 / 666.6667).toFixed(2)} 亩`);
  return parts;
}
