import { fileURLToPath } from "node:url";
import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const EXAMPLE = join(ROOT, "examples", "zhou-yu");
export const TEMPLATE = join(ROOT, "templates", "persona");

export function tmp(prefix = "twinkit-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function copyExample() {
  const dir = join(tmp(), "persona");
  cpSync(EXAMPLE, dir, { recursive: true });
  return dir;
}

export const rpc = (method, params = {}, id = 1) => ({ jsonrpc: "2.0", id, method, params });

export async function call(twin, body, { env = { TWIN_PUBLIC: "true" }, headers = {}, path = "/mcp", method = "POST", ctx } = {}) {
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (method === "POST") init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await twin.fetch(new Request(`https://twin.example${path}`, init), env, ctx || { waitUntil() {} });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* html/markdown */ }
  return { status: res.status, headers: res.headers, text, json };
}

export function kvStub() {
  const store = new Map();
  const kv = {
    puts: 0,
    gets: 0,
    async get(k) { kv.gets++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { kv.puts++; store.set(k, v); },
    store,
  };
  return kv;
}
