// 公用的界面零件：底部面板、提示条、颜色选择、文件分享
import { T } from "./i18n.js";

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 8 种颜色，在卫星图上都能看清，彼此也分得开
export const COLORS = ["#FFC81E", "#2D7FF9", "#E0312A", "#14A06F", "#B04BE0", "#FF7A1A", "#00C2D6", "#FF4FA3"];
export function nextColor(used) {
  const u = new Set(used);
  return COLORS.find((c) => !u.has(c)) || COLORS[used.length % COLORS.length];
}
// 浅色（黄、青）用深色描边，深色用白色描边
export function haloOf(c) {
  const v = parseInt(c.slice(1), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1E2124" : "#fff";
}

let sheetCleanup = null;
export function openSheet(title, html, opts = {}) {
  if (sheetCleanup) { const f = sheetCleanup; sheetCleanup = null; f(); }
  $("sheetTitle").textContent = title;
  $("sheetBody").innerHTML = html;
  $("sheet").hidden = false;
  $("sheet").classList.toggle("peek", !!opts.peek);
  $("scrim").hidden = !!opts.peek;
  $("sheetBody").scrollTop = 0;
  sheetCleanup = opts.onClose || null;
  return $("sheetBody");
}
export function closeSheet() {
  $("sheet").hidden = true; $("scrim").hidden = true;
  if (sheetCleanup) { const f = sheetCleanup; sheetCleanup = null; f(); }
}
export const sheetOpen = () => !$("sheet").hidden;

let toastT = null;
export function toast(msg, ms = 3200) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

export function colorPicker(sel) {
  return `<div class="colors" role="radiogroup" aria-label="${T("颜色")}">${COLORS.map((c, i) => `<button type="button" role="radio" data-c="${c}" aria-checked="${c === sel}" style="background:${c}" aria-label="${T("颜色")} ${i + 1}"></button>`).join("")}</div>`;
}
export function bindColors(root, onPick) {
  root.querySelectorAll(".colors button").forEach((b) => b.addEventListener("click", () => {
    root.querySelectorAll(".colors button").forEach((x) => x.setAttribute("aria-checked", x === b));
    onPick(b.dataset.c);
  }));
}

// 两次点击确认（删除等）
export function confirmTwice(btn, label, fn) {
  let armed = false;
  btn.addEventListener("click", (e) => {
    if (!armed) { armed = true; btn.textContent = label; return; }
    fn(e);
  });
}

// 手机上优先用“分享”（可以直接发微信），不支持时下载
export async function shareFile(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(T("已下载：{name}", { name }));
}

export const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
export function dateText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function durText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

export const ICON = {
  zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
};
