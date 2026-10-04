#!/usr/bin/env node
// 第 1 步：用同一个模型、同一批任务，生成三种条件下的回答，并打包成盲评文件。
//   baseline  只给任务
//   role      任务 + “你是一名<角色>”
//   twin      任务 + 分身的工作简报（work_brief）
//   human     （可选）任务文件里“### 本人答案”下的本人原稿
//
// 用法：
//   node eval/run.mjs --tasks eval/tasks.example.md [--persona persona] [--provider github] [--model openai/gpt-4.1-mini]
//                     [--conditions baseline,role,twin] [--out eval/runs/<名字>] [--limit 5] [--seed 42] [--dry-run]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadTwin } from "../scripts/lib/runtime.mjs";
import { parseTasks } from "./lib/tasks.mjs";
import { rng, shuffle, seedFrom } from "./lib/stats.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONDITIONS = ["baseline", "role", "twin"];
export const PROVIDERS = {
  github: { base: "https://models.github.ai/inference", keyEnv: "GITHUB_TOKEN", model: "openai/gpt-4.1-mini", delayMs: 4500 },
  openai: { base: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", model: "gpt-4.1-mini", delayMs: 0 },
  deepseek: { base: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY", model: "deepseek-chat", delayMs: 0 },
  dashscope: { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyEnv: "DASHSCOPE_API_KEY", model: "qwen-plus", delayMs: 0 },
};
const LABELS = "ABCDEFGH";

export function outputRule(maxChars) {
  return `直接输出可以交付的正文（Markdown），不要解释你要怎么做，不要提到你是 AI，不超过 ${maxChars} 字。`;
}

/** 三种条件拿到的信息只差在“有没有角色 / 有没有工作简报”，任务和输出要求完全一样。 */
export function buildMessages(condition, task, { twin, maxChars = 800 }) {
  const ask = `${task.prompt}${task.deliverable ? `\n\n交付物：${task.deliverable}` : ""}\n\n${outputRule(maxChars)}`;
  const role = twin.persona.meta.role || "专业人士";
  if (condition === "baseline") return [{ role: "user", content: ask }];
  if (condition === "role") return [{ role: "system", content: `你是一名${role}。` }, { role: "user", content: ask }];
  if (condition === "twin") {
    const brief = twin.brief({ task: task.prompt, deliverable: task.deliverable || "" }).text;
    return [
      { role: "system", content: "你是一名得力的助手。先读完用户提供的工作简报，再严格按简报完成任务。" },
      { role: "user", content: `${brief}\n\n---\n${ask}` },
    ];
  }
  throw new Error(`未知条件：${condition}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chat({ base, key, model, messages, temperature = 0.7, fetchImpl = fetch, backoffMs = 3000 }) {
  let lastError = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature }),
      });
    } catch (e) {
      lastError = String(e.message || e);
      await sleep((backoffMs * 2 ** attempt) / 1.5);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = `HTTP ${res.status}`;
      const retry = Number(res.headers.get("retry-after"));
      await sleep(Math.min(Number.isFinite(retry) && retry > 0 ? retry * 1000 : backoffMs * 2 ** attempt, 90000));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`HTTP ${res.status}：${(data && data.error && (data.error.message || data.error.code)) || "请求失败"}`);
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("模型没有返回内容（choices[0].message.content 为空）");
    return text.trim();
  }
  throw new Error(`重试多次仍然失败：${lastError}`);
}

/** 打乱每个任务里各条件的顺序，生成评委看的 rating-pack.json 和只给组织者看的 key.json。 */
export function makeRatingPack({ persona, tasks, items, seed, created = new Date().toISOString(), meta = {} }) {
  const packId = `${persona.handle}-${created.slice(0, 10).replace(/-/g, "")}-${(seed >>> 0).toString(16).padStart(8, "0").slice(-6)}`;
  const random = rng(seed);
  const mapping = {};
  const packTasks = [];
  let hasHuman = false;
  for (const t of tasks) {
    const cands = items.filter((it) => it.task_id === t.id && typeof it.text === "string" && it.text.trim());
    if (cands.length < 2) continue;
    if (cands.some((c) => c.condition === "human")) hasHuman = true;
    const shuffled = shuffle(cands, random);
    mapping[t.id] = {};
    packTasks.push({
      task_id: t.id,
      title: t.title,
      prompt: t.prompt,
      candidates: shuffled.map((c, i) => {
        mapping[t.id][LABELS[i]] = c.condition;
        return { label: LABELS[i], text: c.text };
      }),
    });
  }
  const pack = {
    format: "twinkit-rating-pack/1",
    pack_id: packId,
    created,
    persona: { name: persona.name, role: persona.role },
    has_human: hasHuman,
    scales: {
      likeness: ["完全不像", "不太像", "有点像", "很像", "就是 TA 会写的"],
      usable: ["完全不能用", "要大改", "改一改能用", "小改就能用", "直接能用"],
    },
    tasks: packTasks,
  };
  const key = { format: "twinkit-rating-key/1", pack_id: packId, created, seed, persona, meta, mapping };
  return { pack, key };
}

export function embedPack(html, pack) {
  const json = JSON.stringify(pack).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return html.replace("<!--TWINKIT_PACK-->", () => `<script>window.TWINKIT_PACK = ${json};</script>`);
}

function parseArgs(argv) {
  const o = { conditions: CONDITIONS.join(","), maxChars: 800, temperature: 0.7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--tasks") o.tasks = next();
    else if (a === "--persona") o.persona = next();
    else if (a === "--provider") o.provider = next();
    else if (a === "--model") o.model = next();
    else if (a === "--base-url") o.baseUrl = next();
    else if (a === "--api-key-env") o.apiKeyEnv = next();
    else if (a === "--conditions") o.conditions = next();
    else if (a === "--out") o.out = next();
    else if (a === "--limit") o.limit = Number(next());
    else if (a === "--seed") o.seed = Number(next());
    else if (a === "--max-chars") o.maxChars = Number(next());
    else if (a === "--temperature") o.temperature = Number(next());
    else if (a === "--delay") o.delay = Number(next());
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--fresh") o.fresh = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`不认识的参数：${a}`);
  }
  return o;
}

export async function run(o, { log = console.log, fetchImpl = fetch } = {}) {
  const { twin, example } = await loadTwin({ root: ROOT, personaDir: o.persona, log });
  const M = twin.persona.meta;
  if (example && !o.persona) log("（使用示例人格包 examples/zhou-yu）");
  const tasksFile = resolve(o.tasks || join(ROOT, "eval", "tasks.example.md"));
  let tasks = parseTasks(readFileSync(tasksFile, "utf8"));
  if (o.limit > 0) tasks = tasks.slice(0, o.limit);
  if (!tasks.length) throw new Error(`${tasksFile} 里没有任务（每个任务用“## T01 标题”开头）`);
  if (tasks.length < 20) log(`! 只有 ${tasks.length} 个任务：正式评测建议每人至少 20 个（见 docs/eval-protocol.md）`);

  const conditions = o.conditions.split(",").map((s) => s.trim()).filter(Boolean);
  for (const c of conditions) if (!CONDITIONS.includes(c)) throw new Error(`未知条件 ${c}（可选：${CONDITIONS.join(", ")}）`);
  const providerName = o.provider || (process.env.GITHUB_TOKEN ? "github" : o.baseUrl ? "custom" : "github");
  const preset = PROVIDERS[providerName] || { base: o.baseUrl, keyEnv: o.apiKeyEnv || "OPENAI_API_KEY", model: o.model, delayMs: 0 };
  const base = o.baseUrl || preset.base;
  const model = o.model || preset.model;
  const keyEnv = o.apiKeyEnv || preset.keyEnv;
  const key = process.env[keyEnv];
  if (!o.dryRun) {
    if (!base || !model) throw new Error("自定义服务需要 --base-url 和 --model");
    if (!key) throw new Error(`没有找到环境变量 ${keyEnv}。可以先用 --dry-run 检查流程，或换 --provider（${Object.keys(PROVIDERS).join(" / ")}）`);
  }
  const delay = Number.isFinite(o.delay) ? o.delay : preset.delayMs || 0;
  const created = new Date().toISOString();
  const outDir = resolve(o.out || join(ROOT, "eval", "runs", `${created.slice(0, 10)}-${M.handle}`));
  mkdirSync(join(outDir, "ratings"), { recursive: true });
  const outputsPath = join(outDir, "outputs.json");
  const previous = !o.fresh && existsSync(outputsPath) ? JSON.parse(readFileSync(outputsPath, "utf8")) : null;
  const items = previous ? previous.items.filter((it) => it.text) : [];
  const has = (tid, c) => items.some((it) => it.task_id === tid && it.condition === c);
  const seed = Number.isFinite(o.seed) ? o.seed : previous && Number.isFinite(previous.meta.seed) ? previous.meta.seed : seedFrom(`${M.handle}|${created}`);
  const meta = {
    persona: { name: M.name, role: M.role, handle: M.handle, snapshot: M.snapshot || null },
    engine: twin.version,
    provider: o.dryRun ? "dry-run" : providerName,
    model: o.dryRun ? "dry-run" : model,
    temperature: o.temperature,
    max_chars: o.maxChars,
    conditions,
    tasks_file: relative(ROOT, tasksFile),
    seed,
    created: previous ? previous.meta.created : created,
  };
  const save = () => writeFileSync(outputsPath, JSON.stringify({ format: "twinkit-eval-outputs/1", meta, items }, null, 2) + "\n");

  for (const t of tasks) if (t.human && !has(t.id, "human")) items.push({ task_id: t.id, condition: "human", text: t.human });
  const failures = [];
  const random = rng(seed ^ 0x5bd1e995);
  let n = 0;
  for (const t of tasks) {
    for (const c of conditions) {
      if (has(t.id, c)) continue;
      const messages = buildMessages(c, t, { twin, maxChars: o.maxChars });
      try {
        const text = o.dryRun
          ? `（dry-run 占位回答 #${Math.floor(random() * 1e6)}）\n\n${t.title}`
          : await chat({ base, key, model, messages, temperature: o.temperature, fetchImpl });
        items.push({ task_id: t.id, condition: c, text, messages });
        save();
        n++;
        log(`  ✓ ${t.id} ${c}`);
        if (!o.dryRun && delay) await sleep(delay);
      } catch (e) {
        failures.push(`${t.id} ${c}：${e.message}`);
        log(`  ✗ ${t.id} ${c}：${e.message}`);
      }
    }
  }
  save();

  const { pack, key: answerKey } = makeRatingPack({ persona: { name: M.name, role: M.role, handle: M.handle }, tasks, items, seed, created: meta.created, meta });
  writeFileSync(join(outDir, "rating-pack.json"), JSON.stringify(pack, null, 2) + "\n");
  writeFileSync(join(outDir, "key.json"), JSON.stringify(answerKey, null, 2) + "\n");
  const rateHtml = readFileSync(join(ROOT, "eval", "rate.html"), "utf8");
  writeFileSync(join(outDir, "rate.html"), embedPack(rateHtml, pack));

  const rel = relative(process.cwd(), outDir) || ".";
  log(`\n完成：新生成 ${n} 条回答${failures.length ? `，失败 ${failures.length} 条（再运行一次同样的命令会自动续跑）` : ""}。
  ${rel}/outputs.json      全部回答（含提示词，便于复现）
  ${rel}/rate.html         发给评委：双击打开就能打分（已内置盲评包，看不到来源）
  ${rel}/rating-pack.json  同样的盲评包（也可以在 eval/rate.html 里手动加载）
  ${rel}/key.json          答案表：只有你能看，不要发给评委
下一步：至少 3 位评委（含你本人）打分后，把他们发回的评分文件（叫什么名字都行）放进 ${rel}/ratings/，然后运行
  node eval/analyze.mjs --run ${rel}`);
  return { outDir, pack, key: answerKey, failures, generated: n };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (o.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(0);
  }
  run(o).then(
    (r) => process.exit(r.failures.length ? 1 : 0),
    (e) => {
      console.error(e.message || e);
      process.exit(1);
    },
  );
}
