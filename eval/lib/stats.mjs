// 评测用的统计工具：零依赖、可复现（所有随机过程都用固定种子）。

/** mulberry32：小而稳定的伪随机数生成器。 */
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 把任意字符串变成 32 位种子（FNV-1a）。 */
export function seedFrom(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mean(xs) {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 百分位 bootstrap 置信区间。units 是重抽样的单位（例如“任务”），stat(units) 返回统计量。
 * 按任务整体重抽样，避免把同一任务下的多条评分当成独立样本。
 */
export function bootstrap(units, stat, { iters = 5000, seed = 42, level = 0.95 } = {}) {
  const est = stat(units);
  if (units.length < 2) return { est, lo: NaN, hi: NaN };
  const random = rng(seed);
  const vals = [];
  const sample = new Array(units.length);
  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < units.length; j++) sample[j] = units[Math.floor(random() * units.length)];
    const v = stat(sample);
    if (Number.isFinite(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return { est, lo: quantile(vals, alpha), hi: quantile(vals, 1 - alpha) };
}

/** 配对差的符号翻转置换检验（双侧）。n ≤ 16 时精确枚举，否则蒙特卡洛。 */
export function signFlipTest(diffs, { iters = 20000, seed = 7 } = {}) {
  const n = diffs.length;
  if (!n) return NaN;
  const observed = Math.abs(mean(diffs));
  const eps = 1e-12;
  if (n <= 16) {
    let count = 0;
    const total = 2 ** n;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (mask >> i) & 1 ? -diffs[i] : diffs[i];
      if (Math.abs(s / n) >= observed - eps) count++;
    }
    return count / total;
  }
  const random = rng(seed);
  let count = 0;
  for (let k = 0; k < iters; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += random() < 0.5 ? -diffs[i] : diffs[i];
    if (Math.abs(s / n) >= observed - eps) count++;
  }
  return (count + 1) / (iters + 1);
}

const logFactCache = [0];
function logFact(n) {
  for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i);
  return logFactCache[n];
}

/** 二项分布上尾概率 P(X ≥ k)，X ~ Binomial(n, p)。 */
export function binomTailGE(k, n, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(logFact(n) - logFact(i) - logFact(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}

/** 双侧二项检验（把概率不大于观测值的结果都算进去）。 */
export function binomTwoSided(k, n, p) {
  if (n === 0) return 1;
  const pmf = (i) => Math.exp(logFact(n) - logFact(i) - logFact(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  const obs = pmf(k);
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const v = pmf(i);
    if (v <= obs * (1 + 1e-9)) s += v;
  }
  return Math.min(1, s);
}

/**
 * Krippendorff's alpha（区间尺度）。units：每个评分对象的一组评分（已去掉缺失值）。
 * 只有 ≥2 个评分的对象参与计算。所有值都相同时返回 NaN（无法估计一致性）。
 */
export function krippendorffAlpha(units) {
  const pairable = units.filter((u) => u.length >= 2);
  const n = pairable.reduce((a, u) => a + u.length, 0);
  if (n < 2) return NaN;
  let observed = 0;
  for (const u of pairable) {
    let s = 0;
    for (let i = 0; i < u.length; i++) for (let j = 0; j < u.length; j++) if (i !== j) s += (u[i] - u[j]) ** 2;
    observed += s / (u.length - 1);
  }
  observed /= n;
  let sum = 0;
  let sumSq = 0;
  for (const u of pairable) for (const v of u) { sum += v; sumSq += v * v; }
  const expected = (2 * (n * sumSq - sum * sum)) / (n * (n - 1));
  if (expected === 0) return NaN;
  return 1 - observed / expected;
}

export function round(x, digits = 2) {
  if (!Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
