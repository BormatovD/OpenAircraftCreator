import assert from "node:assert/strict";
import { test } from "node:test";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { renderMethod } from "../web/method.ts";

for (const [id, definition] of Object.entries(AIRCRAFT)) {
  test(`Методика ${id}: все численные подстановки доступны`, (t) => {
    const errors = t.mock.method(console, "error", () => {});
    const html = renderMethod(evaluate(definition, [], contextFor(definition)));
    assert.equal(errors.mock.callCount(), 0, "KaTeX не должен отклонять формулы");
    assert.doesNotMatch(html, /math-render-fallback|katex-error/);

    // Проверяем каждую подстановку, чтобы её удаление не маскировало сбой рендера.
    const substitutions = [...html.matchAll(/<div class="subst">([\s\S]*?)<\/div>/g)];
    assert.equal(substitutions.length, 13);
    for (const [, substitution] of substitutions) {
      assert.match(substitution, /<math[\s>]/);
    }

    if (id === "a320ceo") {
      // Регрессия: старый форматтер превращал 4 392 в невалидное 4\\{,}392.
      assert.ok(html.includes(String.raw`W^R_{\mathrm{box}} = 4\,392\,\mathrm{kg},\quad W^R_{\mathrm{flaps}} = 964\,\mathrm{kg}`));
      assert.ok(html.includes(String.raw`OEW = 41\,244\,\mathrm{kg}`));
      assert.doesNotMatch(html, /\\\{,\}/);
    }
  });
}
