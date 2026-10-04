#!/usr/bin/env node
// 本地 HTTP 服务：node scripts/serve.mjs [--port 8787] [--host 127.0.0.1] [--persona <目录>] [--token <令牌>]
// 每次请求都会重新读取人格包，改完文件刷新即可生效。
import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTwin } from "./lib/runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const port = Number(opt("port", process.env.PORT || 8787));
const host = opt("host", "127.0.0.1");
const personaDir = opt("persona", undefined);
const token = opt("token", process.env.TWIN_TOKEN || "");
const env = token ? { TWIN_PUBLIC: "false", TWIN_TOKEN: token } : { TWIN_PUBLIC: "true" };
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

// 启动时先检查一次，有错直接退出
const first = await loadTwin({ root, personaDir }).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
for (const w of first.warnings) console.error(`  ! ${w}`);

function headersOf(req) {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
  return h;
}

const server = createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && LOCAL.test(host) && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("forbidden origin");
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const hasBody = !["GET", "HEAD"].includes(req.method) && chunks.length;
    const request = new Request(`http://${req.headers.host || `${host}:${port}`}${req.url}`, {
      method: req.method,
      headers: headersOf(req),
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const { twin } = await loadTwin({ root, personaDir });
    const response = await twin.fetch(request, env, { waitUntil() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(e && e.message ? e.message : e));
  }
});
server.listen(port, host, () => {
  const base = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.address().port}`;
  console.log(`TwinKit 本地分身：${first.twin.persona.meta.name}${first.example ? "（示例）" : ""}`);
  console.log(`  MCP 地址   ${base}/mcp${token ? "（需要令牌）" : ""}`);
  console.log(`  浏览器打开 ${base}/`);
  console.log(`  Claude Code：claude mcp add --transport http ${first.twin.persona.meta.handle} ${base}/mcp`);
});
