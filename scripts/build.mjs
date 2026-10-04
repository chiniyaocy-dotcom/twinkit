#!/usr/bin/env node
// 用法：node scripts/build.mjs [--persona <目录>] [--out <目录>]
// 把人格包注入 engine/worker.template.js，生成：
//   dist/worker.js    单文件 Worker（wrangler deploy 或粘贴到 Cloudflare 控制台）
//   dist/persona.json 解析后的人格包
//   dist/prompt.md    提示词包（不支持 MCP 的 AI 也能用）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultPersonaDir } from "./lib/persona.mjs";
import { validatePersona } from "./lib/validate.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = "/*__TWIN_BUNDLE__*/ null";

export class BuildError extends Error {}

export async function build({ personaDir, outDir, log = console.log } = {}) {
  const picked = personaDir ? { dir: resolve(personaDir), example: false } : defaultPersonaDir(ROOT);
  const out = resolve(outDir || join(ROOT, "dist"));
  if (picked.example) log("没有找到 persona/persona.md，使用示例人格包 examples/zhou-yu（虚构人物）。运行 npm run new 创建你自己的。");
  const v = validatePersona(picked.dir);
  for (const w of v.warnings) log(`  ! ${w}`);
  if (!v.ok) throw new BuildError(`人格包检查没通过：\n${v.errors.map((e) => `  ✗ ${e}`).join("\n")}`);
  const bundle = v.bundle;

  const templatePath = join(ROOT, "engine", "worker.template.js");
  const template = readFileSync(templatePath, "utf8");
  if (!template.includes(MARK)) throw new BuildError("engine/worker.template.js 里找不到注入标记 /*__TWIN_BUNDLE__*/");
  const worker = template
    .replace(MARK, () => JSON.stringify(bundle))
    .replace(/^export function createTwin/m, "function createTwin");

  const { createTwin } = await import(pathToFileURL(templatePath).href);
  const promptPack = createTwin(bundle).promptPack();

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "worker.js"), worker);
  writeFileSync(join(out, "persona.json"), JSON.stringify(bundle, null, 2) + "\n");
  writeFileSync(join(out, "prompt.md"), promptPack + "\n");
  const rel = relative(process.cwd(), out) || ".";
  log(`已生成 ${rel}/worker.js（${Math.round(Buffer.byteLength(worker) / 1024)} KB）、${rel}/persona.json、${rel}/prompt.md · ${bundle.meta.name}`);
  return { bundle, out, files: ["worker.js", "persona.json", "prompt.md"].map((f) => join(out, f)) };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--persona") o.personaDir = argv[++i];
    else if (argv[i] === "--out") o.outDir = argv[++i];
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  build(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error(e instanceof BuildError ? e.message : e);
    process.exit(1);
  });
}
