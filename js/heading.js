// 方向：手机指南针（站着、慢走）+ GPS 移动方向（开车、快走）
// 显示：定位蓝点前的扇形；左上角小指北针，点开是大罗盘，找过桩号时还会指向目标
import { toUTM, zoneOf, bearingText, distText } from "./geo.js";
import { S, hooks } from "./state.js";
import { $, openSheet, closeSheet, sheetOpen } from "./ui.js";
import { findTarget, findLabel } from "./find.js";
import { T } from "./i18n.js";

const H = { compass: null, compassAt: 0, spread: 40, listening: false, needPerm: false, sx: 0, sy: 0, hist: [] };
const FAST = 1.5; // 米/秒，超过就用 GPS 方向

// 当前方向：{ deg, spread, src } 或 null
export function heading() {
  const me = S.me;
  if (me && me.speed != null && me.speed > FAST && me.heading != null && !isNaN(me.heading) && Date.now() - me.t < 5000)
    return { deg: me.heading, spread: 20, src: "gps" };
  if (H.compass != null && Date.now() - H.compassAt < 3000) return { deg: H.compass, spread: H.spread, src: "compass" };
  return null;
}

function onCompass(deg, acc) {
  // 圆周上的平滑：把角度当成单位向量做滑动平均，避免 359°→0° 跳一圈
  const r = (deg * Math.PI) / 180;
  if (!H.compassAt || Date.now() - H.compassAt > 2000) { H.sx = Math.sin(r); H.sy = Math.cos(r); }
  else { H.sx = H.sx * 0.8 + Math.sin(r) * 0.2; H.sy = H.sy * 0.8 + Math.cos(r) * 0.2; }
  H.compass = ((Math.atan2(H.sx, H.sy) * 180) / Math.PI + 360) % 360;
  H.compassAt = Date.now();
  // 抖动越大，扇形越宽
  H.hist.push(deg); if (H.hist.length > 12) H.hist.shift();
  let sx = 0, sy = 0;
  for (const d of H.hist) { sx += Math.sin((d * Math.PI) / 180); sy += Math.cos((d * Math.PI) / 180); }
  const R = Math.hypot(sx, sy) / H.hist.length;
  const sd = Math.sqrt(-2 * Math.log(Math.max(R, 1e-6))) * 180 / Math.PI;
  H.spread = Math.max(acc ?? 0, Math.min(90, Math.max(25, sd * 3)));
  schedule();
}
const screenAngle = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;

function listen() {
  if (H.listening) return;
  H.listening = true;
  if ("ondeviceorientationabsolute" in window) {
    // 安卓 Chrome：alpha 是相对正北、逆时针
    window.addEventListener("deviceorientationabsolute", (e) => {
      if (e.alpha == null) return;
      onCompass((360 - e.alpha + screenAngle()) % 360);
    });
  } else {
    window.addEventListener("deviceorientation", (e) => {
      if (e.webkitCompassHeading != null) onCompass((e.webkitCompassHeading + screenAngle()) % 360, e.webkitCompassAccuracy > 0 ? e.webkitCompassAccuracy : null); // 苹果
      else if (e.absolute && e.alpha != null) onCompass((360 - e.alpha + screenAngle()) % 360);
    });
  }
}

// 苹果手机要用户点一下才能用指南针；安卓直接开始
export async function enableCompass() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    try { H.needPerm = (await D.requestPermission()) !== "granted"; if (!H.needPerm) listen(); }
    catch (e) { H.needPerm = true; }
  } else listen();
}
hooks.enableCompass = enableCompass;
if (!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function")) listen();

/* ---------- 画出来 ---------- */
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
hooks.onPos.push(schedule);
setInterval(schedule, 1000); // 指南针停了要及时隐藏扇形

const dirName = (deg) => bearingText(Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180));

// 角度“展开”成连续的数：359° 之后是 361° 而不是 1°，
// 否则转动动画会从 359° 倒着转一整圈回到 1°（正北附近表盘自己打转就是这个原因）
const last = {};
function unwrap(key, deg) {
  if (last[key] == null) return (last[key] = deg);
  const d = ((((deg - last[key]) % 360) + 540) % 360) - 180;
  return (last[key] += d);
}

function render() {
  const h = heading();
  // 定位点：蓝点一直在，有方向时蓝点外侧多一个箭头指着手机朝向
  const arrow = document.querySelector(".me .me-arrow");
  if (arrow) {
    if (h) { arrow.removeAttribute("hidden"); arrow.style.transform = `rotate(${unwrap("arrow", h.deg)}deg)`; }
    else arrow.setAttribute("hidden", "");
  }
  // 左上角小指北针：刻度盘反向转，让“北”始终指向真北；没有方向时回到北朝上
  const w = $("compass");
  const a = unwrap("dial", h ? -h.deg : 0);
  w.querySelector(".dial").style.transform = `rotate(${a}deg)`;
  upright(w.querySelector(".dial"), -a);
  w.classList.toggle("live", !!h);
  w.querySelector(".deg").textContent = h ? `${Math.round(h.deg) % 360}°` : "";
  if (sheetOpen() && $("sheetBody").querySelector("#cpBig")) renderBig(h);
}

// 相对方向：目标在你的哪一边
function relText(rel) {
  const a = ((rel % 360) + 360) % 360;
  if (a < 15 || a >= 345) return T("正前方");
  if (a < 75) return T("右前方 {d}°", { d: Math.round(a) });
  if (a < 105) return T("右侧");
  if (a < 165) return T("右后方");
  if (a < 195) return T("正后方");
  if (a < 255) return T("左后方");
  if (a < 285) return T("左侧");
  return T("左前方 {d}°", { d: Math.round(360 - a) });
}

const DIAL = (big) => {
  const ticks = [];
  for (let a = 0; a < 360; a += big ? 10 : 30) {
    if (!big && a % 90 === 0) continue; // 小表盘四个正方向位置写字，不画刻度
    const major = a % 90 === 0, len = big ? (major ? 14 : a % 30 === 0 ? 9 : 5) : (major ? 8 : 5);
    ticks.push(`<line x1="50" y1="${3}" x2="50" y2="${3 + len * (big ? 0.5 : 1)}" transform="rotate(${a} 50 50)" class="${major ? "maj" : ""}"/>`);
  }
  // 东南西北四个字：位置随表盘转，字本身保持正着（render 里再转回来）
  const r = big ? 31 : 29;
  const lab = (a, t, cls = "") => {
    const x = 50 + r * Math.sin((a * Math.PI) / 180), y = 50 - r * Math.cos((a * Math.PI) / 180);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="0.36em" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}" class="lab ${cls}">${t}</text>`;
  };
  return `<svg viewBox="0 0 100 100" class="dial">${ticks.join("")}
    ${lab(0, T("北"), "n") + lab(90, T("东")) + lab(180, T("南")) + lab(270, T("西"))}
    ${big ? '<g id="cpTarget" hidden><path d="M50 25 L58 41 L50 37 L42 41 Z"/><line x1="50" y1="40" x2="50" y2="50" class="tgl"/></g>' : ""}</svg>`;
};
const upright = (svg, deg) => svg.querySelectorAll("text.lab").forEach((t) => t.setAttribute("transform", `rotate(${deg} ${t.dataset.x} ${t.dataset.y})`));
$("compass").innerHTML = `${DIAL(false)}<span class="mark" aria-hidden="true"></span><span class="deg"></span>`;
$("compass").addEventListener("click", () => { enableCompass(); sheetCompass(); });

function sheetCompass() {
  last.big = null; // 新打开的大罗盘从当前角度开始，不做转动动画
  openSheet(T("指南针"), `
    <div class="bigcompass"><div class="ring">${DIAL(true)}</div><span class="mark" aria-hidden="true"></span></div>
    <p class="cp-head" id="cpBig"></p>
    <p class="cp-src note" id="cpSrc"></p>
    <div class="result" id="cpFind" hidden></div>
    <p class="note">${T("方向来自手机指南针，附近有车辆、钢筋、发电机时会偏。读数乱跳时，把手机在空中画几个“8”字校准。开车时自动改用 GPS 的行驶方向。方向只用来辨认东南西北，不能当测量方位角用。")}</p>`, { peek: true });
  renderBig(heading());
}

function renderBig(h) {
  const body = $("sheetBody");
  const ring = body.querySelector(".bigcompass .dial");
  if (ring) { const a = unwrap("big", h ? -h.deg : 0); ring.style.transform = `rotate(${a}deg)`; upright(ring, -a); }
  body.querySelector("#cpBig").textContent = h ? `${dirName(h.deg)} ${Math.round(h.deg) % 360}°` : T("没有方向数据");
  body.querySelector("#cpSrc").textContent = !h
    ? (H.needPerm ? T("需要允许使用指南针：点一下上面的小指北针再试。") : T("这台手机没有指南针，或者还没转动过手机。走动起来后会用 GPS 方向。"))
    : h.src === "gps" ? T("方向来自 GPS（正在移动）") : T("方向来自手机指南针，误差约 ±{d}°", { d: Math.round(h.spread / 2) });
  // 找桩号的目标
  const t = findTarget(), box = body.querySelector("#cpFind"), tg = body.querySelector("#cpTarget");
  if (!t || !S.me) { box.hidden = true; tg.setAttribute("hidden", ""); return; }
  const crs = { zone: zoneOf(S.me.lon), south: S.me.lat < 0 };
  const [me, mn] = toUTM(S.me.lat, S.me.lon, crs), [te, tn] = toUTM(t.ll[0], t.ll[1], crs);
  const brg = ((Math.atan2(te - me, tn - mn) * 180) / Math.PI + 360) % 360, d = Math.hypot(te - me, tn - mn);
  tg.removeAttribute("hidden");
  tg.setAttribute("transform", `rotate(${brg} 50 50)`);
  box.hidden = false;
  box.innerHTML = `<p><b>${findLabel()}</b></p><p>${T("距离 {d}", { d: `<span class="num">${distText(d)}</span>` })} · ${h ? relText(brg - h.deg) : T("在你的{dir}方", { dir: dirName(brg) })}</p>`;
}

export { closeSheet };
