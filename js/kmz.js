// KMZ 是压缩包：找出里面的 .kml 并解压（用浏览器自带的解压能力）
export async function readKMZ(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  // 找中央目录结尾
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("这个 KMZ 文件已损坏。");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    entries.push({ name, method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  const e = entries.find((x) => /\.kml$/i.test(x.name));
  if (!e) throw new Error("KMZ 里没有找到 KML 文件。");
  const lh = e.local;
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const data = buf.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = data;
  else if (e.method === 8) {
    if (typeof DecompressionStream === "undefined") throw new Error("这个浏览器不能解压 KMZ，请在奥维里导出成 KML 再导入。");
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    out = new Uint8Array(await new Response(ds).arrayBuffer());
  } else throw new Error("这个 KMZ 的压缩方式不支持，请导出成 KML。");
  return new TextDecoder("utf-8").decode(out);
}
