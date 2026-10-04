import { test } from "node:test";
import assert from "node:assert/strict";
import { krippendorffAlpha, binomTailGE, binomTwoSided, signFlipTest, bootstrap, mean, rng, shuffle, seedFrom } from "../eval/lib/stats.mjs";

test("Krippendorff's alpha 与 Krippendorff (2011) 的区间尺度示例一致（0.849）", () => {
  const A = [1, 2, 3, 3, 2, 1, 4, 1, 2, null, null, null];
  const B = [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, null, 3];
  const C = [null, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, null];
  const D = [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, null];
  const units = A.map((_, i) => [A[i], B[i], C[i], D[i]].filter((v) => v !== null));
  assert.equal(krippendorffAlpha(units).toFixed(3), "0.849");
  assert.equal(krippendorffAlpha([[1, 1], [3, 3], [5, 5]]), 1);
  assert.ok(Number.isNaN(krippendorffAlpha([[2]])));
});

test("二项检验", () => {
  assert.equal(binomTailGE(8, 10, 0.5).toFixed(5), (56 / 1024).toFixed(5));
  assert.equal(binomTwoSided(8, 10, 0.5).toFixed(5), (112 / 1024).toFixed(5));
  assert.equal(binomTailGE(0, 10, 0.3), 1);
  assert.equal(binomTailGE(11, 10, 0.3), 0);
});

test("符号翻转检验：小样本精确、大样本近似", () => {
  assert.equal(signFlipTest([1, 1, 1, 1, 1, 1]), 2 / 64);
  assert.equal(signFlipTest([1, -1, 1, -1]), 1);
  const p = signFlipTest(Array.from({ length: 30 }, () => 1));
  assert.ok(p < 0.001);
});

test("bootstrap 可复现，区间包含点估计", () => {
  const xs = Array.from({ length: 20 }, (_, i) => i % 5);
  const a = bootstrap(xs, mean, { seed: 3 });
  const b = bootstrap(xs, mean, { seed: 3 });
  assert.deepEqual(a, b);
  assert.ok(a.lo <= a.est && a.est <= a.hi);
  assert.ok(Number.isNaN(bootstrap([1], mean).lo));
});

test("随机工具", () => {
  assert.notEqual(seedFrom("a"), seedFrom("b"));
  const r1 = shuffle([1, 2, 3, 4, 5], rng(1));
  const r2 = shuffle([1, 2, 3, 4, 5], rng(1));
  assert.deepEqual(r1, r2);
  assert.deepEqual([...r1].sort(), [1, 2, 3, 4, 5]);
});
