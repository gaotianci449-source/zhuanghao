// 数据保存在本机浏览器（IndexedDB），不上传：路段、轨迹、测量图形
const DB = "zhuanghao";
const STORES = ["roads", "tracks", "shapes"];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(name, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(name, mode);
    const r = fn(t.objectStore(name));
    t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

function table(name) {
  return {
    all: () => tx(name, "readonly", (s) => s.getAll()).then((a) => (a || []).sort((x, y) => (x.order ?? 0) - (y.order ?? 0))),
    put: (obj) => tx(name, "readwrite", (s) => s.put(obj)),
    remove: (id) => tx(name, "readwrite", (s) => s.delete(id)),
    clear: () => tx(name, "readwrite", (s) => s.clear()),
  };
}

export const store = table("roads");
export const tracksDB = table("tracks");
export const shapesDB = table("shapes");

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 尽量让浏览器长期保留数据（清理空间时不优先删除）
export async function askPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* 忽略 */ }
  return false;
}

export const prefs = {
  get(k, d) { try { const v = localStorage.getItem("zh." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("zh." + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
};
