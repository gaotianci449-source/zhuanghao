// 全局状态，以及各模块之间互相调用的入口（避免循环引用）
import { prefs } from "./store.js";

export const VERSION = "3.3";

export const S = {
  roads: [], tracks: [], shapes: [], marks: [],
  shared: null,    // 共享数据 { roads, marks, updated, dirty }
  lock: prefs.get("lock", null),
  maxOff: prefs.get("maxOff", 300),
  base: prefs.get("base", "esri"),
  me: null, watchId: null, follow: false,
  find: null, last: null, installEvt: null,
  rec: null,       // 正在记录的轨迹
  measure: null,   // 正在进行的测量
};

// 由各模块在启动时填上
export const hooks = {
  update() {}, drawRoads() {}, drawOverlays() {}, setFollow() {}, startGPS() {}, updateWake() {},
  sheetMarks() {}, nearText: () => "",
  onPos: [],       // 每次定位更新时调用
  onMapClick: null // 测量时接管地图点击
};
