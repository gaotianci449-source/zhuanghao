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
  const neg = m < 0;
  const v = Math.abs(m);
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
  return DIRS[Math.round(b / 45) % 8];
}

export function distText(d) {
  if (d >= 1000) return (d / 1000).toFixed(d >= 10000 ? 1 : 2) + " 公里";
  return Math.round(d) + " 米";
}
