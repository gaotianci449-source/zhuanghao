// 启动：把各部分接起来
import { applyStatic, missing } from "./i18n.js";
import { S, hooks } from "./state.js";
import { prefs } from "./store.js";
import { map } from "./map.js";
import { startGPS, update } from "./gps.js";
import { $, closeSheet } from "./ui.js";
import { loadRoads, sheetRoads, sheetLegend } from "./roads.js";
import { sheetFind } from "./find.js";
import { loadTracks, sheetTracks } from "./tracks.js";
import { loadShapes, sheetMeasure } from "./measure.js";
import { sheetMore } from "./more.js";
import { setReload } from "./backup.js";

applyStatic();

const SHEETS = { find: sheetFind, roads: sheetRoads, tracks: sheetTracks, measure: sheetMeasure, more: sheetMore };
document.querySelectorAll(".bar [data-sheet]").forEach((b) => b.addEventListener("click", () => SHEETS[b.dataset.sheet]()));
$("roadChip").addEventListener("click", sheetLegend);
$("sheetClose").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

const loadAll = async () => { await loadRoads(); await loadTracks(); await loadShapes(); };
setReload(loadAll);

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; });
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // 有新版本接管页面时自动刷新一次，避免继续用旧版（正在记录轨迹时不刷新）
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloaded && !S.rec && !S.measure) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
}

loadAll().then(async () => {
  let granted = false;
  try { granted = (await navigator.permissions.query({ name: "geolocation" })).state === "granted"; } catch (e) { granted = prefs.get("gps", false); }
  if (granted) startGPS();
  update();
});
window.__zh = { S, map, hooks, loadAll, update, missing }; // 调试用
