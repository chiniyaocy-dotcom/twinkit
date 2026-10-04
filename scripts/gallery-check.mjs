#!/usr/bin/env node
// Gallery 检查：
//   node scripts/gallery-check.mjs            只检查 gallery/entries/*.json 的格式（CI 用）
//   node scripts/gallery-check.mjs --online   还会探测每个分身是否在线，生成 gallery/STATUS.md、status.json，并追加 history.csv
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ACTIVE_DAYS_THRESHOLD = 8;

const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 返回错误列表；空数组表示通过。 */
export function checkEntry(e, file = "") {
  const errs = [];
  const expect = file ? basename(file, ".json") : null;
  if (!e || typeof e !== "object" || Array.isArray(e)) return ["不是 JSON 对象"];
  if (typeof e.handle !== "string" || !HANDLE.test(e.handle)) errs.push("handle 只能用小写字母、数字和 -（2–39 位）");
  else if (expect && e.handle !== expect) errs.push(`handle（${e.handle}）要和文件名（${expect}.json）一致`);
  for (const k of ["name", "role"]) if (typeof e[k] !== "string" || !e[k].trim() || e[k].length > 60) errs.push(`${k} 必填，最多 60 字`);
  if (e.summary !== undefined && (typeof e.summary !== "string" || e.summary.length > 200)) errs.push("summary 最多 200 字");
  let url = null;
  try { url = new URL(e.endpoint); } catch { errs.push("endpoint 必须是完整的 https 地址"); }
  if (url) {
    if (url.protocol !== "https:") errs.push("endpoint 必须是 https");
    if (!/\/mcp\/?$/.test(url.pathname)) errs.push("endpoint 应该以 /mcp 结尾");
    if (/\/t\/[^/]+\//.test(url.pathname) || url.search || url.username || url.password) errs.push("endpoint 不能包含令牌或查询参数：Gallery 只收录公开分身");
  }
  if (typeof e.owner !== "string" || !GITHUB_LOGIN.test(e.owner)) errs.push("owner 必须是 GitHub 用户名");
  if (typeof e.pack !== "string" || !(e.pack === "private" || /^https:\/\//.test(e.pack))) errs.push("pack 写人格包的公开链接，或者写 \"private\"");
  if (e.demo !== undefined && typeof e.demo !== "boolean") errs.push("demo 必须是 true 或 false");
  const c = e.consent;
  if (!c || typeof c !== "object") errs.push("缺少 consent（同意声明）");
  else {
    if (c.ai_disclosure !== true) errs.push("consent.ai_disclosure 必须为 true：分身必须表明自己是 AI");
    if (typeof c.date !== "string" || !DATE.test(c.date)) errs.push("consent.date 格式是 YYYY-MM-DD");
    if (e.demo === true) {
      if (c.fictional !== true && c.owner_is_subject !== true) errs.push("演示条目要么是虚构人物（consent.fictional: true），要么是本人（consent.owner_is_subject: true）");
    } else {
      if (c.owner_is_subject !== true) errs.push("consent.owner_is_subject 必须为 true：只收录本人提交的本人分身");
      if (c.fictional === true) errs.push("虚构人物只能作为演示条目（demo: true）");
    }
  }
  if (e.eval !== undefined && e.eval !== null) {
    if (typeof e.eval !== "object" || typeof e.eval.report !== "string" || !/^https:\/\//.test(e.eval.report)) errs.push("eval.report 必须是评测报告的 https 链接");
  }
  return errs;
}

export function loadEntries(dir = join(ROOT, "gallery", "entries")) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort()
    .map((f) => {
      const file = join(dir, f);
      let entry = null;
      let errors = [];
      try { entry = JSON.parse(readFileSync(file, "utf8")); } catch (e) { errors = [`不是合法 JSON：${e.message}`]; }
      if (entry) errors = checkEntry(entry, file);
      return { file: `gallery/entries/${f}`, entry, errors };
    });
}

async function fetchWithTimeout(url, init = {}, ms = 10000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(timer); }
}

export async function probe(entry) {
  const r = { handle: entry.handle, reachable: false, mcp: false, version: null, active_days_28d: null };
  const ep = new URL(entry.endpoint);
  try {
    const res = await fetchWithTimeout(new URL("/health", ep).href, { headers: { accept: "application/json" } });
    if (res.ok) {
      const h = await res.json();
      r.reachable = h && h.ok === true;
      r.version = (h && h.version) || null;
      if (Number.isInteger(h && h.active_days_28d)) r.active_days_28d = h.active_days_28d;
    }
  } catch { /* 离线 */ }
  try {
    const res = await fetchWithTimeout(ep.href, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "twinkit-gallery-check", version: "0.1.0" } } }),
    });
    r.mcp = res.ok && /"protocolVersion"/.test(await res.text());
  } catch { /* 不是 MCP */ }
  return r;
}

async function repoStats() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  try {
    const headers = { accept: "application/vnd.github+json", "user-agent": "twinkit-gallery-check" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}`, { headers });
    if (!res.ok) return null;
    const j = await res.json();
    return { stars: j.stargazers_count, forks: j.forks_count, watchers: j.subscribers_count };
  } catch {
    return null;
  }
}

export function summarize(entries, probes) {
  const real = entries.filter((x) => x.entry && !x.errors.length && x.entry.demo !== true);
  const online = real.filter((x) => probes[x.entry.handle] && probes[x.entry.handle].mcp);
  const active = online.filter((x) => (probes[x.entry.handle].active_days_28d || 0) >= ACTIVE_DAYS_THRESHOLD);
  const evaluated = real.filter((x) => x.entry.eval && x.entry.eval.report);
  return { real_packs: real.length, real_packs_online: online.length, active_twins: active.length, evaluated: evaluated.length };
}

function renderStatus(entries, probes, summary, stats, now) {
  const o = ["# Gallery 状态（自动生成，请不要手改）", "", `更新时间：${now.slice(0, 16).replace("T", " ")} UTC · 指标定义见 [docs/metrics.md](../docs/metrics.md)`, ""];
  o.push("## 目标进度", "");
  if (stats) o.push(`- GitHub Stars：${stats.stars}（目标 500）· Forks：${stats.forks}`);
  o.push(`- 真实人格包（本人提交、非演示、在线）：${summary.real_packs_online} / 5（已登记 ${summary.real_packs}）`);
  o.push(`- 持续使用的分身（近 28 天活跃 ≥ ${ACTIVE_DAYS_THRESHOLD} 天，需开启公开统计）：${summary.active_twins}`);
  o.push(`- 发布了评测报告的分身：${summary.evaluated}`, "");
  o.push("## 分身列表", "", "| 分身 | 角色 | 类型 | 在线 | 近 28 天活跃天数 | 评测 |", "|---|---|---|---|---|---|");
  for (const x of entries) {
    if (!x.entry) continue;
    const e = x.entry;
    const p = probes[e.handle] || {};
    const kind = e.demo ? "演示" : "本人";
    const online = x.errors.length ? "格式错误" : p.mcp ? "✅" : p.reachable ? "⚠️ 无 MCP" : "❌";
    const days = Number.isInteger(p.active_days_28d) ? String(p.active_days_28d) : "未公开";
    const ev = e.eval && e.eval.report ? `[报告](${e.eval.report})` : "—";
    o.push(`| [${e.name}](${e.endpoint.replace(/\/mcp\/?$/, "/")}) | ${e.role} | ${kind} | ${online} | ${days} | ${ev} |`);
  }
  return o.join("\n") + "\n";
}

async function main() {
  const online = process.argv.includes("--online");
  const entries = loadEntries();
  let bad = 0;
  for (const x of entries) {
    if (x.errors.length) {
      bad++;
      console.log(`✗ ${x.file}`);
      for (const e of x.errors) console.log(`    ${e}`);
    } else console.log(`✓ ${x.file}`);
  }
  if (!online) {
    console.log(bad ? `${bad} 个条目有问题` : `全部 ${entries.length} 个条目格式正确`);
    process.exit(bad ? 1 : 0);
  }
  const probes = {};
  for (const x of entries) if (x.entry && !x.errors.length) probes[x.entry.handle] = await probe(x.entry);
  const summary = summarize(entries, probes);
  const stats = await repoStats();
  const now = new Date().toISOString();
  writeFileSync(join(ROOT, "gallery", "STATUS.md"), renderStatus(entries, probes, summary, stats, now));
  writeFileSync(join(ROOT, "gallery", "status.json"), JSON.stringify({ updated: now, summary, repo: stats, probes }, null, 2) + "\n");
  const hist = join(ROOT, "gallery", "history.csv");
  if (!existsSync(hist)) writeFileSync(hist, "date,stars,forks,real_packs,real_packs_online,active_twins,evaluated\n");
  const day = now.slice(0, 10);
  if (!readFileSync(hist, "utf8").includes(`\n${day},`)) {
    appendFileSync(hist, `${day},${stats ? stats.stars : ""},${stats ? stats.forks : ""},${summary.real_packs},${summary.real_packs_online},${summary.active_twins},${summary.evaluated}\n`);
  }
  console.log(`真实人格包 ${summary.real_packs_online}/${summary.real_packs} 在线 · 持续使用 ${summary.active_twins} · 有评测 ${summary.evaluated}${stats ? ` · Stars ${stats.stars}` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
