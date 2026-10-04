import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, BuildError } from "../scripts/build.mjs";
import { EXAMPLE, TEMPLATE, tmp, rpc } from "./helpers.mjs";

const quiet = () => {};

test("build：生成单文件 Worker、persona.json 和提示词包", async () => {
  const out = tmp();
  const r = await build({ personaDir: EXAMPLE, outDir: out, log: quiet });
  assert.equal(r.bundle.meta.name, "周屿");
  for (const f of ["worker.js", "persona.json", "prompt.md"]) assert.ok(existsSync(join(out, f)), f);
  const src = readFileSync(join(out, "worker.js"), "utf8");
  assert.doesNotMatch(src, /\/\*__TWIN_BUNDLE__\*\//);
  assert.doesNotMatch(src, /^export function createTwin/m, "Worker 里只保留 default 导出");
  assert.match(src, /^export default \{/m);
  assert.equal(JSON.parse(readFileSync(join(out, "persona.json"), "utf8")).format, "twinkit-persona/1");
  assert.match(readFileSync(join(out, "prompt.md"), "utf8"), /^# 周屿的数字分身 · 提示词包/);

  // 生成的 Worker 可以直接运行
  copyFileSync(join(out, "worker.js"), join(out, "worker.mjs"));
  const mod = await import(pathToFileURL(join(out, "worker.mjs")).href);
  assert.deepEqual(Object.keys(mod), ["default"]);
  const res = await mod.default.fetch(new Request("https://x.dev/mcp", { method: "POST", body: JSON.stringify(rpc("initialize")) }), { TWIN_PUBLIC: "true" }, {});
  assert.equal((await res.json()).result.serverInfo.name, "twinkit-zhou-yu");
});

test("build：人格包没通过检查时拒绝构建", async () => {
  await assert.rejects(build({ personaDir: TEMPLATE, outDir: tmp(), log: quiet }), (e) => e instanceof BuildError && /占位符/.test(e.message));
});
