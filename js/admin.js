// 数据管理（更多 → 数据管理）：输入上传密码后，导入、整理共享的路段和地标，发布给所有人
import { formatCh } from "./geo.js";
import { store, marksDB, prefs } from "./store.js";
import { S, hooks } from "./state.js";
import { esc, toast, openSheet, closeSheet, confirmTwice, colorPicker, bindColors, dateText } from "./ui.js";
import { plainRoad, pickRoadFile } from "./roads.js";
import { sheetAddMark, TYPES } from "./marks.js";
import { fetchKeybox, unlock, setup, publish, saveDraft, discardDraft, shareLink, dataKey, loadShared } from "./shared.js";
import { T } from "./i18n.js";

let creds = null, credsAt = 0;
const KEEP = 10 * 60 * 1000; // 输对密码后 10 分钟内不用重新输入

export async function sheetAdmin() {
  if (creds && Date.now() - credsAt < KEEP) { panel(); return; }
  creds = null;
  openSheet(T("数据管理"), `<p class="note">${T("正在连接…")}</p>`);
  const box = await fetchKeybox();
  if (box === undefined) { openSheet(T("数据管理"), `<p class="err">${T("没有网络，连不上服务器。")}</p>`); return; }
  if (!box) { sheetSetup(true); return; }
  const body = openSheet(T("数据管理"), `
    <p class="note">${T("这里可以把路段和地标发布给所有人。为了防止误操作，需要输入上传密码。")}</p>
    <label class="field"><span>${T("上传密码")}</span><input id="adPw" type="password" autocomplete="current-password"></label>
    <div class="actions"><button class="btn primary" id="adGo">${T("进入")}</button></div>
    <p class="note"><button class="link" id="adReset">${T("凭证过期或忘记密码？重新设置")}</button></p>`);
  const go = async () => {
    const btn = body.querySelector("#adGo");
    btn.disabled = true; btn.textContent = T("正在验证…");
    try {
      const c = await unlock(body.querySelector("#adPw").value);
      if (!c) { toast(T("密码不对")); btn.disabled = false; btn.textContent = T("进入"); return; }
      creds = c; credsAt = Date.now();
      // 换了手机第一次进来：解开钥匙后先把现有的共享数据取下来，免得发布时把别人的覆盖掉
      await loadShared(true); await hooks.loadAll();
      panel();
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = T("进入"); }
  };
  body.querySelector("#adGo").addEventListener("click", go);
  body.querySelector("#adPw").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  body.querySelector("#adReset").addEventListener("click", () => sheetSetup(false));
  setTimeout(() => body.querySelector("#adPw").focus(), 50);
}

// 首次设置 / 重新设置：填 GitHub 凭证和上传密码
function sheetSetup(first) {
  const body = openSheet(first ? T("首次设置") : T("重新设置"), `
    <p class="note">${T("第一次使用需要一个 GitHub 凭证，用来把数据存进网站。只需要设置一次，以后大家只输上传密码。")}</p>
    <ol class="steps">
      <li>${T("用电脑或手机浏览器登录 GitHub，打开：")}<br><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
      <li>${T("名称随便填；有效期选最长；“Repository access”选“Only select repositories”，选中这个仓库。")}</li>
      <li>${T("“Permissions”里找到“Contents”，改成“Read and write”。")}</li>
      <li>${T("点最下面的“Generate token”，复制生成的那串字（github_pat_ 开头），粘贴到下面。")}</li>
    </ol>
    <label class="field"><span>${T("GitHub 凭证")}</span><input id="suTok" type="password" autocomplete="off" placeholder="github_pat_…"></label>
    <label class="field"><span>${T("设置上传密码（至少 6 位）")}</span><input id="suPw" type="password" autocomplete="new-password"></label>
    <label class="field"><span>${T("再输一次上传密码")}</span><input id="suPw2" type="password" autocomplete="new-password"></label>
    <div class="actions"><button class="btn primary" id="suGo">${T("保存设置")}</button></div>
    <p class="note">${T("凭证会用上传密码加密后存进网站，别人看不到。上传密码忘了没法找回，只能重新设置。")}</p>`);
  body.querySelector("#suGo").addEventListener("click", async (e) => {
    const tok = body.querySelector("#suTok").value.trim(), pw = body.querySelector("#suPw").value;
    if (!/^(github_pat_|ghp_)/.test(tok)) { toast(T("凭证格式不对，应该是 github_pat_ 开头的一长串字")); return; }
    if (pw.length < 6) { toast(T("上传密码至少 6 位")); return; }
    if (pw !== body.querySelector("#suPw2").value) { toast(T("两次输入的密码不一样")); return; }
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = T("正在保存…");
    try {
      creds = await setup(tok, pw); credsAt = Date.now();
      toast(T("设置好了"));
      panel();
    } catch (err) { toast(err.message, 6000); btn.disabled = false; btn.textContent = T("保存设置"); }
  });
}

const draftOf = () => {
  const d = structuredClone({ roads: S.shared?.roads || [], marks: S.shared?.marks || [], updated: S.shared?.updated || null });
  return d;
};
async function change(fn) {
  const d = draftOf();
  await fn(d);
  await saveDraft(d);
  await hooks.loadAll();
  panel();
}

function panel() {
  const sh = S.shared || { roads: [], marks: [] };
  const local = S.roads.filter((r) => !r.shared), localMarks = S.marks.filter((m) => !m.shared);
  const typeName = (k) => T((TYPES.find((t) => t[0] === k) || TYPES[TYPES.length - 1])[1]);
  const body = openSheet(T("数据管理"), `
    <div class="result ${sh.dirty ? "live" : "ok"}">
      <p>${T("共享路段 {n} 条，共享地标 {m} 个", { n: sh.roads.length, m: sh.marks.length })}</p>
      <p class="note">${sh.dirty ? T("有修改还没发布，大家还看不到。") : sh.updated ? T("上次发布：{t}", { t: dateText(sh.updated) }) : T("还没有发布过。")}</p>
    </div>
    <div class="actions"><button class="btn primary" id="adPub" ${sh.dirty ? "" : "disabled"}>${T("发布给所有人")}</button></div>
    ${sh.dirty ? `<div class="actions"><button class="btn" id="adUndo">${T("放弃没发布的修改")}</button></div>` : ""}

    <h3 class="sub">${T("共享路段")}</h3>
    ${sh.roads.length ? `<ul class="list">${sh.roads.map((r) => `<li data-id="${r.id}"><span class="swatch line" style="background:${r.color}"></span>
      <div class="meta"><b>${esc(r.name)}</b><small>${esc(T(r.source || ""))}</small></div>
      <button class="btn small" data-act="edit">${T("修改")}</button></li>`).join("")}</ul>` : `<p class="empty">${T("还没有共享路段。")}</p>`}
    <div class="actions"><button class="btn" id="adImport">${T("导入文件到共享")}</button></div>
    ${local.length ? `<p class="note">${T("这台手机自己导入的路段，可以直接加入共享：")}</p><ul class="list">${local.map((r) => `<li data-local="${r.id}"><span class="swatch line" style="background:${r.color}"></span>
      <div class="meta"><b>${esc(r.name)}</b><small>${formatCh(r.chMin)} ～ ${formatCh(r.chMax)}</small></div>
      <button class="btn small" data-act="share">${T("加入共享")}</button></li>`).join("")}</ul>` : ""}

    <h3 class="sub">${T("共享地标")}</h3>
    ${sh.marks.length ? `<ul class="list">${sh.marks.map((m) => `<li data-mid="${m.id}"><span class="swatch" style="border-radius:50%;background:${(TYPES.find((t) => t[0] === m.type) || TYPES[6])[2]}"></span>
      <div class="meta"><b>${esc(m.name)}</b><small>${typeName(m.type)}</small></div>
      <button class="btn small danger" data-act="delmark">${T("删除")}</button></li>`).join("")}</ul>` : `<p class="empty">${T("还没有共享地标。")}</p>`}
    <div class="actions"><button class="btn" id="adMarkHere">${T("在我现在的位置加共享地标")}</button></div>
    ${localMarks.length ? `<p class="note">${T("这台手机自己加的地标，可以直接加入共享：")}</p><ul class="list">${localMarks.map((m) => `<li data-lmid="${m.id}">
      <div class="meta"><b>${esc(m.name)}</b><small>${typeName(m.type)}</small></div>
      <button class="btn small" data-act="sharemark">${T("加入共享")}</button></li>`).join("")}</ul>` : ""}

    <h3 class="sub">${T("发给同事的链接")}</h3>
    <p class="note">${T("同事用这个链接打开一次，以后就能自动看到共享数据。链接里带着解密钥匙，只发给自己人。")}</p>
    <div class="actions"><button class="btn" id="adCopy">${T("复制链接")}</button><button class="btn" id="adShare">${T("发送链接")}</button></div>`);

  body.querySelector("#adPub").addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = T("正在发布…");
    try {
      await publish(creds, S.shared);
      await hooks.loadAll();
      toast(T("已发布。大约 1～10 分钟后，大家重新打开工具就能看到。"), 6000);
      panel();
    } catch (err) { toast(err.message, 6000); btn.disabled = false; btn.textContent = T("发布给所有人"); }
  });
  body.querySelector("#adUndo")?.addEventListener("click", async () => { await discardDraft(); await hooks.loadAll(); panel(); });
  body.querySelector("#adImport").addEventListener("click", () => pickRoadFile(async (obj) => {
    const d = draftOf(); d.roads.push(obj); await saveDraft(d);
  }));
  body.querySelectorAll("li[data-id] [data-act=edit]").forEach((b) => b.addEventListener("click", () => {
    const r = sh.roads.find((x) => x.id === b.closest("li").dataset.id);
    editShared(r);
  }));
  body.querySelectorAll("li[data-local] [data-act=share]").forEach((b) => b.addEventListener("click", () => change(async (d) => {
    const r = S.roads.find((x) => x.id === b.closest("li").dataset.local);
    d.roads.push({ ...plainRoad(r), visible: true });
    await store.remove(r.id);
  })));
  body.querySelectorAll("li[data-mid] [data-act=delmark]").forEach((b) => confirmTwice(b, T("确认删除"), () => change((d) => {
    d.marks = d.marks.filter((m) => m.id !== b.closest("li").dataset.mid);
  })));
  body.querySelectorAll("li[data-lmid] [data-act=sharemark]").forEach((b) => b.addEventListener("click", () => change(async (d) => {
    const m = S.marks.find((x) => x.id === b.closest("li").dataset.lmid);
    const { shared, ...plain } = m;
    d.marks.push(plain);
    await marksDB.remove(m.id);
  })));
  body.querySelector("#adMarkHere").addEventListener("click", () => {
    if (!S.me) { hooks.startGPS(); toast(T("还没有定位，等定位成功后再点。")); return; }
    sheetAddMark(S.me.lat, S.me.lon, async (m) => { const d = draftOf(); d.marks.push(m); await saveDraft(d); await hooks.loadAll(); });
  });
  const link = shareLink(creds?.dk || dataKey());
  body.querySelector("#adCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); toast(T("链接已复制，可以粘贴到微信里发给同事")); }
    catch (e) { prompt(T("复制下面的链接"), link); }
  });
  body.querySelector("#adShare").addEventListener("click", async () => {
    if (navigator.share) { try { await navigator.share({ title: T("桩号工具"), text: T("打开这个链接就能看到我们工地的路段桩号："), url: link }); } catch (e) { /* 取消 */ } }
    else { try { await navigator.clipboard.writeText(link); toast(T("链接已复制，可以粘贴到微信里发给同事")); } catch (e) { /* 忽略 */ } }
  });
}

function editShared(r) {
  let color = r.color;
  const body = openSheet(T("修改共享路段"), `
    <label class="field"><span>${T("名称")}</span><input id="esName" value="${esc(r.name)}" maxlength="40"></label>
    <div class="field"><span>${T("颜色")}</span>${colorPicker(r.color)}</div>
    <div class="actions"><button class="btn" id="esBack">${T("返回")}</button><button class="btn primary" id="esSave">${T("保存")}</button></div>
    <div class="actions"><button class="btn danger" id="esDel">${T("从共享里删除")}</button></div>
    <p class="note">${T("修改后要点“发布给所有人”，大家才看得到。")}</p>`);
  bindColors(body, (c) => { color = c; });
  body.querySelector("#esBack").addEventListener("click", panel);
  body.querySelector("#esSave").addEventListener("click", () => change((d) => {
    const x = d.roads.find((y) => y.id === r.id);
    x.name = body.querySelector("#esName").value.trim() || x.name; x.color = color;
  }));
  confirmTwice(body.querySelector("#esDel"), T("再点一次，确认删除"), () => change((d) => {
    d.roads = d.roads.filter((y) => y.id !== r.id);
    if (S.lock === r.id) { S.lock = null; prefs.set("lock", null); }
  }));
}

// 普通用户在“更多”里看到的共享状态
export function sharedStatus() {
  const sh = S.shared;
  if (!dataKey()) return T("还没有连上共享数据。请用管理员发的链接打开一次。");
  if (!sh || (!sh.roads.length && !sh.marks.length)) return T("已连上共享数据，管理员还没有发布内容。");
  return T("共享数据：{n} 条路段，{m} 个地标{t}", { n: sh.roads.length, m: sh.marks.length, t: sh.updated ? T("（{t} 更新）", { t: dateText(sh.updated) }) : "" });
}
export { closeSheet };
