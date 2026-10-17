// 添加到桌面：能一键的浏览器直接弹系统确认框；不能的，认出是什么浏览器，告诉他菜单在哪
// 网页没有权限自己往桌面放图标，只能“一键”（Chrome、Edge 等）或者“教他点”
import { S } from "./state.js";
import { prefs } from "./store.js";
import { $, esc, openSheet, closeSheet, toast } from "./ui.js";
import { dataKey, shareLink } from "./shared.js";
import { T } from "./i18n.js";

const ua = navigator.userAgent;

// 已经是从桌面图标打开的
export const standalone = () =>
  matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches ||
  navigator.standalone === true || document.referrer.startsWith("android-app://");

const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isNext = /OpenHarmony|ArkWeb/i.test(ua); // 纯血鸿蒙：不能装安卓软件

// 认浏览器。顺序有讲究：微信的 UA 里也带 MQQBrowser，所以先认微信
export function detect() {
  if (/MicroMessenger/i.test(ua)) return "wechat";
  if (/\bQQ\/[\d.]+/i.test(ua) || /DingTalk|Lark|Feishu|FBAN|FBAV|Instagram|Line\//i.test(ua)) return "inapp";
  if (isIOS) return "ios";
  if (isNext) return "huaweiNext";
  if (/HuaweiBrowser/i.test(ua)) return "huawei";
  if (/MiuiBrowser/i.test(ua)) return "xiaomi";
  if (/HeyTapBrowser|OppoBrowser/i.test(ua)) return "oppo";
  if (/VivoBrowser/i.test(ua)) return "vivo";
  if (/MQQBrowser/i.test(ua)) return "qqbrowser";
  if (/Quark/i.test(ua)) return "quark";
  if (/UCBrowser|UCWEB/i.test(ua)) return "uc";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/EdgA|Edg\//i.test(ua)) return "edge";
  if (/Firefox/i.test(ua)) return "firefox";
  if (/OPR\/|Opera/i.test(ua)) return "opera";
  if (/Chrome\//i.test(ua) && !/; wv\)/.test(ua) && !/Version\/[\d.]+ Chrome/.test(ua)) return "chrome";
  return "other";
}

// 每种浏览器：名字、主要步骤、找不到时再看哪里
function guide(id) {
  const G = {
    ios: { name: "Safari", steps: [T("点屏幕下方中间的“分享”按钮（方框加向上箭头）"), T("往下翻，点“添加到主屏幕”"), T("点右上角“添加”")],
      alt: [T("如果是在 Chrome 或其他浏览器里打开的，也是点“分享”按钮找“添加到主屏幕”；找不到就换 Safari 打开。")] },
    huaweiNext: { name: T("华为浏览器（鸿蒙）"), steps: [T("点屏幕右下角的“⋯”（四个点）"), T("在弹出的菜单里点“添加到桌面”"), T("点“添加”确认")],
      alt: [T("没有的话，先把华为浏览器升级到最新版（应用市场里搜“华为浏览器”）。")] },
    huawei: { name: T("华为浏览器"), steps: [T("点菜单：屏幕下方的“≡”，或右上角的“⋮”"), T("找“添加到桌面”或“添加至桌面”，点它")],
      alt: [T("菜单里没有：先点“收藏”或“添加书签”，在弹出的界面里选“桌面”或“添加到桌面”"), T("还没有：到菜单里的“工具箱”里找")] },
    xiaomi: { name: T("小米浏览器"), steps: [T("点屏幕下方的“≡”菜单"), T("找“添加到桌面”，或者“添加到” → “桌面”")],
      alt: [T("菜单里没有：到“工具箱”里找"), T("或者先点“收藏”，在收藏界面里选“桌面”")] },
    oppo: { name: T("OPPO / 一加浏览器"), steps: [T("点屏幕下方的“≡”菜单"), T("找“添加到” → “桌面”，或“添加到桌面”")],
      alt: [T("或者先点“收藏”，在收藏界面里选“桌面”")] },
    vivo: { name: T("vivo 浏览器"), steps: [T("点屏幕下方的“≡”菜单"), T("找“添加到桌面”，或者“添加书签” → 选“桌面”")],
      alt: [T("菜单里没有：到“工具箱”里找")] },
    qqbrowser: { name: T("QQ 浏览器"), steps: [T("点屏幕下方的“≡”菜单"), T("找“添加到” → “桌面”，或“发送到桌面”")],
      alt: [T("或者先点“收藏”，在收藏界面里选“添加到桌面”")] },
    quark: { name: T("夸克浏览器"), steps: [T("点屏幕下方的“≡”菜单"), T("找“添加到桌面”，或者“添加至” → “桌面”")],
      alt: [T("或者先点“收藏”，在收藏界面里选“桌面”")] },
    uc: { name: T("UC 浏览器"), steps: [T("点屏幕下方的“≡”菜单"), T("点“收藏网站”"), T("在收藏界面里选“添加到手机桌面”")], alt: [] },
    samsung: { name: T("三星浏览器"), steps: [T("点屏幕下方的“≡”菜单"), T("点“添加页面到” → “主屏幕”")], alt: [] },
    edge: { name: "Edge", steps: [T("点屏幕下方的“≡”菜单"), T("点“添加到手机”或“添加到主屏幕”")], alt: [] },
    chrome: { name: "Chrome", steps: [T("点右上角的“⋮”菜单"), T("点“添加到主屏幕”或“安装应用”")], alt: [] },
    firefox: { name: "Firefox", steps: [T("点右上角（或右下角）的“⋮”菜单"), T("点“添加到主屏幕”")], alt: [] },
    opera: { name: "Opera", steps: [T("点菜单（右上角“⋮”或下方的 O 图标）"), T("找“添加到主屏幕”")], alt: [] },
    other: { name: T("这个浏览器"), steps: [T("打开浏览器的菜单（一般是“≡”、“⋮”或“⋯”）"), T("找“添加到桌面”、“添加到主屏幕”或“发送到桌面”")],
      alt: [T("菜单里没有：先点“收藏”或“书签”，看收藏界面里有没有“桌面”"), T("还没有：到菜单里的“工具箱”里找")] },
  };
  return G[id];
}

// 在应用商店打开 Edge 的下载页：华为用应用市场，其他安卓用 market://
function openEdgeStore() {
  const huawei = /HUAWEI|HONOR|HarmonyOS|HuaweiBrowser/i.test(ua);
  location.href = (huawei ? "appmarket://details?id=" : "market://details?id=") + "com.microsoft.emmx";
  setTimeout(() => { if (document.visibilityState === "visible") toast(T("没能打开应用商店。请自己打开应用商店，搜“Edge”。"), 5000); }, 1500);
}

async function copyLink() {
  const link = dataKey() ? shareLink() : location.origin + location.pathname;
  try { await navigator.clipboard.writeText(link); toast(T("链接已复制")); }
  catch (e) { prompt(T("长按下面的链接复制："), link); }
}

// 主入口：“添加到桌面”按钮
export async function addToHome() {
  if (S.installEvt) {
    const e = S.installEvt;
    e.prompt();
    const r = await e.userChoice.catch(() => null);
    S.installEvt = null;
    if (r && r.outcome === "accepted") { done(); return; }
    // 点了取消：也给他看手动的办法
  }
  sheetGuide();
}

function sheetGuide() {
  const id = detect();
  if (id === "wechat" || id === "inapp") { sheetInApp(id); return; }
  const g = guide(id);
  const noEdge = isIOS || isNext || !isAndroid || id === "edge" || id === "chrome" || id === "samsung";
  const body = openSheet(T("添加到桌面"), `
    <p class="note">${T("你用的是：{name}", { name: `<b>${esc(g.name)}</b>` })}</p>
    <ol class="steps big">${g.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    ${g.alt.length ? `<p class="sub">${T("找不到的话")}</p><ul class="steps">${g.alt.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <p class="note">${T("添加后桌面上没有图标：打开手机“设置” → “应用” → 找到这个浏览器 → “权限”，把“桌面快捷方式”或“创建桌面图标”打开，再添加一次。")}</p>
    <div class="actions"><button class="btn primary" id="igDone">${T("已经添加好了")}</button></div>
    <p class="sub">${T("这个浏览器确实没有这个功能？")}</p>
    ${noEdge ? "" : `<p class="note">${T("可以装一个 Edge 浏览器（国内应用商店能搜到），用它打开本软件再添加，最稳。")}</p>
      <div class="row"><button class="btn" id="igEdge">${T("去应用商店下载 Edge")}</button><button class="btn" id="igCopy">${T("复制本软件链接")}</button></div>
      <p class="note">${T("装好后打开 Edge，把复制的链接粘贴到地址栏打开，共享路段会一起带过去。")}</p>`}
    <p class="note">${T("不想装新浏览器：在浏览器的设置里，把“主页”设成本软件的网址，以后打开浏览器就直接进来。")}</p>
    ${noEdge ? `<div class="actions"><button class="btn" id="igCopy">${T("复制本软件链接")}</button></div>` : ""}`);
  body.querySelector("#igDone").addEventListener("click", () => { done(); closeSheet(); });
  body.querySelector("#igEdge")?.addEventListener("click", openEdgeStore);
  body.querySelector("#igCopy").addEventListener("click", copyLink);
}

function sheetInApp(id) {
  const body = openSheet(T("添加到桌面"), `
    <div class="inapp-tip" aria-hidden="true">↗</div>
    <p class="big-tip">${T(id === "wechat" ? "现在是在微信里打开的，微信里不能添加到桌面。" : "现在是在聊天软件里打开的，这里不能添加到桌面。")}</p>
    <ol class="steps big">
      <li>${T("点右上角的“⋯”")}</li>
      <li>${T("选“在浏览器打开”（或“用默认浏览器打开”）")}</li>
      <li>${T("在浏览器里再点一次“更多” → “添加到桌面”")}</li>
    </ol>
    <p class="note">${T("没有“在浏览器打开”：点下面复制链接，自己打开手机浏览器，粘贴到地址栏。")}</p>
    <div class="actions"><button class="btn" id="igCopy">${T("复制本软件链接")}</button></div>`);
  body.querySelector("#igCopy").addEventListener("click", copyLink);
}

/* ---------- 提示条 ---------- */
function done() { prefs.set("installed", true); $("installBar").hidden = true; }
export const showInstall = () => !standalone();

function initBar() {
  const bar = $("installBar");
  if (standalone() || prefs.get("installed", false) || prefs.get("installHide", false)) return;
  bar.hidden = false;
  $("installGo").addEventListener("click", addToHome);
  $("installX").addEventListener("click", () => { prefs.set("installHide", true); bar.hidden = true; toast(T("以后可以在“更多”里找到“添加到桌面”")); });
}
window.addEventListener("appinstalled", () => { done(); toast(T("已添加到桌面")); });
initBar();
