// 共享数据：管理员发布到 GitHub 仓库（加密），所有人打开工具时自动下载
// 钥匙在管理员发的链接里（#k=...），只存在各人手机上，不在代码里
import { sealData, openData, sealWithPassword, openWithPassword, newDataKey } from "./crypto.js";
import { meta, prefs } from "./store.js";
import { S } from "./state.js";
import { T } from "./i18n.js";

const DATA = "data/shared.enc", BOX = "data/keybox.json";

export function repoInfo() {
  const h = location.hostname;
  if (h.endsWith(".github.io")) return { owner: h.split(".")[0], repo: location.pathname.split("/")[1] || "" };
  return { owner: "gaotianci449-source", repo: "zhuanghao" };
}

// 打开带 #k=... 的链接时记下钥匙，并从地址栏里去掉（避免截图、转发时泄露）
export function captureKey() {
  const m = /[#&]k=([A-Za-z0-9_-]{40,})/.exec(location.hash);
  if (m) {
    prefs.set("dk", m[1]);
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  return false;
}
export const dataKey = () => prefs.get("dk", null);
export const shareLink = (dk = dataKey()) => `${location.origin}${location.pathname}#k=${dk}`;

const empty = () => ({ app: "zhuanghao", v: 1, updated: null, roads: [], marks: [] });

// 读取共享数据：有未发布的草稿时用草稿；否则联网取最新的，取不到用上次缓存
// net=false 时只读缓存（启动时先显示，不等网络）
export async function loadShared(net = true) {
  const draft = await meta.get("draft");
  if (draft) { S.shared = { ...draft, dirty: true }; S.sharedState = "draft"; return S.shared; }
  const dk = dataKey();
  let data = (await meta.get("shared")) || null;
  // 这次取数据的结果：ok 新的 / cached 网慢用了上次的 / offline 没网 / badkey 钥匙不对 / none 还没发布 / nokey 没钥匙
  let state = dk ? (net ? "offline" : "cached") : "nokey";
  if (dk && net) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(DATA + "?t=" + Date.now(), { cache: "no-store", signal: ctl.signal });
      clearTimeout(tm);
      if (res.status === 404) state = "none";
      else if (res.ok) {
        const buf = await res.arrayBuffer();
        try {
          const fresh = await openData(dk, buf);
          if (fresh && fresh.app === "zhuanghao") { data = fresh; await meta.set("shared", fresh); state = res.headers.get("x-zh-cache") ? "cached" : "ok"; }
        } catch (e) { state = "badkey"; }
      }
    } catch (e) { /* 没网：用缓存 */ }
  }
  S.shared = { ...(data || empty()), dirty: false };
  S.sharedState = state;
  return S.shared;
}

// 从粘贴的文字里找出钥匙：整条链接（…#k=xxx）或者只有钥匙本身
export function keyFromText(text) {
  const t = String(text || "").trim();
  const m = /[#&?]k=([A-Za-z0-9_-]{40,})/.exec(t) || /^([A-Za-z0-9_-]{40,})$/.exec(t);
  return m ? m[1] : null;
}
export function setDataKey(k) { prefs.set("dk", k); }

// 管理员修改：先存成草稿，发布后清掉
export async function saveDraft(data) {
  const d = { ...data, app: "zhuanghao", v: 1 };
  delete d.dirty;
  await meta.set("draft", d);
  S.shared = { ...d, dirty: true };
}
export async function discardDraft() { await meta.remove("draft"); return loadShared(); }

/* ---------- GitHub ---------- */
async function gh(token, path, opts = {}) {
  const { owner, repo } = repoInfo();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  return res;
}
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function putFile(token, path, bytes, message) {
  let sha;
  const cur = await gh(token, `/contents/${path}`);
  if (cur.ok) sha = (await cur.json()).sha;
  else if (cur.status !== 404) throw ghError(cur.status);
  const res = await gh(token, `/contents/${path}`, { method: "PUT", body: JSON.stringify({ message, content: b64(bytes), ...(sha ? { sha } : {}) }) });
  if (!res.ok) throw ghError(res.status);
}
function ghError(status) {
  if (status === 401) return new Error(T("GitHub 凭证无效或已过期。请生成新的凭证，在“数据管理”里点“重新设置”。"));
  if (status === 403 || status === 404) return new Error(T("这个凭证没有写入仓库的权限。生成凭证时要选中这个仓库，并把“Contents”设为“Read and write”。"));
  if (status === 409 || status === 422) return new Error(T("仓库里的文件刚被别人改过，请再点一次发布。"));
  return new Error(T("GitHub 返回错误（{s}），请稍后再试。", { s: status }));
}

export async function fetchKeybox() {
  try {
    const res = await fetch(BOX + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return undefined; } // 没网
}

// 输入上传密码，解开凭证和数据钥匙；密码不对返回 null
export async function unlock(password) {
  const box = await fetchKeybox();
  if (box === undefined) throw new Error(T("没有网络，连不上服务器。"));
  if (!box) return null;
  try {
    const c = await openWithPassword(password, box);
    if (c.dk && !dataKey()) prefs.set("dk", c.dk);
    return c;
  } catch (e) { return null; }
}

// 首次设置：检查凭证，生成数据钥匙，用上传密码锁好后写进仓库
export async function setup(token, password) {
  token = token.trim();
  let res;
  try { res = await gh(token, ""); } catch (e) { throw new Error(T("没有网络，连不上 GitHub。")); }
  if (res.status === 401) throw ghError(401);
  if (!res.ok) throw ghError(404);
  const info = await res.json();
  if (info.permissions && !info.permissions.push) throw ghError(403);
  const dk = dataKey() || newDataKey();
  const box = await sealWithPassword(password, { token, dk });
  await putFile(token, BOX, new TextEncoder().encode(JSON.stringify(box)), "设置上传密码");
  prefs.set("dk", dk);
  return { token, dk };
}

export async function publish(creds, data) {
  const out = { ...data, app: "zhuanghao", v: 1, updated: new Date().toISOString() };
  delete out.dirty;
  const bytes = await sealData(creds.dk, out);
  await putFile(creds.token, DATA, bytes, "发布共享数据");
  await meta.set("shared", out);
  await meta.remove("draft");
  S.shared = { ...out, dirty: false };
}
