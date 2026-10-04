import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validatePersona } from "../scripts/lib/validate.mjs";
import { EXAMPLE, TEMPLATE, copyExample, tmp } from "./helpers.mjs";

test("示例人格包通过检查，严格模式也通过", () => {
  const r = validatePersona(EXAMPLE);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.ok(validatePersona(EXAMPLE, { strict: true }).ok, JSON.stringify(validatePersona(EXAMPLE).warnings));
  assert.equal(r.stats.methods, 4);
});

test("空白模板不通过：每个文件都提示占位符，注释里的 {{…}} 不算", () => {
  const r = validatePersona(TEMPLATE);
  assert.equal(r.ok, false);
  const files = r.errors.filter((e) => /占位符/.test(e)).map((e) => e.split("：")[0]);
  assert.deepEqual(files.sort(), ["decisions/decision-1.md", "methods/method-1.md", "persona.md", "profile.md", "taste/taste-1.md", "voice/voice-1.md"].sort());
  const filled = copyExample();
  writeFileSync(join(filled, "methods", "x.md"), "# 方法\n- 关键词：a\n<!-- 把 {{…}} 换掉 -->\n## 步骤\n1. 做");
  assert.ok(validatePersona(filled).ok);
});

test("隐私扫描：手机号、身份证号、密钥是错误，邮箱是提醒", () => {
  const dir = copyExample();
  const p = join(dir, "profile.md");
  writeFileSync(p, readFileSync(p, "utf8") + "\n- 电话 13812345678\n- 身份证 110101199003077777\n- token ghp_abcdefghijklmnopqrstuvwxyz0123456789\n- 邮箱 someone@example.com\n");
  const r = validatePersona(dir);
  assert.equal(r.ok, false);
  const text = r.errors.join("\n");
  assert.match(text, /手机号/);
  assert.match(text, /身份证号/);
  assert.match(text, /密钥或令牌/);
  assert.doesNotMatch(text, /13812345678/, "报告里不回显完整号码");
  assert.match(r.warnings.join("\n"), /邮箱/);
});

test("结构问题：缺少 persona.md、缺少必需小节、披露语不合格", () => {
  assert.match(validatePersona(tmp()).errors[0], /persona\.md/);
  const dir = copyExample();
  writeFileSync(join(dir, "persona.md"), "# 某人\n- 姓名：某人\n- 披露：这是本人\n## 身份\n我是某人");
  const r = validatePersona(dir);
  const text = r.errors.join("\n");
  for (const s of ["决策原则", "禁区", "质量标准", "交付物", "披露语"]) assert.match(text, new RegExp(s));
});

test("严格模式把建议也当作错误", () => {
  const dir = copyExample();
  rmSync(join(dir, "taste"), { recursive: true });
  assert.ok(validatePersona(dir).ok);
  assert.equal(validatePersona(dir, { strict: true }).ok, false);
});
