import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEntry, loadEntries, summarize, ACTIVE_DAYS_THRESHOLD } from "../scripts/gallery-check.mjs";

const good = {
  handle: "alice",
  name: "Alice",
  role: "产品经理",
  endpoint: "https://alice-twin.example.workers.dev/mcp",
  pack: "private",
  owner: "alice-gh",
  consent: { owner_is_subject: true, ai_disclosure: true, date: "2026-10-01" },
};

test("仓库里的 Gallery 条目都合法", () => {
  const entries = loadEntries();
  assert.ok(entries.length >= 1);
  for (const e of entries) assert.deepEqual(e.errors, [], e.file);
});

test("合法条目通过，各种不合规的写法被拒绝", () => {
  assert.deepEqual(checkEntry(good, "gallery/entries/alice.json"), []);
  const bad = (patch, re, file) => {
    const errs = checkEntry({ ...good, ...patch }, file);
    assert.ok(errs.some((e) => re.test(e)), `${JSON.stringify(patch)} → ${errs.join(" | ")}`);
  };
  bad({ handle: "Alice!" }, /handle/);
  bad({}, /文件名/, "gallery/entries/bob.json");
  bad({ endpoint: "http://x.dev/mcp" }, /https/);
  bad({ endpoint: "https://x.dev/t/secret/mcp" }, /令牌/);
  bad({ endpoint: "https://x.dev/mcp?token=1" }, /令牌/);
  bad({ endpoint: "https://x.dev/" }, /\/mcp/);
  bad({ consent: undefined }, /consent/);
  bad({ consent: { ...good.consent, owner_is_subject: false } }, /本人/);
  bad({ consent: { ...good.consent, fictional: true } }, /虚构/);
  bad({ consent: { ...good.consent, ai_disclosure: false } }, /AI/);
  bad({ pack: "ftp://x" }, /pack/);
  bad({ eval: { report: "http://x" } }, /eval/);
  assert.deepEqual(checkEntry({ ...good, demo: true, consent: { fictional: true, ai_disclosure: true, date: "2026-10-01" } }), []);
});

test("目标统计只算本人提交、在线、且活跃天数达标的分身", () => {
  const entries = [
    { entry: { ...good, handle: "a" }, errors: [] },
    { entry: { ...good, handle: "b" }, errors: [] },
    { entry: { ...good, handle: "c", eval: { report: "https://r" } }, errors: [] },
    { entry: { ...good, handle: "d", demo: true }, errors: [] },
    { entry: { ...good, handle: "e" }, errors: ["x"] },
  ];
  const probes = {
    a: { mcp: true, active_days_28d: ACTIVE_DAYS_THRESHOLD },
    b: { mcp: true, active_days_28d: 2 },
    c: { mcp: false },
    d: { mcp: true, active_days_28d: 28 },
  };
  assert.deepEqual(summarize(entries, probes), { real_packs: 3, real_packs_online: 2, active_twins: 1, evaluated: 1 });
});
