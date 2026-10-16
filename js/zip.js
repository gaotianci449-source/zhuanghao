// 读取 zip 压缩包（KMZ、XLSX 都是 zip）：列出文件名，按需解压（用浏览器自带的解压能力）
import { T } from "./i18n.js";

export function isZip(buf) {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

export function openZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(T("这个压缩文件已损坏，或者没有传完整。"));
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { name, method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    has: (n) => entries.has(n),
    async read(n) {
      const e = entries.get(n);
      if (!e) return null;
      const lh = e.local;
      const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method !== 8) throw new Error(T("这个压缩文件的格式不支持。"));
      if (typeof DecompressionStream === "undefined") throw new Error(T("这个浏览器太旧，不能解压文件。请用最新的 Chrome 打开。"));
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    },
    async text(n) { const b = await this.read(n); return b == null ? null : new TextDecoder("utf-8").decode(b); },
  };
}

export async function readKMZ(zip) {
  const n = zip.names.find((x) => /\.kml$/i.test(x));
  if (!n) throw new Error(T("KMZ 里没有找到 KML 文件。"));
  return zip.text(n);
}
