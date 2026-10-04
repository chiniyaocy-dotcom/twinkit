#!/usr/bin/env node
// 用法：node scripts/validate.mjs [人格包目录] [--strict] [--json]
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePersona } from "./lib/validate.mjs";
import { defaultPersonaDir } from "./lib/persona.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const asJson = args.includes("--json");
const dirArg = args.find((a) => !a.startsWith("--"));
const { dir, example } = dirArg ? { dir: resolve(dirArg), example: false } : defaultPersonaDir(root);

const r = validatePersona(dir, { strict });
if (asJson) {
  console.log(JSON.stringify({ dir: relative(process.cwd(), dir) || ".", ok: r.ok, errors: r.errors, warnings: r.warnings, stats: r.stats }, null, 2));
  process.exit(r.ok ? 0 : 1);
}
if (example) console.log("（没有找到 persona/persona.md，检查的是示例人格包。运行 npm run new 创建你自己的。）");
console.log(`检查：${relative(process.cwd(), dir) || "."}`);
if (r.stats) {
  const s = r.stats;
  console.log(`  ${s.name}：原则 ${s.principles} 条 · 交付物 ${s.deliverables} 种 · 方法 ${s.methods} · 决策 ${s.decisions} · 品味 ${s.taste} · 风格 ${s.voice} · ${Math.round(s.bytes / 1024)} KB`);
}
for (const e of r.errors) console.log(`  ✗ ${e}`);
for (const w of r.warnings) console.log(`  ! ${w}`);
if (r.ok) console.log(r.warnings.length ? `通过（${r.warnings.length} 条建议）` : "通过");
else console.log(`未通过：${r.errors.length} 个错误${strict && r.warnings.length ? `，${r.warnings.length} 条建议（--strict 模式下也算错误）` : ""}`);
process.exit(r.ok ? 0 : 1);
