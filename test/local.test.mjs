import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ROOT, EXAMPLE } from "./helpers.mjs";

function start(script, args) {
  const child = spawn(process.execPath, [join(ROOT, "scripts", script), ...args], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const queue = [];
  const waiters = [];
  lines.on("line", (l) => (waiters.length ? waiters.shift()(l) : queue.push(l)));
  const next = () => new Promise((res) => (queue.length ? res(queue.shift()) : waiters.push(res)));
  return { child, next };
}

test("stdio 适配器：stdout 只有 JSON-RPC，通知没有回应", async () => {
  const { child, next } = start("stdio.mjs", ["--persona", EXAMPLE]);
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    const a = JSON.parse(await next());
    const b = JSON.parse(await next());
    assert.equal(a.id, 1);
    assert.equal(a.result.serverInfo.name, "twinkit-zhou-yu");
    assert.equal(b.id, 2);
    assert.equal(b.result.tools.length, 4);
  } finally {
    child.kill();
  }
});

test("本地 HTTP 服务：MCP、落地页、拒绝外部 Origin", async () => {
  const { child, next } = start("serve.mjs", ["--port", "0", "--persona", EXAMPLE]);
  try {
    let base = null;
    while (!base) {
      const m = (await next()).match(/MCP 地址\s+(http:\/\/\S+)\/mcp/);
      if (m) base = m[1];
    }
    const init = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    assert.equal(init.status, 200);
    assert.equal((await init.json()).result.serverInfo.name, "twinkit-zhou-yu");
    const page = await fetch(`${base}/`, { headers: { accept: "text/html" } });
    assert.match(await page.text(), /周屿/);
    const evil = await fetch(`${base}/mcp`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(evil.status, 403);
  } finally {
    child.kill();
  }
});
