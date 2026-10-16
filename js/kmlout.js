// 导出 KML：奥维、Google 地球都能打开
import { shareFile, ymd } from "./ui.js";

const x = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// #RRGGBB -> KML 的 aabbggrr
const kc = (hex, a = "ff") => a + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);

// items: [{ name, color, pts: [[lat, lon]...], closed, desc }]
export function toKML(title, items) {
  const pm = items.map((it, i) => {
    const c = it.pts.map((p) => `${p[1].toFixed(8)},${p[0].toFixed(8)},0`);
    if (it.closed && it.pts.length >= 3) c.push(c[0]);
    const geom = it.closed && it.pts.length >= 3
      ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${c.join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
      : `<LineString><tessellate>1</tessellate><coordinates>${c.join(" ")}</coordinates></LineString>`;
    return `<Style id="s${i}"><LineStyle><color>${kc(it.color)}</color><width>3</width></LineStyle><PolyStyle><color>${kc(it.color, "40")}</color></PolyStyle></Style>
<Placemark><name>${x(it.name)}</name>${it.desc ? `<description>${x(it.desc)}</description>` : ""}<styleUrl>#s${i}</styleUrl>${geom}</Placemark>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(title)}</name>
${pm}
</Document></kml>`;
}

export function shareKML(name, items) {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  return shareFile(`${safe}-${ymd()}.kml`, new Blob([toKML(name, items)], { type: "application/vnd.google-earth.kml+xml" }));
}
