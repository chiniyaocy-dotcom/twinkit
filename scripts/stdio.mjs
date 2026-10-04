#!/usr/bin/env node
// 本地 stdio 适配器：给只支持 stdio 的 MCP 客户端用。
// 配置示例：{ "command": "node", "args": ["/绝对路径/twinkit/scripts/stdio.mjs", "--persona", "/绝对路径/persona"] }
// 注意：stdout 只输出 JSON-RPC 消息，所有日志都写到 stderr。
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTwin } from "./lib/runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const i = argv.indexOf("--persona");
const personaDir = i >= 0 ? argv[i + 1] : undefined;

let twin;
try {
  ({ twin } = await loadTwin({ root, personaDir }));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
console.error(`TwinKit stdio：${twin.persona.meta.name} 已就绪`);

const env = { TWIN_PUBLIC: "true" };
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const response = await twin.fetch(
    new Request("http://stdio.local/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: line,
    }),
    env,
    { waitUntil() {} },
  );
  if (response.status === 202) continue;
  const text = (await response.text()).trim();
  if (text) process.stdout.write(text.replace(/\n/g, " ") + "\n");
}
