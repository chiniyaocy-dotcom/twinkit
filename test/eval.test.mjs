import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseTasks } from "../eval/lib/tasks.mjs";
import { run, buildMessages, chat, makeRatingPack, embedPack, outputRule } from "../eval/run.mjs";
import { loadRun, analyze, renderReport, pool } from "../eval/analyze.mjs";
import { createTwin } from "../engine/worker.template.js";
import { loadPersona } from "../scripts/lib/persona.mjs";
import { rng } from "../eval/lib/stats.mjs";
import { EXAMPLE, ROOT, tmp } from "./helpers.mjs";

const twin = createTwin(loadPersona(EXAMPLE));
const quiet = () => {};

test("parseTasks：编号、交付物、背景、本人答案；编号重复报错", () => {
  const tasks = parseTasks("# 标题\n## T01 写周报\n- 交付物：周报\n- 背景：杯量下降\n补充说明\n### 本人答案\n结论：……\n## 没有编号的任务\n内容");
  assert.equal(tasks.length, 2);
  assert.deepEqual([tasks[0].id, tasks[0].deliverable, tasks[0].context, tasks[0].human], ["T01", "周报", "杯量下降", "结论：……"]);
  assert.equal(tasks[0].prompt, "写周报\n\n补充说明\n\n背景：杯量下降");
  assert.equal(tasks[1].id, "T02");
  assert.equal(tasks[1].human, null);
  assert.throws(() => parseTasks("## T1 a\n## T1 b"), /重复/);
  assert.equal(parseTasks(readFileSync(join(ROOT, "eval", "tasks.example.md"), "utf8")).length, 20);
});

test("三种条件只差在角色和工作简报，任务与输出要求相同", () => {
  const t = { prompt: "写本周周报", deliverable: "周报" };
  const b = buildMessages("baseline", t, { twin });
  const r = buildMessages("role", t, { twin });
  const w = buildMessages("twin", t, { twin });
  assert.equal(b.length, 1);
  assert.equal(r[0].content, "你是一名连锁茶饮品牌运营总监。");
  assert.match(w[1].content, /^# 工作简报/);
  const ask = b[0].content;
  assert.ok(r[1].content === ask && w[1].content.endsWith(ask));
  assert.match(ask, new RegExp(outputRule(800)));
  assert.throws(() => buildMessages("nope", t, { twin }));
});

test("chat：遇到 429 会重试，返回模型内容", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ choices: [{ message: { content: " 你好 " } }] }), { status: 200 });
  };
  assert.equal(await chat({ base: "https://x/v1/", key: "k", model: "m", messages: [], fetchImpl, backoffMs: 1 }), "你好");
  assert.equal(n, 2);
  const fail = async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
  await assert.rejects(chat({ base: "https://x", key: "k", model: "m", messages: [], fetchImpl: fail, backoffMs: 1 }), /401：bad key/);
});

test("盲评包：评委看不到来源，答案表能还原；HTML 里安全内嵌", () => {
  const tasks = [{ id: "T01", title: "a", prompt: "a" }, { id: "T02", title: "b", prompt: "b" }, { id: "T03", title: "c", prompt: "c" }];
  const items = tasks.flatMap((t) => ["baseline", "role", "twin"].map((c) => ({ task_id: t.id, condition: c, text: `${t.id}-${c}</script>` })));
  const { pack, key } = makeRatingPack({ persona: { name: "周屿", role: "x", handle: "zhou-yu" }, tasks, items, seed: 1 });
  assert.equal(pack.tasks.length, 3);
  for (const t of pack.tasks) {
    for (const c of t.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ["label", "text"]);
      assert.equal(c.text, `${t.task_id}-${key.mapping[t.task_id][c.label]}</script>`);
    }
  }
  const html = embedPack("<head><!--TWINKIT_PACK--></head>", pack);
  assert.doesNotMatch(html.replace(/^<head><script>/, ""), /<\/script>.*<\/script>.*<\/script>/s);
  assert.match(html, /\\u003c\/script>/);
});

function simulate(dir, { base, raters, guess = false }) {
  const pack = JSON.parse(readFileSync(join(dir, "rating-pack.json"), "utf8"));
  const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
  raters.forEach(([id, relation], i) => {
    const r = rng(10 + i);
    const ratings = [];
    const picks = [];
    for (const t of pack.tasks) {
      let best = null;
      let bestV = -1;
      for (const c of t.candidates) {
        const cond = key.mapping[t.task_id][c.label];
        const v = Math.max(1, Math.min(5, Math.round(base[cond] + (r() - 0.5) * 2)));
        ratings.push({ task_id: t.task_id, label: c.label, likeness: v, usable: v });
        if (v > bestV) { bestV = v; best = c.label; }
      }
      const humanLabel = Object.keys(key.mapping[t.task_id]).find((l) => key.mapping[t.task_id][l] === "human");
      picks.push({ task_id: t.task_id, most_like: best, guess_human: guess ? (r() < 0.5 ? humanLabel : best) : null });
    }
    writeFileSync(join(dir, "ratings", `ratings-${id}.json`), JSON.stringify({ format: "twinkit-ratings/1", pack_id: pack.pack_id, rater: { id, relation }, ratings, picks }));
  });
}

test("端到端：dry-run 生成盲评包 → 模拟打分 → 报告", async () => {
  const out = tmp();
  const r = await run({ dryRun: true, out, persona: EXAMPLE, conditions: "baseline,role,twin", maxChars: 800 }, { log: quiet });
  assert.equal(r.failures.length, 0);
  assert.equal(r.generated, 60);
  for (const f of ["outputs.json", "rating-pack.json", "key.json", "rate.html"]) assert.ok(existsSync(join(out, f)), f);
  assert.match(readFileSync(join(out, "rate.html"), "utf8"), /window\.TWINKIT_PACK = \{/);
  const again = await run({ dryRun: true, out, persona: EXAMPLE, conditions: "baseline,role,twin", maxChars: 800 }, { log: quiet });
  assert.equal(again.generated, 0, "再次运行会续跑而不是重复生成");

  simulate(out, { base: { twin: 4, role: 2.8, baseline: 2.2 }, raters: [["本人", "self"], ["a", "colleague"], ["b", "colleague"]] });
  writeFileSync(join(out, "ratings", "junk.json"), "{}");
  const loaded = loadRun(out);
  assert.equal(loaded.sheets.length, 3);
  assert.equal(loaded.skipped.length, 1);
  const res = analyze(loaded, { iters: 1000 });
  assert.equal(res.tasks, 20);
  assert.equal(res.protocol.meets_protocol, true);
  assert.equal(res.hypotheses[0].result, "支持");
  assert.equal(res.hypotheses[1].result, "支持");
  assert.ok(res.comparisons.role.diff.est > 0.8);
  assert.ok(res.reliability.krippendorff_alpha_likeness > 0.3);
  const md = renderReport([res], null);
  assert.match(md, /H1 支持/);
  assert.match(md, /dry-run/);
});

test("有本人原稿时计算识别率；分身不比通用角色好时 H1 不成立；多人合并", async () => {
  const dir = tmp();
  const tasksFile = join(dir, "tasks.md");
  writeFileSync(tasksFile, Array.from({ length: 12 }, (_, i) => `## T${i + 1} 任务${i + 1}\n- 交付物：周报\n### 本人答案\n本人写的第 ${i + 1} 份`).join("\n"));
  const out = join(dir, "run");
  await run({ dryRun: true, out, persona: EXAMPLE, tasks: tasksFile, conditions: "role,twin", maxChars: 500 }, { log: quiet });
  simulate(out, { base: { twin: 3, role: 3, human: 4.5 }, raters: [["x", "self"], ["y", "friend"]], guess: true });
  const res = analyze(loadRun(out), { iters: 1000 });
  assert.equal(res.protocol.meets_protocol, false);
  assert.ok(res.discrimination && res.discrimination.guesses === 24);
  assert.equal(res.discrimination.chance, 0.33);
  assert.notEqual(res.hypotheses[0].result, "支持");
  assert.match(renderReport([res], null), /能不能认出本人原稿/);
  const pooled = pool([res, res], { iters: 500 });
  assert.equal(pooled.people, 2);
});

test("评分文件：不看扩展名、排除完成度不足 80% 的、同一代号只算一次", async () => {
  const dir = tmp();
  const tasksFile = join(dir, "tasks.md");
  writeFileSync(tasksFile, Array.from({ length: 5 }, (_, i) => `## T${i + 1} 任务${i + 1}\n- 交付物：周报`).join("\n"));
  const out = join(dir, "run");
  await run({ dryRun: true, out, persona: EXAMPLE, tasks: tasksFile, conditions: "role,twin", maxChars: 300 }, { log: quiet });
  simulate(out, { base: { twin: 4, role: 2 }, raters: [["a", "self"], ["b", "colleague"]] });
  const sheet = (name) => JSON.parse(readFileSync(join(out, "ratings", `ratings-${name}.json`), "utf8"));
  const a = sheet("a");
  // 浏览器把文件存成了 "download"（没有扩展名）
  writeFileSync(join(out, "ratings", "download"), JSON.stringify({ ...sheet("b"), rater: { id: "c", relation: "friend" } }));
  // 同一个评委下载了两次：旧的那份应该被丢掉
  writeFileSync(join(out, "ratings", "download (1)"), JSON.stringify({ ...a, created: "2000-01-01T00:00:00.000Z" }));
  writeFileSync(join(out, "ratings", "ratings-a.json"), JSON.stringify({ ...a, created: "2030-01-01T00:00:00.000Z" }));
  // 只做了一半
  writeFileSync(join(out, "ratings", "half.json"), JSON.stringify({ ...a, rater: { id: "d", relation: "friend" }, ratings: a.ratings.slice(0, 5) }));
  writeFileSync(join(out, "ratings", "说明.txt"), "这是备注");
  writeFileSync(join(out, "ratings", ".DS_Store"), "x");
  const loaded = loadRun(out);
  assert.deepEqual(loaded.sheets.map((s) => s.rater.id).sort(), ["a", "b", "c"]);
  assert.equal(loaded.sheets.find((s) => s.rater.id === "a").created, "2030-01-01T00:00:00.000Z");
  assert.equal(loaded.skipped.length, 3, loaded.skipped.join("\n"));
  assert.ok(loaded.skipped.some((m) => /download \(1\).*同一个评委代号/.test(m)));
  assert.ok(loaded.skipped.some((m) => /half\.json.*不足 80%/.test(m)));
  assert.ok(loaded.skipped.some((m) => /说明\.txt.*不是合法 JSON/.test(m)));
  const res = analyze(loaded, { iters: 200 });
  assert.equal(res.raters.length, 3);
  assert.equal(res.excluded.length, 3);
  assert.match(renderReport([res], null), /没有计入的文件[\s\S]*half\.json/);
});
