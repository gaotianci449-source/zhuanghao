// 路段保存在本机浏览器（IndexedDB），不上传
const DB = "zhuanghao", STORE = "roads";
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const r = fn(s);
    t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export const store = {
  all: () => tx("readonly", (s) => s.getAll()).then((a) => (a || []).sort((x, y) => (x.order ?? 0) - (y.order ?? 0))),
  put: (road) => tx("readwrite", (s) => s.put(road)),
  remove: (id) => tx("readwrite", (s) => s.delete(id)),
  clear: () => tx("readwrite", (s) => s.clear()),
};

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
