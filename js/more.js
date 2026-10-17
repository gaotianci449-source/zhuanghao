// 更多：底图、显示范围、语言、备份、添加到桌面、说明
import { S, hooks, VERSION } from "./state.js";
import { prefs } from "./store.js";
import { setBase } from "./map.js";
import { $, openSheet, closeSheet, toast } from "./ui.js";
import { exportBackup } from "./backup.js";
import { plainRoad } from "./roads.js";
import { T, lang, setLang } from "./i18n.js";
import { setRef } from "./map.js";
import { sheetAdmin, sharedStatus } from "./admin.js";
import { loadShared, keyFromText, setDataKey, dataKey } from "./shared.js";

export function setSimple(on) {
  prefs.set("simple", on);
  document.body.classList.toggle("simple", on);
}

export function sheetMore() {
  const body = openSheet(T("更多"), `
    <div class="result ok" id="mStatus"><p>${sharedStatus()}</p>
      <div class="actions"><button class="btn" id="mRefresh">${T("刷新")}</button></div>
    </div>
    <div class="field" id="mKeyBox" ${dataKey() && S.sharedState !== "badkey" ? "hidden" : ""}><span>${T("粘贴管理员发的链接")}</span>
      <div class="row"><input id="mKey" placeholder="https://…#k=…" autocomplete="off"><button class="btn small" id="mKeyGo">${T("连接")}</button></div>
      <p class="note">${T("在微信里长按链接，选“复制”，再粘贴到这里。")}</p>
    </div>
    ${dataKey() && S.sharedState !== "badkey" ? `<p class="note"><button class="link" id="mKeyShow">${T("换一个共享链接")}</button></p>` : ""}
    <label class="check big"><input type="checkbox" id="mSimple" ${prefs.get("simple", false) ? "checked" : ""}> ${T("简单模式：字更大，只留常用按钮")}</label>
    <div class="field"><span>${T("底图")}</span>
      <div class="seg" role="radiogroup">
        ${[["esri", "卫星影像"], ["osm", "道路图"], ["none", "不显示"]].map(([k, t]) => `<button type="button" role="radio" data-base="${k}" aria-checked="${S.base === k}">${T(t)}</button>`).join("")}
      </div>
      <label class="check"><input type="checkbox" id="mRef" ${prefs.get("ref", true) ? "checked" : ""}> ${T("在影像上显示路网和地名")}</label>
    </div>
    <div class="field"><span>语言 · Langue</span>
      <div class="seg" role="radiogroup">
        <button type="button" role="radio" data-lang="zh" aria-checked="${lang === "zh"}">中文</button>
        <button type="button" role="radio" data-lang="fr" aria-checked="${lang === "fr"}">Français</button>
      </div>
    </div>
    <label class="field"><span>${T("离中线多远以内才显示桩号")}</span><select id="mMax">
      ${[100, 200, 300, 500, 1000, 2000].map((v) => `<option value="${v}" ${v === S.maxOff ? "selected" : ""}>${v} ${T("米")}</option>`).join("")}
    </select></label>
    <div class="field"><span>${T("数据管理")}</span>
      <button class="btn" id="mAdmin">${T("发布共享路段和地标（需要密码）")}</button>
    </div>
    <div class="field"><span>${T("备份")}</span>
      <div class="row"><button class="btn" id="mExport">${T("导出备份")}</button><button class="btn" id="mImport">${T("恢复备份")}</button></div>
    </div>
    <p class="note">${T("路段、轨迹和测量只保存在这台手机的浏览器里。清理浏览器数据会把它们删掉，换手机前请先导出备份。备份文件也可以发给同事，对方点“恢复备份”就能用同样的路段。")}</p>
    <button class="btn" id="mInstall" ${S.installEvt ? "" : "hidden"}>${T("添加到手机桌面")}</button>
    <p class="note">${S.installEvt ? "" : T("想像软件一样从桌面打开：安卓 Chrome 点右上角菜单，选“添加到主屏幕”；苹果 Safari 点分享按钮，选“添加到主屏幕”。")}</p>
    <p class="note">${T("桩号由手机定位换算，误差一般 3～5 米，只用来知道自己在哪，不能用于放样。影像来自 Esri，放大到 17 级以上会变模糊。")} ${T("版本")} ${VERSION}</p>`);
  body.querySelectorAll("[data-base]").forEach((b) => b.addEventListener("click", () => {
    setBase(b.dataset.base);
    body.querySelectorAll("[data-base]").forEach((x) => x.setAttribute("aria-checked", x === b));
  }));
  body.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    if (S.rec || S.measure) { toast(T("正在记录轨迹或测量，结束后再切换语言。")); return; }
    setLang(b.dataset.lang);
    location.reload(); // 重新载入，所有文字一次换好
  }));
  body.querySelector("#mRefresh").addEventListener("click", (e) => refresh(e.currentTarget));
  body.querySelector("#mKeyShow")?.addEventListener("click", (e) => { body.querySelector("#mKeyBox").hidden = false; e.currentTarget.hidden = true; body.querySelector("#mKey").focus(); });
  body.querySelector("#mKeyGo").addEventListener("click", async (e) => {
    const k = keyFromText(body.querySelector("#mKey").value);
    if (!k) { toast(T("这不是共享链接。链接里应该有 #k= 这一段。")); return; }
    const old = dataKey();
    setDataKey(k);
    const btn = e.currentTarget; btn.disabled = true;
    await loadShared(true); await hooks.loadAll();
    btn.disabled = false;
    if (S.sharedState === "badkey") {
      if (old) { setDataKey(old); await loadShared(true); await hooks.loadAll(); }
      toast(T("这个链接打不开现在的共享数据，可能是旧链接。")); return;
    }
    if (S.sharedState === "offline") toast(T("已记住链接。现在没网，有网后点“刷新”。"));
    else toast(T("已连上：{n} 条共享路段", { n: S.shared.roads.length }));
    sheetMore();
  });
  body.querySelector("#mRef").addEventListener("change", (e) => setRef(e.target.checked));
  body.querySelector("#mSimple").addEventListener("change", (e) => setSimple(e.target.checked));
  body.querySelector("#mAdmin").addEventListener("click", sheetAdmin);
  body.querySelector("#mMax").addEventListener("change", (e) => { S.maxOff = +e.target.value; prefs.set("maxOff", S.maxOff); hooks.update(); });
  body.querySelector("#mExport").addEventListener("click", () => exportBackup(plainRoad));
  body.querySelector("#mImport").addEventListener("click", () => $("fileBackup").click());
  body.querySelector("#mInstall").addEventListener("click", async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; closeSheet();
  });
}

// 刷新：重新下载共享数据，同时检查程序有没有新版本（有的话会自动换上）
export async function refresh(btn) {
  if (btn) { btn.disabled = true; btn.textContent = T("正在刷新…"); }
  let updating = false;
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.update(); updating = !!(reg.installing || reg.waiting); }
  } catch (e) { /* 没网 */ }
  await loadShared(true);
  await hooks.loadAll();
  const st = S.sharedState;
  if (updating) toast(T("发现新版本，马上自动更新…"), 5000);
  else if (st === "draft") toast(T("你有修改还没发布，显示的是你手机上的版本。"));
  else if (st === "offline") toast(T("没有网络，显示的是上次下载的数据。"));
  else if (st === "cached") toast(T("网络太慢，显示的是上次下载的数据，等会儿再试。"));
  else if (st === "nokey") toast(T("程序已是最新。还没有连上共享数据。"));
  else if (st === "badkey") toast(T("链接里的钥匙对不上，请向管理员要最新的链接。"));
  else toast(T("已是最新：{n} 条共享路段", { n: S.shared.roads.length }));
  if (btn && document.body.contains(btn)) sheetMore();
}
