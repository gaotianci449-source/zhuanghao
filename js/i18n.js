// 界面文字：中文写在代码里，法语按中文原文查表；查不到时显示中文
import { FR } from "./fr.js";

const KEY = "zh.lang";
function initial() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (v === "zh" || v === "fr") return v; } catch (e) { /* 忽略 */ }
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
  // 中文系统用中文，其余（法语、英语等）用法语：几内亚当地书面语是法语
  return langs.some((l) => /^zh/i.test(l)) ? "zh" : "fr";
}
export let lang = initial();
export const missing = new Set(); // 测试用：记录没有翻译的文字

export function setLang(l) {
  lang = l;
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) { /* 忽略 */ }
}

// T("离中线 {d} 米", { d: 3 })；变量值原样插入（需要时调用方先转义）
export function T(zh, vars) {
  let s = zh;
  if (lang === "fr") {
    const f = FR[zh];
    if (f != null) s = f; else missing.add(zh);
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// 页面里写死的文字：data-t（文字）、data-t-label（aria-label 和 title）
export function applyStatic(root = document) {
  document.documentElement.lang = lang === "fr" ? "fr" : "zh-CN";
  root.querySelectorAll("[data-t]").forEach((el) => {
    if (!el.dataset.zh) el.dataset.zh = el.dataset.t;
    el.textContent = T(el.dataset.zh);
  });
  root.querySelectorAll("[data-t-label]").forEach((el) => {
    const v = T(el.dataset.tLabel);
    el.setAttribute("aria-label", v);
    if (el.hasAttribute("title")) el.setAttribute("title", v);
  });
}
