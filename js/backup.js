// 备份：路段、轨迹、测量图形一起导出成一个文件；恢复时只加入手机里没有的
import { store, tracksDB, shapesDB } from "./store.js";
import { S, hooks } from "./state.js";
import { $, toast, closeSheet, shareFile, ymd } from "./ui.js";
import { T } from "./i18n.js";

let reload = async () => {};
export function setReload(fn) { reload = fn; }

export async function exportBackup(plainRoad) {
  if (!S.roads.length && !S.tracks.length && !S.shapes.length) { toast(T("还没有数据可以备份")); return; }
  const data = { app: "zhuanghao", version: 2, exported: new Date().toISOString(), roads: S.roads.map(plainRoad), tracks: S.tracks, shapes: S.shapes };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  await shareFile(`${T("桩号备份")}-${ymd()}.json`, blob);
}

export async function restoreData(data) {
  if (!data || data.app !== "zhuanghao" || !Array.isArray(data.roads)) throw new Error(T("这个文件不是桩号工具的备份。"));
  let n = 0, m = 0;
  const haveR = new Set(S.roads.map((r) => r.id));
  for (const r of data.roads) {
    if (!r.id || !Array.isArray(r.pts) || !Array.isArray(r.cal) || haveR.has(r.id)) continue;
    await store.put(r); n++;
  }
  const haveT = new Set(S.tracks.map((x) => x.id)), haveS = new Set(S.shapes.map((x) => x.id));
  for (const t of data.tracks || []) if (t.id && Array.isArray(t.pts) && !haveT.has(t.id)) { await tracksDB.put({ ...t, recording: false }); m++; }
  for (const s of data.shapes || []) if (s.id && Array.isArray(s.pts) && !haveS.has(s.id)) { await shapesDB.put(s); m++; }
  await reload();
  closeSheet();
  toast(n || m ? T("已恢复 {n} 条路段，{m} 条轨迹和测量", { n, m }) : T("这些数据手机里已经有了"));
}

$("fileBackup").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  let data = null;
  try { data = JSON.parse(await f.text()); } catch (err) { toast(T("这个文件不是桩号工具的备份。")); return; }
  try { await restoreData(data); } catch (err) { toast(err.message); }
  hooks.update();
});
