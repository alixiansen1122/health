import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production page replaces the temporary starter", async () => {
  const [page, layout, loading, css, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/loading.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /健康与运动/);
  assert.match(page, /WeightChart/);
  assert.match(page, /ExpensePage/);
  assert.match(page, /ExerciseList/);
  assert.match(page, /plan-day/);
  assert.match(page, /全年查看/);
  assert.match(layout, /健康与运动/);
  assert.match(loading, /正在切换/);
  assert.match(css, /--coral/);
  assert.match(css, /html \{ scroll-behavior: auto; \}/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(hosting, /"d1": "DB"/);
});
