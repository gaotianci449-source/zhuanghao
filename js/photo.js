// 拍照加水印：时间、桩号、偏距、路段、坐标、附近地标，可以加一句备注；分享到微信或存到手机
import { toUTM, zoneOf, formatCh } from "./geo.js";
import { S, hooks } from "./state.js";
import { $, esc, toast, openSheet, closeSheet, shareFile } from "./ui.js";
import { T } from "./i18n.js";

let shot = null; // 按下拍照时的位置信息

$("camera").addEventListener("click", () => {
  if (S.watchId == null) hooks.startGPS();
  shot = snapshot();
  $("filePhoto").click();
});
$("filePhoto").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  // 拍完回来时如果有更新的定位，用更新的（拍照过程中人可能走了几步）
  const now = snapshot();
  const info = now.me && (!shot?.me || now.me.t >= shot.me.t) ? now : shot || now;
  info.time = new Date();
  try { await preview(f, info); } catch (err) { toast(T("照片打不开，请重新拍一张。")); }
});

function snapshot() {
  const me = S.me ? { ...S.me } : null;
  const b = S.last;
  let ch = null, side = "", off = null, road = "", far = false;
  if (me && b) {
    road = b.r.name;
    if (b.q.far || b.q.d > S.maxOff || b.q.beyond) far = true;
    else { ch = b.q.ch; off = Math.abs(b.q.off); side = off < 0.5 ? T("中线上") : T(b.q.off > 0 ? "左" : "右"); }
  }
  return { me, ch, side, off, road, far, near: me ? hooks.nearText(me.lat, me.lon) : "" };
}

const pad = (n) => String(n).padStart(2, "0");
const timeText = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function lines(info, note) {
  const out = [];
  if (info.ch != null) out.push({ big: true, text: `${formatCh(info.ch, 0)}  ${info.side}${info.off >= 0.5 ? " " + info.off.toFixed(1) + T("米") : ""}` });
  else out.push({ big: true, text: info.me ? (info.far ? T("不在路段范围内") : "—") : T("没有定位") });
  if (info.road) out.push({ text: info.road });
  out.push({ text: timeText(info.time) });
  if (info.me) {
    const { lat, lon, acc } = info.me;
    const [e, n] = toUTM(lat, lon, { zone: zoneOf(lon), south: lat < 0 });
    out.push({ text: `${Math.abs(lat).toFixed(6)}°${lat >= 0 ? "N" : "S"}  ${Math.abs(lon).toFixed(6)}°${lon >= 0 ? "E" : "W"}  ±${Math.round(acc)}m` });
    out.push({ text: `UTM ${zoneOf(lon)}${lat >= 0 ? "N" : "S"}  N ${n.toFixed(2)}  E ${e.toFixed(2)}` });
  }
  if (info.near) out.push({ text: info.near });
  if (note) out.push({ text: note, note: true });
  return out;
}

async function loadImage(f) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(f, { imageOrientation: "from-image" }); } catch (e) { /* 退回 img */ }
  }
  const url = URL.createObjectURL(f);
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  return img;
}

async function render(img, info, note) {
  const W0 = img.width, H0 = img.height;
  const k = Math.min(1, 2560 / Math.max(W0, H0));
  const W = Math.round(W0 * k), H = Math.round(H0 * k);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, W, H);
  const u = Math.max(W, H) / 1000;            // 字号单位：随照片大小变
  const ls = lines(info, note);
  const fBig = Math.round(44 * u), fSm = Math.round(22 * u), pad = Math.round(18 * u), gap = Math.round(8 * u);
  const fontNum = `600 ${fBig}px "Num", "Roboto Condensed", "Arial Narrow", sans-serif`;
  const fontSm = `${fSm}px -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", Roboto, sans-serif`;
  let h = pad, w = 0;
  for (const l of ls) {
    g.font = l.big ? fontNum : fontSm;
    w = Math.max(w, g.measureText(l.text).width);
    h += (l.big ? fBig : fSm) + gap;
  }
  h += pad - gap;
  w = Math.min(W - 2 * pad, w + 2 * pad + 6 * u);
  const x0 = pad, y0 = H - pad - h;
  g.fillStyle = "rgba(20,22,24,0.62)";
  g.fillRect(x0, y0, w, h);
  g.fillStyle = "#FFC81E"; g.fillRect(x0, y0, Math.round(6 * u), h); // 左侧黄条
  let y = y0 + pad;
  g.textBaseline = "top";
  for (const l of ls) {
    g.font = l.big ? fontNum : fontSm;
    g.fillStyle = l.big ? "#FFC81E" : l.note ? "#FFFFFF" : "#E9EAEA";
    g.fillText(l.text, x0 + pad + 6 * u, y, w - 2 * pad);
    y += (l.big ? fBig : fSm) + gap;
  }
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
}

async function preview(f, info) {
  await document.fonts?.load?.('600 40px "Num"').catch(() => {});
  const img = await loadImage(f);
  let blob = await render(img, info, "");
  let url = URL.createObjectURL(blob);
  const body = openSheet(T("照片"), `
    <img class="photo" id="phImg" src="${url}" alt="${T("加了水印的照片")}">
    <label class="field"><span>${T("备注（可不填）")}</span><input id="phNote" maxlength="40" placeholder="${T("例如 边沟开挖")}"></label>
    <div class="actions"><button class="btn" id="phSave">${T("保存到手机")}</button><button class="btn primary" id="phShare">${T("分享")}</button></div>
    ${info.me ? "" : `<p class="note">${T("拍照时还没有定位，水印里没有桩号。")}</p>`}`,
  { onClose: () => URL.revokeObjectURL(url) });
  let t = null;
  body.querySelector("#phNote").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      blob = await render(img, info, e.target.value.trim());
      URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
      body.querySelector("#phImg").src = url;
    }, 300);
  });
  const name = () => `${info.ch != null ? formatCh(info.ch, 0).replace("+", "+") + "_" : ""}${timeText(info.time).replace(/[-: ]/g, "")}.jpg`;
  body.querySelector("#phShare").addEventListener("click", () => shareFile(name(), blob));
  body.querySelector("#phSave").addEventListener("click", () => {
    const a = document.createElement("a"); a.href = url; a.download = name();
    document.body.appendChild(a); a.click(); a.remove();
    toast(T("已保存到手机的“下载”文件夹，相册里一般也能看到"));
  });
}
export { closeSheet, esc };
