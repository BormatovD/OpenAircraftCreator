/** Deterministic SSR type landing pages and sitemap for Caddy's static file_server. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(resolve(root, 'web/public/aircraft-configurations.v1.json'), 'utf8'));
const supported = new Map();
for (const p of data.aircraft) {
  if (!supported.has(p.icao)) supported.set(p.icao, []);
  supported.get(p.icao).push(p);
}
const escapeHtml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"','&quot;');
const routes = ['https://aircraft-designer.app/'];
for (const [icao, configs] of [...supported].sort(([a],[b]) => a.localeCompare(b))) {
  const dest = `https://aircraft-designer.app/ru/type/${icao}/`;
  routes.push(dest);
  const link = (p, l) => `/?ac=${encodeURIComponent(p.icao)}&engine=${encodeURIComponent(p.engine)}&aircraft=${encodeURIComponent(p.aircraftId)}&layout=${encodeURIComponent(l.id)}`;
  const seatCount = (layout) => layout.zones.reduce((n,z) => n + (z.rows-1)*z.seatsPerRow+(z.lastRowSeats??z.seatsPerRow),0);
  const desc = `${icao} — интерактивный инженерный конструктор самолёта. Поворот 3D-модели, выбор варианта двигателя и схемы салона, расчёт массы и ограничений.`;
  const items = configs.flatMap((p) => p.layouts.map((l) => `<li><a href="${escapeHtml(link(p,l))}">${escapeHtml(p.engine)} · ${escapeHtml(l.label)} · ${seatCount(l)} мест</a></li>`)).join('\n');
  const page = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(icao)} — 3D-модель и компоновки | Aircraft Designer</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${dest}"><meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(icao)} — Aircraft Designer"><meta property="og:url" content="${dest}">
<style>body{margin:0;background:#142230;color:#dbe4ea;font:16px/1.65 system-ui,sans-serif}main{max-width:800px;margin:8vh auto;padding:0 20px}h1{line-height:1.2}a{color:#b9d875}li{padding:8px 0}aside{padding:12px 18px;border-left:3px solid #a9c95a;background:#1a2b3a}footer{margin-top:30px}</style>
<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'SoftwareApplication','name':`Aircraft Designer — ${icao}`,'applicationCategory':'DesignApplication','operatingSystem':'Web','url':dest,'description':desc})}</script>
</head><body><main><a href="/">Aircraft Designer</a><h1>${escapeHtml(icao)} — 3D-модель самолёта</h1><p>${escapeHtml(desc)}</p><h2>Доступные варианты</h2><ul>${items}</ul>
<aside>Компоновки салона являются плановыми пресетами инженерной модели, а не утверждёнными LOPA эксплуатантов. Числа расчёта не заменяют сертифицированные характеристики.</aside>
<footer><p><a href="https://flightcost.app/ru/type/${encodeURIComponent(icao)}">Паспорт и экономика ${escapeHtml(icao)} на FlightCost</a></p></footer>
</main></body></html>\n`;
  const path = resolve(root,`web/public/ru/type/${icao}/index.html`);
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,page);
}
writeFileSync(resolve(root,'web/public/sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+routes.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')+'\n</urlset>\n');
writeFileSync(resolve(root,'web/public/robots.txt'),'User-agent: *\nAllow: /\nSitemap: https://aircraft-designer.app/sitemap.xml\n');
console.log(`SEO: ${supported.size} type pages, ${routes.length} sitemap entries`);
