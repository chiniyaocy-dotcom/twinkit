import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdown, parseList, parseDeliverables, loadPersona, defaultPersonaDir, splitTerms, slugify, FORMAT } from "../scripts/lib/persona.mjs";
import { EXAMPLE, ROOT, tmp } from "./helpers.mjs";

test("parseMarkdown：标题、元信息、小节；代码块里的 # 不算标题；注释被去掉", () => {
  const doc = parseMarkdown(`\uFEFF# 标题\r\n- 关键词：a、b\n- Keywords: c, d\n<!-- 说明\n多行 -->\n介绍\n\n## 小节一\n内容\n\`\`\`\n## 不是标题\n\`\`\`\n## 小节二\n- x`);
  assert.equal(doc.title, "标题");
  assert.equal(doc.meta["关键词"], "a、b");
  assert.equal(doc.meta["Keywords"], "c, d");
  assert.equal(doc.intro, "介绍");
  assert.deepEqual(doc.sections.map((s) => s.title), ["小节一", "小节二"]);
  assert.match(doc.sections[0].body, /## 不是标题/);
  assert.doesNotMatch(JSON.stringify(doc), /说明/);
});

test("parseMarkdown：未知的“- 键：值”不当作元信息", () => {
  const doc = parseMarkdown("# T\n- 关键词：k\n- 城市：杭州\n## S\nx");
  assert.deepEqual(Object.keys(doc.meta), ["关键词"]);
  assert.match(doc.intro, /城市：杭州/);
});

test("parseList：有序/无序列表、续行、没有列表时按行", () => {
  assert.deepEqual(parseList("1. 一\n2) 二\n   续行\n3、三\n- 四"), ["一", "二 续行", "三", "四"]);
  assert.deepEqual(parseList("第一条\n第二条"), ["第一条", "第二条"]);
  assert.deepEqual(parseList(""), []);
});

test("parseDeliverables：别名、默认、单行用 / 分隔、“名称：说明”", () => {
  const ds = parseDeliverables("### 方案（plan, 默认）\n- 结论：一句话\n- 背景\n### 周报 (weekly report、周汇报)\n结论 / 数据 / 下周动作");
  assert.equal(ds.length, 2);
  assert.deepEqual(ds[0], { name: "方案", aliases: ["plan"], default: true, sections: [{ name: "结论", hint: "一句话" }, { name: "背景", hint: "" }] });
  assert.deepEqual(ds[1].aliases, ["weekly report", "周汇报"]);
  assert.deepEqual(ds[1].sections.map((s) => s.name), ["结论", "数据", "下周动作"]);
  const noDefault = parseDeliverables("### A\n- x\n### B\n- y");
  assert.equal(noDefault[0].default, true);
});

test("示例人格包可以完整解析", () => {
  const b = loadPersona(EXAMPLE);
  assert.equal(b.format, FORMAT);
  assert.equal(b.meta.name, "周屿");
  assert.equal(b.meta.handle, "zhou-yu");
  assert.equal(b.meta.fictional, true);
  assert.match(b.meta.disclosure, /虚构/);
  assert.equal(b.principles.length, 8);
  assert.ok(b.prohibitions.length >= 3);
  assert.deepEqual(b.deliverables.map((d) => d.name), ["方案", "周报", "复盘", "通知"]);
  assert.equal(b.deliverables.find((d) => d.default).name, "方案");
  assert.equal(b.cards.methods.length, 4);
  assert.equal(b.cards.decisions.length, 3);
  assert.ok(b.cards.decisions.every((c) => c.meta.date && c.keywords.length));
  assert.ok(b.profile && b.profile.sections.some((s) => s.title === "经历"));
});

test("以 _ 开头的文件和 README.md 不会被当作卡片；英文小节名也能识别", () => {
  const dir = join(tmp(), "p");
  mkdirSync(join(dir, "methods"), { recursive: true });
  writeFileSync(join(dir, "persona.md"), "# Alice\n- Name: Alice\n- Role: PM\n## Principles\n- Ship small\n## Never\n- No fake data\n## Quality bar\n- Clear\n## Deliverables\n### Spec (default)\n- Goal\n- Plan\n## Goals\nGrow");
  writeFileSync(join(dir, "methods", "_draft.md"), "# draft");
  writeFileSync(join(dir, "methods", "README.md"), "# readme");
  writeFileSync(join(dir, "methods", "ok.md"), "# Real\n- Tags: a, b\n## Steps\n1. x");
  const b = loadPersona(dir);
  assert.equal(b.meta.name, "Alice");
  assert.equal(b.meta.role, "PM");
  assert.deepEqual(b.principles, ["Ship small"]);
  assert.deepEqual(b.prohibitions, ["No fake data"]);
  assert.equal(b.deliverables[0].name, "Spec");
  assert.equal(b.goals, "Grow");
  assert.deepEqual(b.cards.methods.map((c) => c.id), ["method/ok"]);
  assert.deepEqual(b.cards.methods[0].keywords, ["a", "b"]);
});

test("工具函数", () => {
  assert.deepEqual(splitTerms("a、b，c, d;e/f|a"), ["a", "b", "c", "d", "e", "f"]);
  assert.equal(slugify("Zhou Yu!"), "zhou-yu");
  assert.equal(slugify("周屿"), "twin");
  const d = defaultPersonaDir(ROOT);
  assert.ok(d.dir.endsWith("persona") || d.example);
});
