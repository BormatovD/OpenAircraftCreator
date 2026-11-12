import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const root = new URL('../web/public/', import.meta.url);
const sitemap = readFileSync(new URL('sitemap.xml', root), 'utf8');
for (const type of ['A20N', 'B752', 'B38M', 'T214', 'A21N']) {
  test(`SEO canonical ${type} links to a real generated static page`, () => {
    const url = `https://aircraft-designer.app/ru/type/${type}/`;
    assert.ok(sitemap.includes(`<loc>${url}</loc>`));
    const html = readFileSync(new URL(`ru/type/${type}/index.html`, root), 'utf8');
    assert.ok(html.includes(`rel="canonical" href="${url}"`));
    assert.ok(html.includes(`flightcost.app/ru/type/${type}`));
    assert.ok(html.includes('не утверждёнными LOPA'));
  });
}
