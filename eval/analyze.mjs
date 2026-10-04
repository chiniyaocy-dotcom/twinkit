#!/usr/bin/env node
// 第 3 步：汇总评委打分，生成评测报告。
//   node eval/analyze.mjs --run eval/runs/<名字> [--run eval/runs/<另一个人>] [--out 目录] [--iters 5000] [--seed 42]
// 每个 run 目录需要：key.json、rating-pack.json、ratings/（评委从 rate.html 导出的文件，扩展名不限）。
// 输出 report.md（给人看）和 summary.json（给程序看）。
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, relative, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { mean, bootstrap, signFlipTest, binomTailGE, krippendorffAlpha, round } from "./lib/stats.mjs";

const NAMES = { twin: "分身（work_brief）", role: "通用角色", baseline: "只给任务", human: "本人原稿" };
const ORDER = ["twin", "role", "baseline", "human"];
const MIN_COMPLETION = 0.8;
const RELATION = { self: "本人", colleague: "同事", friend: "朋友家人", acquaintance: "不熟的人", other: "其他" };

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function loadRun(dir, extraFiles = []) {
  const key = readJson(join(dir, "key.json"));
  const ratingsDir = join(dir, "ratings");
  // 不看扩展名：有的浏览器会把下载的文件命名成 "download"，评委也可能把内容粘贴成 .txt 发回来
  const files = [
    ...(existsSync(ratingsDir)
      ? readdirSync(ratingsDir).filter((f) => !f.startsWith(".") && statSync(join(ratingsDir, f)).isFile()).sort().map((f) => join(ratingsDir, f))
      : []),
    ...extraFiles,
  ];
  const skipped = [];
  const expected = Object.values(key.mapping || {}).reduce((a, m) => a + Object.keys(m).length, 0);
  const byRater = new Map();
  for (const f of files) {
    let s;
    try { s = JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { skipped.push(`${basename(f)}：不是合法 JSON`); continue; }
    if (!s || s.format !== "twinkit-ratings/1") { skipped.push(`${basename(f)}：不是评分文件`); continue; }
    if (s.pack_id !== key.pack_id) { skipped.push(`${basename(f)}：属于另一个盲评包（${s.pack_id}）`); continue; }
    const done = (s.ratings || []).filter((r) => num(r.likeness) !== null).length;
    if (expected && done < MIN_COMPLETION * expected) { skipped.push(`${basename(f)}：只完成了 ${done}/${expected} 条评分（不足 ${MIN_COMPLETION * 100}%，按协议排除）`); continue; }
    // 同一个代号交了多份（重复下载、改过再导出）：只保留完成度最高、最新的一份，免得一个人被算成两个评委
    const id = String((s.rater && s.rater.id) || basename(f));
    const prev = byRater.get(id);
    const item = { s, f, done, created: String(s.created || "") };
    if (!prev) { byRater.set(id, item); continue; }
    const better = item.done > prev.done || (item.done === prev.done && item.created > prev.created);
    const [keep, drop] = better ? [item, prev] : [prev, item];
    byRater.set(id, keep);
    skipped.push(`${basename(drop.f)}：和 ${basename(keep.f)} 是同一个评委代号（${id}），只保留完成度更高、更新的那份`);
  }
  const sheets = [...byRater.values()].map((x) => x.s);
  return { dir, key, sheets, skipped };
}

/** 把评分表和答案表对上，得到长表。 */
export function joinRatings(key, sheets) {
  const rows = [];
  const picks = [];
  const raters = [];
  const used = new Map();
  for (const s of sheets) {
    const base = String((s.rater && s.rater.id) || "rater");
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    const id = n > 1 ? `${base}#${n}` : base;
    const relation = (s.rater && s.rater.relation) || "other";
    raters.push({ id, relation, familiarity: (s.rater && s.rater.familiarity) || null });
    for (const r of s.ratings || []) {
      const condition = key.mapping[r.task_id] && key.mapping[r.task_id][r.label];
      if (!condition) continue;
      rows.push({ task: r.task_id, rater: id, relation, label: r.label, condition, likeness: num(r.likeness), usable: num(r.usable) });
    }
    for (const p of s.picks || []) {
      const m = key.mapping[p.task_id];
      if (!m) continue;
      picks.push({ task: p.task_id, rater: id, relation, most: p.most_like ? m[p.most_like] || null : null, guess: p.guess_human ? m[p.guess_human] || null : null, k: Object.keys(m).length });
    }
  }
  return { rows, picks, raters };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

function ci(b, digits = 2) {
  return { est: round(b.est, digits), lo: round(b.lo, digits), hi: round(b.hi, digits) };
}

export function analyze({ key, sheets, skipped = [] }, { iters = 5000, seed = 42 } = {}) {
  const { rows, picks, raters } = joinRatings(key, sheets);
  const tasks = [...new Set(rows.map((r) => r.task))].sort();
  const conditions = ORDER.filter((c) => rows.some((r) => r.condition === c));
  const byTask = new Map(tasks.map((t) => [t, rows.filter((r) => r.task === t)]));
  const opts = { iters, seed };

  const perCondition = {};
  for (const c of conditions) {
    const stat = (field, f = (x) => x) => (ts) => mean(ts.flatMap((t) => byTask.get(t).filter((r) => r.condition === c && r[field] !== null).map((r) => f(r[field]))));
    const n = rows.filter((r) => r.condition === c && r.likeness !== null).length;
    perCondition[c] = {
      n,
      likeness: ci(bootstrap(tasks, stat("likeness"), opts)),
      usable: ci(bootstrap(tasks, stat("usable"), opts)),
      share_ge4: ci(bootstrap(tasks, stat("likeness", (x) => (x >= 4 ? 1 : 0)), opts)),
      picked_most_like: round(picks.length ? picks.filter((p) => p.most === c).length / picks.filter((p) => p.most).length : NaN),
    };
  }

  const comparisons = {};
  if (conditions.includes("twin")) {
    for (const other of conditions.filter((c) => c !== "twin")) {
      const diffs = [];
      const diffTasks = [];
      for (const t of tasks) {
        const rs = byTask.get(t);
        const a = rs.filter((r) => r.condition === "twin" && r.likeness !== null).map((r) => r.likeness);
        const b = rs.filter((r) => r.condition === other && r.likeness !== null).map((r) => r.likeness);
        if (a.length && b.length) { diffs.push(mean(a) - mean(b)); diffTasks.push(t); }
      }
      const winsByTask = new Map();
      for (const t of diffTasks) {
        const rs = byTask.get(t);
        const list = [];
        for (const rater of new Set(rs.map((r) => r.rater))) {
          const a = rs.find((r) => r.rater === rater && r.condition === "twin");
          const b = rs.find((r) => r.rater === rater && r.condition === other);
          if (a && b && a.likeness !== null && b.likeness !== null) list.push(a.likeness > b.likeness ? 1 : a.likeness === b.likeness ? 0.5 : 0);
        }
        winsByTask.set(t, list);
      }
      const idx = diffTasks.map((_, i) => i);
      comparisons[other] = {
        tasks: diffs.length,
        diff: ci(bootstrap(idx, (ix) => mean(ix.map((i) => diffs[i])), opts)),
        p_value: round(signFlipTest(diffs, { seed }), 4),
        win_rate: ci(bootstrap(diffTasks, (ts) => mean(ts.flatMap((t) => winsByTask.get(t))), opts)),
      };
    }
  }

  let discrimination = null;
  const guesses = picks.filter((p) => p.guess);
  if (conditions.includes("human")) {
    const correct = guesses.filter((p) => p.guess === "human").length;
    const k = guesses.length ? mean(guesses.map((p) => p.k)) : NaN;
    discrimination = {
      guesses: guesses.length,
      correct,
      accuracy: round(guesses.length ? correct / guesses.length : NaN),
      chance: round(1 / k),
      p_better_than_chance: guesses.length ? round(binomTailGE(correct, guesses.length, 1 / k), 4) : null,
      twin_mistaken_for_human: round(guesses.length ? guesses.filter((p) => p.guess === "twin").length / guesses.length : NaN),
    };
  }

  const units = new Map();
  for (const r of rows) {
    if (r.likeness === null) continue;
    const u = `${r.task}|${r.label}`;
    if (!units.has(u)) units.set(u, []);
    units.get(u).push(r.likeness);
  }
  const alpha = round(krippendorffAlpha([...units.values()]), 3);

  const byRelation = {};
  for (const rel of [...new Set(raters.map((r) => r.relation))]) {
    byRelation[rel] = { raters: raters.filter((r) => r.relation === rel).length };
    for (const c of conditions) {
      byRelation[rel][c] = round(mean(rows.filter((r) => r.relation === rel && r.condition === c && r.likeness !== null).map((r) => r.likeness)));
    }
  }

  const hasSelf = raters.some((r) => r.relation === "self");
  const enough = tasks.length >= 20 && raters.length >= 3 && hasSelf;
  const hypotheses = [];
  const verdict = (cmp) => {
    if (!cmp) return "无数据";
    if (cmp.tasks < 10 || raters.length < 2) return "样本不足";
    if (cmp.diff.lo > 0) return "支持";
    if (cmp.diff.hi < 0) return "相反";
    return "不显著";
  };
  hypotheses.push({ id: "H1", text: "分身比“通用角色”更像本人（配对差的 95% 置信区间下限 > 0）", result: verdict(comparisons.role), detail: comparisons.role || null });
  hypotheses.push({ id: "H2", text: "分身比“只给任务”更像本人（配对差的 95% 置信区间下限 > 0）", result: verdict(comparisons.baseline), detail: comparisons.baseline || null });
  const s4 = perCondition.twin && perCondition.twin.share_ge4;
  hypotheses.push({
    id: "H3",
    text: "至少一半的分身回答被评为“很像”或“就是 TA”（≥ 4 分）",
    result: !s4 || s4.est === null ? "无数据" : tasks.length < 10 ? "样本不足" : s4.lo >= 0.5 ? "支持" : s4.est >= 0.5 ? "点估计达到，区间未达到" : "未达到",
    detail: s4 || null,
  });

  return {
    persona: key.persona,
    pack_id: key.pack_id,
    meta: key.meta || {},
    tasks: tasks.length,
    raters,
    ratings: rows.length,
    conditions,
    per_condition: perCondition,
    comparisons,
    discrimination,
    reliability: { krippendorff_alpha_likeness: alpha },
    by_relation: byRelation,
    protocol: { tasks_ge_20: tasks.length >= 20, raters_ge_3: raters.length >= 3, self_rater: hasSelf, meets_protocol: enough },
    hypotheses,
    excluded: skipped,
  };
}

/** 多个人的结果合并：以“人”为单位估计分身相对通用角色的平均提升。 */
export function pool(results, { iters = 5000, seed = 42 } = {}) {
  const people = results.filter((r) => r.comparisons.role && r.comparisons.role.diff.est !== null);
  if (people.length < 2) return null;
  const diffs = people.map((r) => r.comparisons.role.diff.est);
  return {
    people: people.length,
    meeting_protocol: people.filter((r) => r.protocol.meets_protocol).length,
    mean_diff_vs_role: ci(bootstrap(diffs, (d) => mean(d), { iters, seed })),
    supported: people.filter((r) => r.hypotheses[0].result === "支持").length,
    share_ge4_mean: round(mean(people.map((r) => r.per_condition.twin.share_ge4.est))),
  };
}

const f2 = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(2));
const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const pv = (p) => (p === null || p === undefined ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));
const range = (c, fmt = f2) => (c.est === null ? "—" : `${fmt(c.est)}（${c.lo === null ? "—" : fmt(c.lo)} ~ ${c.hi === null ? "—" : fmt(c.hi)}）`);

export function renderReport(results, pooled, { generated = new Date().toISOString() } = {}) {
  const o = ["# TwinKit 评测报告：数字分身像不像本人？", ""];
  o.push(`生成时间：${generated.slice(0, 16).replace("T", " ")} UTC · 方法：盲评（评委看不到回答来源），按任务做 bootstrap 95% 置信区间，配对符号翻转检验。协议见 docs/eval-protocol.md。`, "");
  if (pooled) {
    o.push("## 总览（多人合并）", "");
    o.push(`- 参与评测的人：${pooled.people} 位（满足协议 ${pooled.meeting_protocol} 位）`);
    o.push(`- 分身相对“通用角色”的像本人分平均提升：**${range(pooled.mean_diff_vs_role)}**（1–5 分制，按人重抽样）`);
    o.push(`- H1 成立的人数：${pooled.supported} / ${pooled.people}`);
    o.push(`- 分身回答被评为 ≥ 4 分的平均占比：${pct(pooled.share_ge4_mean)}`, "");
  }
  for (const r of results) {
    const p = r.persona || {};
    o.push(`## ${p.name || p.handle || "未命名"}${p.role ? ` · ${p.role}` : ""}`, "");
    o.push(`盲评包 \`${r.pack_id}\` · 模型 ${r.meta.model || "—"}（${r.meta.provider || "—"}）· 任务 ${r.tasks} 个 · 评委 ${r.raters.length} 位（${r.raters.map((x) => RELATION[x.relation] || x.relation).join("、") || "—"}）· 评分 ${r.ratings} 条`, "");
    if (r.meta.provider === "dry-run") o.push("> ⚠️ 这是 dry-run：回答是占位文本，不是真实模型输出，分数没有意义。", "");
    if (!r.protocol.meets_protocol) {
      const miss = [];
      if (!r.protocol.tasks_ge_20) miss.push("任务少于 20 个");
      if (!r.protocol.raters_ge_3) miss.push("评委少于 3 位");
      if (!r.protocol.self_rater) miss.push("本人没有参与打分");
      o.push(`> ⚠️ 未满足预注册协议（${miss.join("、")}）：下面的数字只能当作试跑结果。`, "");
    }
    o.push("### 结论", "");
    for (const h of r.hypotheses) o.push(`- **${h.id} ${h.result}**：${h.text}`);
    o.push("");
    o.push("### 各条件得分", "");
    o.push("| 条件 | 像本人（1–5） | 能直接用（1–5） | ≥4 分占比 | 被选为最像 | 评分数 |", "|---|---|---|---|---|---|");
    for (const c of r.conditions) {
      const x = r.per_condition[c];
      o.push(`| ${NAMES[c] || c} | ${range(x.likeness)} | ${range(x.usable)} | ${range(x.share_ge4, pct)} | ${pct(x.picked_most_like)} | ${x.n} |`);
    }
    o.push("");
    if (Object.keys(r.comparisons).length) {
      o.push("### 分身 vs 其他条件（像本人分）", "");
      o.push("| 对比 | 平均差（95% CI） | p 值 | 分身胜率（95% CI） | 任务数 |", "|---|---|---|---|---|");
      for (const [other, c] of Object.entries(r.comparisons)) {
        o.push(`| 分身 − ${NAMES[other] || other} | ${range(c.diff)} | ${pv(c.p_value)} | ${range(c.win_rate, pct)} | ${c.tasks} |`);
      }
      o.push("", "胜率：同一位评委在同一个任务上给分身的分数高于对比条件的比例（平分记 0.5）。", "");
    }
    if (r.discrimination) {
      const d = r.discrimination;
      o.push("### 能不能认出本人原稿", "");
      o.push(`评委一共猜了 ${d.guesses} 次，猜中本人原稿 ${d.correct} 次（${pct(d.accuracy)}，随机猜是 ${pct(d.chance)}；比随机好的单侧 p ${d.p_better_than_chance === null ? "—" : d.p_better_than_chance < 0.001 ? "< 0.001" : "= " + d.p_better_than_chance.toFixed(3)}）。分身被误认成本人原稿的比例：${pct(d.twin_mistaken_for_human)}。`, "");
    }
    o.push("### 评委一致性与分组", "");
    const a = r.reliability.krippendorff_alpha_likeness;
    const level = a === null ? "评委不足，无法计算" : a >= 0.667 ? "高" : a >= 0.4 ? "可接受" : a >= 0.2 ? "偏低：评委对“像不像”的理解差异较大" : "很低：结论要谨慎";
    o.push(`- Krippendorff's α（像本人分，区间尺度）：${a === null ? "—" : a.toFixed(3)}（${level}）`);
    for (const [rel, g] of Object.entries(r.by_relation)) {
      o.push(`- ${RELATION[rel] || rel}（${g.raters} 位）：${r.conditions.map((c) => `${NAMES[c] || c} ${f2(g[c])}`).join(" · ")}`);
    }
    o.push("");
    if (r.excluded && r.excluded.length) {
      o.push("### 没有计入的文件", "");
      for (const x of r.excluded) o.push(`- ${x}`);
      o.push("");
    }
  }
  o.push("---", "", "说明：分数越高越像本人。置信区间按任务重抽样（多人合并时按人重抽样），所有随机过程使用固定种子，可复现。原始数据：每个 run 目录下的 outputs.json、key.json 和 ratings/。");
  return o.join("\n") + "\n";
}

function parseArgs(argv) {
  const o = { runs: [], ratings: [], iters: 5000, seed: 42 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run") o.runs.push(argv[++i]);
    else if (a === "--ratings") while (argv[i + 1] && !argv[i + 1].startsWith("--")) o.ratings.push(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--iters") o.iters = Number(argv[++i]);
    else if (a === "--seed") o.seed = Number(argv[++i]);
    else throw new Error(`不认识的参数：${a}`);
  }
  if (!o.runs.length) throw new Error("用法：node eval/analyze.mjs --run eval/runs/<名字> [--run ...] [--out 目录]");
  return o;
}

export function main(argv, log = console.log) {
  const o = parseArgs(argv);
  const results = [];
  for (const [i, dir] of o.runs.entries()) {
    const run = loadRun(resolve(dir), i === 0 ? o.ratings.map((f) => resolve(f)) : []);
    for (const s of run.skipped) log(`! 跳过 ${s}`);
    if (!run.sheets.length) log(`! ${dir} 里还没有评分文件（ratings/ 目录）`);
    results.push(analyze(run, o));
  }
  const pooled = pool(results, o);
  const out = resolve(o.out || (o.runs.length === 1 ? o.runs[0] : join("eval", "reports", new Date().toISOString().slice(0, 10))));
  mkdirSync(out, { recursive: true });
  const generated = new Date().toISOString();
  writeFileSync(join(out, "report.md"), renderReport(results, pooled, { generated }));
  writeFileSync(join(out, "summary.json"), JSON.stringify({ format: "twinkit-eval-summary/1", generated, pooled, results }, null, 2) + "\n");
  const rel = relative(process.cwd(), out) || ".";
  log(`已生成 ${rel}/report.md 和 ${rel}/summary.json`);
  for (const r of results) log(`  ${r.persona && r.persona.name}：${r.hypotheses.map((h) => `${h.id} ${h.result}`).join(" · ")}`);
  return { results, pooled, out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
