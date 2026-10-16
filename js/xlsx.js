// 读取 Excel（.xlsx）：只取每个工作表里单元格的文字和数字，不管格式和公式
import { T } from "./i18n.js";

function xml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(T("Excel 文件内容读不出来，可能已损坏。"));
  return doc;
}
const tags = (el, name) => [...el.getElementsByTagNameNS("*", name)];
const colIndex = (ref) => {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
// Excel 里存的小数常有 1208345.1229999999 这样的尾巴，保留到 0.0001
function num(v) {
  const x = Number(v);
  if (!isFinite(x)) return v;
  return String(Math.round(x * 10000) / 10000);
}

// 返回 [{ name, rows: [[文字...]...] }]，空工作表也会列出
export async function readXlsx(zip) {
  const wbText = await zip.text("xl/workbook.xml");
  if (!wbText) throw new Error(T("这个压缩文件不是 Excel 表格。"));
  const wb = xml(wbText);
  const relText = await zip.text("xl/_rels/workbook.xml.rels");
  const rels = {};
  if (relText) for (const r of tags(xml(relText), "Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");

  const shared = [];
  const ssText = await zip.text("xl/sharedStrings.xml");
  if (ssText) for (const si of tags(xml(ssText), "si")) shared.push(tags(si, "t").map((t) => t.textContent).join(""));

  const sheets = [];
  for (const s of tags(wb, "sheet")) {
    const rid = s.getAttribute("r:id") || [...s.attributes].find((a) => a.localName === "id")?.value;
    let target = rels[rid] || "";
    target = target.replace(/^\/?xl\//, "").replace(/^\//, "");
    const path = "xl/" + target;
    const text = zip.has(path) ? await zip.text(path) : null;
    sheets.push({ name: s.getAttribute("name") || "", rows: text ? sheetRows(xml(text), shared) : [] });
  }
  return sheets;
}

function sheetRows(doc, shared) {
  const rows = [];
  for (const row of tags(doc, "row")) {
    const out = [];
    let next = 0;
    for (const c of [...row.children].filter((x) => x.localName === "c")) {
      let i = colIndex(c.getAttribute("r"));
      if (i < 0) i = next;
      next = i + 1;
      const t = c.getAttribute("t");
      const vEl = [...c.children].find((x) => x.localName === "v");
      let v = "";
      if (t === "s") v = vEl ? shared[+vEl.textContent] ?? "" : "";
      else if (t === "inlineStr") v = tags(c, "t").map((x) => x.textContent).join("");
      else if (t === "str" || t === "e" || t === "b") v = vEl ? vEl.textContent : "";
      else v = vEl ? num(vEl.textContent) : "";
      while (out.length < i) out.push("");
      out[i] = String(v).trim();
    }
    if (out.some((x) => x !== "")) rows.push(out);
  }
  return rows;
}
