import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { createTwin } from "../engine/worker.template.js";
import { loadPersona } from "../scripts/lib/persona.mjs";
import { EXAMPLE, rpc, call, kvStub } from "./helpers.mjs";

const bundle = loadPersona(EXAMPLE);
const fresh = () => createTwin(bundle);
const TOKEN_ENV = { TWIN_TOKEN: "s3cret-token" };

test("initialize：协议版本协商、serverInfo、说明", async () => {
  const twin = fresh();
  for (const [asked, got] of [["2025-06-18", "2025-06-18"], ["2025-03-26", "2025-03-26"], ["2024-11-05", "2024-11-05"], ["2099-01-01", "2025-06-18"], [undefined, "2025-06-18"]]) {
    const r = await call(twin, rpc("initialize", { protocolVersion: asked, capabilities: {}, clientInfo: { name: "t", version: "1" } }));
    assert.equal(r.status, 200);
    assert.equal(r.json.result.protocolVersion, got);
  }
  const r = await call(twin, rpc("initialize", {}));
  assert.equal(r.json.result.serverInfo.name, "twinkit-zhou-yu");
  assert.ok(r.json.result.capabilities.tools && r.json.result.capabilities.prompts && r.json.result.capabilities.resources);
  assert.match(r.json.result.instructions, /work_brief/);
  assert.match(r.json.result.instructions, /虚构/);
});

test("tools/list：4 个只读工具", async () => {
  const r = await call(fresh(), rpc("tools/list"));
  const tools = r.json.result.tools;
  assert.deepEqual(tools.map((t) => t.name), ["work_brief", "review", "find_examples", "get_profile"]);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
    assert.equal(t.inputSchema.type, "object");
  }
  assert.deepEqual(tools[0].inputSchema.required, ["task"]);
  assert.match(tools[0].description, /方案、周报、复盘、通知/);
});

test("work_brief：按任务调出对应的方法、案例、品味和语气", () => {
  const twin = fresh();
  const u1 = twin.brief({ task: "下周新店开业，帮我写开业首月的冲量方案" }).used;
  assert.equal(u1.deliverable, "方案");
  assert.equal(u1.deliverable_match, "detected");
  assert.ok(u1.methods.includes("method/new-store-30-days"));
  const u2 = twin.brief({ task: "竞品在搞 9.9 元活动，加盟商要我们跟进降价" }).used;
  assert.equal(u2.decisions[0], "decision/2025-06-no-price-war");
  const u3 = twin.brief({ task: "写本周的周报" }).used;
  assert.equal(u3.deliverable, "周报");
  assert.ok(u3.taste.includes("taste/weekly-report"));
  const u4 = twin.brief({ task: "给店长发个通知，周末开学要备货" }).used;
  assert.equal(u4.deliverable, "通知");
  assert.deepEqual(u4.voice, ["voice/to-store-managers"]);
  const u5 = twin.brief({ task: "随便聊聊", deliverable: "复盘" }).used;
  assert.equal(u5.deliverable, "复盘");
  assert.equal(u5.deliverable_match, "explicit");
  assert.deepEqual(u5.voice, ["voice/to-boss"], "没有匹配时使用默认语气");
  assert.equal(twin.brief({ task: "随便聊聊" }).used.decisions.length, 0, "不相关的案例不应该被调出");
});

test("work_brief：简报包含角色锁定、结构、原则、自检和禁区", () => {
  const b = fresh().brief({ task: "国庆活动方案", deliverable: "诗歌", context: "预算 30 万" });
  for (const h of ["## 任务", "## 角色锁定", "## 交付物结构：方案", "## 决策原则", "## 相关方法", "## 交付前自检", "## 禁区（不能做）"]) assert.ok(b.text.includes(h), h);
  assert.match(b.text, /没有「诗歌」这种交付物/);
  assert.match(b.text, /预算 30 万/);
  assert.match(b.text, /虚构人物/);
  assert.match(b.text, /不要编造数据/);
  assert.equal(b.used.deliverable_match, "unknown-explicit");
});

test("tools/call：参数校验返回 isError，而不是协议错误", async () => {
  const twin = fresh();
  const missing = await call(twin, rpc("tools/call", { name: "work_brief", arguments: {} }));
  assert.equal(missing.json.result.isError, true);
  assert.match(missing.json.result.content[0].text, /task/);
  const badEnum = await call(twin, rpc("tools/call", { name: "find_examples", arguments: { query: "x", kind: "poem" } }));
  assert.equal(badEnum.json.result.isError, true);
  const tooLong = await call(twin, rpc("tools/call", { name: "work_brief", arguments: { task: "x".repeat(5000) } }));
  assert.equal(tooLong.json.result.isError, true);
  const unknown = await call(twin, rpc("tools/call", { name: "nope", arguments: {} }));
  assert.equal(unknown.json.error.code, -32602);
  const ok = await call(twin, rpc("tools/call", { name: "work_brief", arguments: { task: "写周报" } }));
  assert.equal(ok.json.result.isError, undefined);
  assert.match(ok.json.result.content[0].text, /^# 工作简报/);
});

test("review：缺结构、越权、禁用词、没口径的数字", () => {
  const twin = fresh();
  const r = twin.review({ draft: "# 国庆方案\n我保证杯量提升 30%，稳赚。\n我们要赋能门店。\n预算 50 万元。", deliverable: "方案" });
  assert.equal(r.deliverable, "方案");
  const all = [...r.must, ...r.should].join("\n");
  assert.match(all, /缺少「方案」要求的部分/);
  assert.match(all, /以本人名义作出承诺/);
  assert.match(all, /「赋能」/);
  assert.match(all, /没有写口径或来源/);
  assert.match(all, /绝对化/);
});

test("review：结构完整、有口径的稿子没有必须修改项", () => {
  const draft = `## 结论
建议国庆只做会员第二杯半价，预算 30 万元，目标新增会员 2 万。
## 背景与目标
去年国庆全场 8 折，杯量 +18%（口径：收银系统，华东 120 家）。
## 关键动作
- 9/20 前：区域经理确认参与门店名单。
## 资源与预算
会员券预算 30 万元（来源：活动预算表）。
## 风险与预案
- 券被集中领取：设置每人限领 1 张。
## 衡量指标与复盘时间
- 10/10 复盘新增会员数和活动后两周的复购。
## 需要的支持
- 市场部支持海报物料。`;
  const r = fresh().review({ draft, deliverable: "方案" });
  assert.deepEqual(r.must, []);
  assert.ok(!r.should.some((s) => /结论没有放在最前面/.test(s)));
});

test("find_examples 与 get_profile", async () => {
  const twin = fresh();
  const hit = await call(twin, rpc("tools/call", { name: "find_examples", arguments: { query: "价格战", kind: "decision" } }));
  assert.match(hit.json.result.content[0].text, /不跟进 9\.9 元价格战/);
  const miss = await call(twin, rpc("tools/call", { name: "find_examples", arguments: { query: "量子计算" } }));
  assert.match(miss.json.result.content[0].text, /没有找到/);
  const prof = await call(twin, rpc("tools/call", { name: "get_profile", arguments: {} }));
  const text = prof.json.result.content[0].text;
  for (const s of ["# 周屿 · 连锁茶饮品牌运营总监", "## 经历", "## 决策原则", "## 知识库"]) assert.ok(text.includes(s), s);
});

test("prompts 与 resources", async () => {
  const twin = fresh();
  const list = await call(twin, rpc("prompts/list"));
  assert.equal(list.json.result.prompts[0].name, "work_as_twin");
  const got = await call(twin, rpc("prompts/get", { name: "work_as_twin", arguments: { task: "写周报" } }));
  assert.equal(got.json.result.messages[0].role, "user");
  assert.match(got.json.result.messages[0].content.text, /工作简报/);
  const noTask = await call(twin, rpc("prompts/get", { name: "work_as_twin", arguments: {} }));
  assert.equal(noTask.json.error.code, -32602);
  const res = await call(twin, rpc("resources/list"));
  assert.deepEqual(res.json.result.resources.map((r) => r.uri), ["twin://profile", "twin://prompt-pack"]);
  const read = await call(twin, rpc("resources/read", { uri: "twin://prompt-pack" }));
  assert.match(read.json.result.contents[0].text, /提示词包/);
  const none = await call(twin, rpc("resources/read", { uri: "twin://nope" }));
  assert.equal(none.json.error.code, -32002);
  const tpl = await call(twin, rpc("resources/templates/list"));
  assert.deepEqual(tpl.json.result.resourceTemplates, []);
});

test("JSON-RPC：ping、未知方法、通知、批量、解析错误", async () => {
  const twin = fresh();
  assert.deepEqual((await call(twin, rpc("ping"))).json.result, {});
  assert.equal((await call(twin, rpc("nope/nope"))).json.error.code, -32601);
  const note = await call(twin, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  assert.equal(note.text, "");
  const batch = await call(twin, [rpc("ping", {}, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", {}, 2)]);
  assert.deepEqual(batch.json.map((x) => x.id), [1, 2]);
  assert.equal((await call(twin, [])).status, 400);
  const bad = await call(twin, "{not json");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, -32700);
  assert.equal((await call(twin, { id: 1, method: "ping" })).json.error.code, -32600);
  assert.equal((await call(twin, { jsonrpc: "2.0", id: 9, result: {} })).status, 202);
});

test("访问控制：公开、令牌（Bearer / 头 / 路径）、未配置", async () => {
  const twin = fresh();
  const body = rpc("ping");
  assert.equal((await call(twin, body, { env: { TWIN_PUBLIC: " TRUE " } })).status, 200);
  assert.equal((await call(twin, body, { env: {} })).status, 503);
  assert.equal((await call(twin, body, { env: TOKEN_ENV })).status, 401);
  assert.equal((await call(twin, body, { env: TOKEN_ENV, headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await call(twin, body, { env: TOKEN_ENV, headers: { authorization: "Bearer s3cret-token" } })).status, 200);
  assert.equal((await call(twin, body, { env: TOKEN_ENV, headers: { "x-twin-token": "s3cret-token" } })).status, 200);
  assert.equal((await call(twin, body, { env: TOKEN_ENV, path: "/t/s3cret-token/mcp" })).status, 200);
  assert.equal((await call(twin, body, { env: { TWIN_PUBLIC: "false", ...TOKEN_ENV }, path: "/t/s3cret-token/mcp" })).status, 200);
  assert.equal((await call(twin, null, { env: TOKEN_ENV, method: "GET", path: "/prompt.md" })).status, 401);
});

test("HTTP 路由：GET /mcp、浏览器落地页、健康检查、.well-known、CORS、提示词包", async () => {
  const twin = fresh();
  const get = await call(twin, null, { method: "GET" });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");
  const html = await call(twin, null, { method: "GET", path: "/", headers: { accept: "text/html" } });
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /text\/html/);
  assert.match(html.text, /周屿/);
  assert.match(html.text, /claude mcp add --transport http zhou-yu https:\/\/twin\.example\/mcp/);
  const privateHtml = await call(twin, null, { method: "GET", path: "/mcp", headers: { accept: "text/html" }, env: TOKEN_ENV });
  assert.doesNotMatch(privateHtml.text, /周屿/);
  const info = await call(twin, null, { method: "GET", path: "/" });
  assert.equal(info.json.mcp, "https://twin.example/mcp");
  const health = await call(twin, null, { method: "GET", path: "/health" });
  assert.deepEqual([health.json.ok, health.json.server, health.json.auth, health.json.persona], [true, "twinkit", "none", "zhou-yu"]);
  const privateHealth = await call(twin, null, { method: "GET", path: "/health", env: TOKEN_ENV });
  assert.equal(privateHealth.json.auth, "token");
  assert.equal(privateHealth.json.name, undefined);
  assert.equal((await call(twin, null, { method: "GET", path: "/.well-known/oauth-protected-resource" })).status, 404);
  assert.equal((await call(twin, null, { method: "GET", path: "/nope" })).status, 404);
  const pre = await call(twin, null, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-headers"), /Mcp-Protocol-Version/);
  const pack = await call(twin, null, { method: "GET", path: "/prompt.md" });
  assert.equal(pack.status, 200);
  assert.match(pack.text, /^# 周屿的数字分身 · 提示词包/);
});

test("落地页会转义人格包里的 HTML", async () => {
  const evil = structuredClone(bundle);
  evil.meta.name = '<img src=x onerror="alert(1)">';
  evil.meta.tagline = "<script>alert(1)</script>";
  const r = await call(createTwin(evil), null, { method: "GET", path: "/", headers: { accept: "text/html" } });
  assert.doesNotMatch(r.text, /<img src=x/);
  assert.doesNotMatch(r.text, /<script>alert/);
});

test("限流：超过限制返回 429；限流器出错时放行", async () => {
  const twin = fresh();
  const deny = await call(twin, rpc("ping"), { env: { TWIN_PUBLIC: "true", TWIN_RATE_LIMITER: { limit: async () => ({ success: false }) } } });
  assert.equal(deny.status, 429);
  assert.equal(deny.headers.get("retry-after"), "60");
  const broken = await call(twin, rpc("ping"), { env: { TWIN_PUBLIC: "true", TWIN_RATE_LIMITER: { limit: async () => { throw new Error("x"); } } } });
  assert.equal(broken.status, 200);
});

test("活跃天数统计：只记工具调用，每天最多写一次，默认不公开", async () => {
  const twin = fresh();
  const kv = kvStub();
  const env = { TWIN_PUBLIC: "true", TWIN_STATS: kv };
  await call(twin, rpc("tools/list"), { env });
  assert.equal(kv.puts, 0);
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  await call(twin, rpc("tools/call", { name: "get_profile", arguments: {} }), { env, ctx });
  await Promise.all(pending);
  await call(twin, rpc("tools/call", { name: "get_profile", arguments: {} }), { env });
  assert.equal(kv.puts, 1);
  const days = JSON.parse(kv.store.get("active_days"));
  assert.deepEqual(days, [new Date().toISOString().slice(0, 10)]);
  const hidden = await call(twin, null, { method: "GET", path: "/health", env });
  assert.equal(hidden.json.active_days_28d, undefined);
  kv.store.set("active_days", JSON.stringify(["2000-01-01", ...days]));
  const shown = await call(twin, null, { method: "GET", path: "/health", env: { ...env, TWIN_PUBLIC_STATS: "true" } });
  assert.equal(shown.json.active_days_28d, 1);
});

test("请求体过大返回 413", async () => {
  const r = await call(fresh(), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { x: "x".repeat(1_100_000) } }));
  assert.equal(r.status, 413);
});

test("无效人格包和未构建的模板", async () => {
  assert.throws(() => createTwin({}), /无效的人格包/);
  const res = await worker.fetch(new Request("https://x/mcp", { method: "POST", body: "{}" }), {}, {});
  assert.equal(res.status, 500);
  assert.match(await res.text(), /npm run build/);
});

test("提示词包包含全部方法和工作流程", () => {
  const text = fresh().promptPack();
  for (const s of ["## 你的角色", "## 决策原则", "## 交付物结构", "### 方案（默认）", "## 方法库", "## 真实决策案例", "## 工作流程"]) assert.ok(text.includes(s), s);
  for (const c of bundle.cards.methods) assert.ok(text.includes(c.title), c.title);
});
