// DWG：用开源的 LibreDWG（编译成网页版）先转成 DXF。程序约 11 MB，只在第一次导入 DWG 时下载
import { T } from "./i18n.js";

let mod = null;
export async function dwgToDxf(bytes, onStatus = () => {}) {
  if (!mod) {
    onStatus(T("第一次读 DWG，正在下载 CAD 读取程序（约 3～11 MB），网络慢时要等一会儿…"));
    try {
      const createModule = (await import("../vendor/libredwg/libredwg-web.js")).default;
      mod = await createModule();
    } catch (e) {
      mod = null;
      const mem = /memory|Memory|RangeError/.test(String(e));
      throw new Error(mem ? T("这台手机内存不够读 DWG。请在电脑上导入，或者让测量组在 CAD 里“另存为”DXF。")
        : T("CAD 读取程序下载失败，请检查网络后再试，或者把图“另存为”DXF 再导入。"));
    }
  }
  onStatus(T("正在读取 CAD 图…"));
  try {
    mod.FS.writeFile("in.dwg", bytes);
    const err = mod.dwg_write_dxf("in.dwg", "out.dxf");
    let out = null;
    try { out = mod.FS.readFile("out.dxf"); } catch (e) { /* 没有输出 */ }
    if (!out || !out.length) throw new Error("dwg " + err);
    return out;
  } catch (e) {
    throw new Error(T("这张 DWG 读不出来（可能版本太新或文件损坏）。请让测量组在 CAD 里“另存为”DXF 再导入。"));
  } finally {
    for (const f of ["in.dwg", "out.dxf"]) { try { mod.FS.unlink(f); } catch (e) { /* 忽略 */ } }
  }
}
