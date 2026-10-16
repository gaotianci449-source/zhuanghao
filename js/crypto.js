// 加密：共享数据用链接里的钥匙（AES-GCM），上传凭证用上传密码（PBKDF2 推出钥匙）
const enc = new TextEncoder(), dec = new TextDecoder();

export function b64u(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const b = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
  return b;
}
export const newDataKey = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

const aes = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

// 数据 -> [12 字节 iv][密文]
export async function sealData(keyB64, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(unb64u(keyB64)), enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
export async function openData(keyB64, bytes) {
  const b = new Uint8Array(bytes);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, await aes(unb64u(keyB64)), b.subarray(12));
  return JSON.parse(dec.decode(pt));
}

const ITER = 310000;
async function pwKey(password, salt, iter = ITER) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function sealWithPassword(password, obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await pwKey(password, salt), enc.encode(JSON.stringify(obj)));
  return { v: 1, iter: ITER, salt: b64u(salt), iv: b64u(iv), ct: b64u(ct) };
}
// 密码不对时抛出错误
export async function openWithPassword(password, box) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(box.iv) }, await pwKey(password, unb64u(box.salt), box.iter || ITER), unb64u(box.ct));
  return JSON.parse(dec.decode(pt));
}
