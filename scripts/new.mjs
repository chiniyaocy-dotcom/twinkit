#!/usr/bin/env node
// 用法：node scripts/new.mjs [目标目录，默认 persona] [--force]
import { cpSync, existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const target = resolve(argv.find((a) => !a.startsWith("--")) || join(root, "persona"));
if (existsSync(join(target, "persona.md")) && !force) {
  console.error(`${relative(process.cwd(), target)}/persona.md 已经存在，不会覆盖（确定要覆盖就加 --force）。`);
  process.exit(1);
}
cpSync(join(root, "templates", "persona"), target, { recursive: true, force });
const rel = relative(process.cwd(), target) || ".";
console.log(`已创建 ${rel}/。下一步：
  1. 把 ${rel}/ 里所有 {{…}} 换成你的内容——或者把 docs/interview-prompt.md 发给任意 AI，让它采访你后直接生成
  2. npm run validate   检查结构、占位符和隐私信息
  3. npm run dev        本地试用（http://127.0.0.1:8787）
  4. npm run deploy     部署到 Cloudflare（见 docs/deploy.md）`);
