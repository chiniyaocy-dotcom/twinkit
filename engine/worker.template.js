/*!
 * TwinKit engine v0.1.0 · MIT License · https://github.com/chiniyaocy-dotcom/twinkit
 *
 * 这是模板文件。`npm run build` 会把人格包（persona/）注入下面的 PERSONA，
 * 生成单文件 dist/worker.js：可以直接部署到 Cloudflare Workers，
 * 也可以用 scripts/serve.mjs（本地 HTTP）或 scripts/stdio.mjs（本地 stdio）运行。
 *
 * 协议：MCP Streamable HTTP（无状态 JSON 响应），兼容 2025-06-18 / 2025-03-26 / 2024-11-05。
 */
const PERSONA = /*__TWIN_BUNDLE__*/ null;

const ENGINE_VERSION = "0.1.0";
const REPO_URL = "https://github.com/chiniyaocy-dotcom/twinkit";
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 1_000_000;
const KINDS = ["method", "decision", "taste", "voice"];
const KIND_LABEL = { method: "方法", decision: "决策案例", taste: "品味", voice: "表达风格", any: "方法与案例" };
const KIND_DIR = { method: "methods", decision: "decisions", taste: "taste", voice: "voice" };

// ---------------------------------------------------------------- 文本工具
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const WORD = /[a-z0-9][a-z0-9+#._-]*/g;
const STOP = new Set([
  "一个", "一份", "一下", "我们", "你们", "他们", "怎么", "如何", "需要", "可以", "这个", "那个", "进行",
  "以及", "还是", "就是", "什么", "为什么", "没有", "不是", "如果", "因为", "所以", "帮我", "给我", "请你",
  "写一", "做一", "的是", "了一", "是否", "有没", "一些", "the", "and", "for", "with", "how", "what",
]);

function norm(s) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function grams(s) {
  const t = norm(s);
  const out = new Set();
  for (const w of t.match(WORD) || []) if (w.length >= 2) out.add(w);
  for (const run of t.match(CJK_RUN) || []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 中文直接包含；纯英文按单词边界匹配（避免 plan 命中 explanation）。 */
function containsTerm(normText, term) {
  const t = norm(term);
  if (!t) return false;
  if (/^[\x00-\x7f]+$/.test(t)) return new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}($|[^a-z0-9])`).test(normText);
  return normText.includes(t);
}

function clip(s, n) {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function numbered(items) {
  return items.map((x, i) => `${i + 1}. ${x}`).join("\n");
}

function bullets(items) {
  return items.map((x) => `- ${x}`).join("\n");
}

function truthy(v) {
  return /^(是|对|true|yes|y|1)$/i.test(String(v ?? "").trim());
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** 中文名字两侧不加空格；英文名字两侧加空格（“按 Alice 的”/“按周屿的”）。 */
function pad(s) {
  const t = String(s ?? "");
  return `${/^[A-Za-z0-9]/.test(t) ? " " : ""}${t}${/[A-Za-z0-9.)]$/.test(t) ? " " : ""}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- 审稿规则
const OVERREACH = [
  { level: "must", re: /我(?:在此|可以|会)?(?:保证|承诺|担保)/, why: "以本人名义作出承诺" },
  { level: "must", re: /(?:已经?|业已)(?:批准|审批通过|签字|签署|同意(?:付款|采购|报价|合作|签约))/, why: "声称已经审批或签署" },
  { level: "must", re: /代表(?:公司|本人|我司|集团|管理层)/, why: "代表本人或公司表态" },
  { level: "must", re: /\b(?:I|we)\s+(?:hereby\s+)?(?:promise|guarantee)\b|\b(?:I have|I've)\s+approved\b/i, why: "commitment or approval on the owner's behalf" },
  { level: "should", re: /(?:保证|一定能|一定会|必然|肯定能|肯定会)[^，。；;\n]{0,12}(?:增长|提升|翻倍|回本|盈利|达成|成功|做到)/, why: "对结果作了绝对化保证" },
  { level: "should", re: /稳赚|零风险|万无一失|100\s*[%％]\s*(?:成功|有效|达成|没问题)/, why: "绝对化表述" },
];
const NUM_RE = /\d+(?:\.\d+)?\s*(?:%|％|万|亿|元|块钱|单|杯|人次|个百分点|pp\b|倍|家)/i;
const SOURCE_RE = /口径|来源|出处|根据|统计|截至|截止|测算|估算|预估|预计|假设|目标|待确认|待补|参考|source|assum|estimate|target/i;
const LEAD_RE = /结论|摘要|summary|tl;?dr|bottom line|一句话|核心观点|先说/i;

// ---------------------------------------------------------------- 分身
export function createTwin(persona) {
  if (!persona || persona.format !== "twinkit-persona/1") {
    throw new Error("TwinKit: 无效的人格包（format 应为 twinkit-persona/1，请先运行 npm run build）");
  }
  const P = persona;
  const M = P.meta;
  const NAME = pad(M.name);
  const WHO = pad(M.role ? `${M.name}（${M.role}）` : M.name);
  const byKind = {};
  for (const k of KINDS) byKind[k] = (P.cards && P.cards[KIND_DIR[k]]) || [];
  const allCards = KINDS.flatMap((k) => byKind[k]);
  const index = new Map();
  const df = new Map();
  for (const c of allCards) {
    const body = [c.title, c.intro, ...c.sections.map((s) => `${s.title}\n${s.body}`)].join("\n");
    const ix = { kw: (c.keywords || []).filter(Boolean), tg: grams(c.title), bg: grams(body) };
    index.set(c, ix);
    for (const g of ix.bg) df.set(g, (df.get(g) || 0) + 1);
  }
  // 越少见的词权重越高：“门店”这种几乎每张卡都有的词几乎不加分
  const idf = (g) => Math.log((allCards.length + 1) / ((df.get(g) || 0) + 0.5));
  const banned = collectBanned();
  const defaultDeliverable = P.deliverables.find((d) => d.default) || P.deliverables[0] || null;
  let lastActiveDay = null;

  function collectBanned() {
    const sources = P.prohibitions.map((text) => ({ text, from: "禁区" }));
    for (const v of byKind.voice) {
      for (const s of v.sections) if (/避免|不说|不用|禁用|avoid|never|don't/i.test(s.title)) sources.push({ text: s.body, from: v.title });
    }
    const out = [];
    const seen = new Set();
    for (const s of sources) {
      for (const m of s.text.matchAll(/[“"「『]([^”"」』\n]{1,16})[”"」』]/g)) {
        const term = m[1].trim();
        if (term && !seen.has(term)) { seen.add(term); out.push({ term, from: s.from }); }
      }
    }
    return out;
  }

  function score(card, q, qg) {
    const ix = index.get(card);
    let s = 0;
    for (const k of ix.kw) if (containsTerm(q, k)) s += 3 + Math.min(norm(k).length, 8) * 0.25;
    let t = 0;
    for (const g of ix.tg) if (!STOP.has(g) && qg.has(g)) t += idf(g);
    s += Math.min(t, 6) * 0.8;
    let b = 0;
    for (const g of qg) if (!STOP.has(g) && ix.bg.has(g)) b += idf(g);
    s += Math.min(b, 16) * 0.12;
    return s;
  }

  function rank(kind, query, limit, min = 1) {
    const q = norm(query);
    const qg = grams(query);
    const list = kind === "any" ? allCards : byKind[kind] || [];
    return list
      .map((c) => ({ c, s: score(c, q, qg) }))
      .filter((x) => x.s >= min)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.c);
  }

  function findDeliverable(name) {
    const n = norm(name);
    if (!n) return null;
    const ds = P.deliverables;
    return (
      ds.find((d) => norm(d.name) === n || d.aliases.some((a) => norm(a) === n)) ||
      ds.find((d) => n.includes(norm(d.name)) || norm(d.name).includes(n) || d.aliases.some((a) => containsTerm(n, a))) ||
      null
    );
  }

  function detectDeliverable(text) {
    const t = norm(text);
    let best = null;
    let bestLen = 0;
    for (const d of P.deliverables) {
      for (const term of [d.name, ...d.aliases]) {
        const tt = norm(term);
        if (tt && containsTerm(t, tt) && tt.length > bestLen) { best = d; bestLen = tt.length; }
      }
    }
    return best;
  }

  function resolveDeliverable(explicit, text) {
    if (!P.deliverables.length) return { d: null, how: "none" };
    if (explicit) {
      const d = findDeliverable(explicit);
      if (d) return { d, how: "explicit" };
    }
    const auto = detectDeliverable(text);
    if (auto) return { d: auto, how: explicit ? "unknown-explicit" : "detected" };
    return { d: defaultDeliverable, how: explicit ? "unknown-explicit" : "default" };
  }

  function howNote(how, explicit) {
    if (how === "detected") return "（根据任务自动判断）";
    if (how === "default") return "（默认结构）";
    if (how === "unknown-explicit") return `（没有「${clip(explicit, 20)}」这种交付物，已改用最接近的结构）`;
    return "";
  }

  function renderCard(c, { max = 1600, level = 3 } = {}) {
    const parts = [`${"#".repeat(level)} ${c.title}`];
    const bits = [];
    if (c.meta && c.meta.date) bits.push(`时间：${c.meta.date}`);
    if (c.meta && c.meta.when) bits.push(`适用：${c.meta.when}`);
    if (c.meta && c.meta.scene) bits.push(`场景：${c.meta.scene}`);
    if (bits.length) parts.push(`*${bits.join(" · ")}*`);
    if (c.intro) parts.push(c.intro);
    for (const s of c.sections) parts.push(`**${s.title}**\n${s.body}`);
    let out = parts.join("\n\n");
    if (out.length > max) {
      out = out.slice(0, max).replace(/\n[^\n]*$/, "") + `\n\n…（已截断，完整内容用 find_examples 查询「${c.title}」）`;
    }
    return out;
  }

  function roleLock() {
    return [
      `你现在按${WHO}的工作方式完成这项任务：用 TA 的决策原则做取舍，用 TA 的方法推进，用 TA 的品味判断好坏，用 TA 的风格表达。`,
      M.tagline ? `关于${NAME.trimEnd()}：${M.tagline}` : "",
      "- 缺少的信息用「【待确认：…】」标出，不要编造数据、事实、人名或承诺。",
      `- 这是工作稿：不要以${NAME}本人的名义对外承诺、签署、审批、付款或发布。`,
      "- 如果任务和下面的禁区冲突，先指出冲突，再给出合规的替代做法。",
    ].filter(Boolean).join("\n");
  }

  function checklist(d) {
    const items = [...P.quality];
    if (d && d.sections.length) items.push(`包含「${d.name}」的全部部分：${d.sections.map((s) => s.name).join("、")}`);
    items.push("关键数字写明口径或来源；没有数据就标【待确认】，不编造");
    items.push("没有触碰禁区，没有替本人承诺或审批");
    return items.map((x) => `- [ ] ${x}`).join("\n");
  }

  function deliverableBlock(d) {
    return d.sections.map((s, i) => `${i + 1}. **${s.name}**${s.hint ? `：${s.hint}` : ""}`).join("\n");
  }

  function brief({ task, deliverable = "", context = "" }) {
    const { d, how } = resolveDeliverable(deliverable, task);
    const query = `${task}\n${context || ""}`;
    const methods = rank("method", query, 3, 1.5);
    const decisions = rank("decision", query, 2, 1.5);
    const styleQuery = `${query}\n${d ? [d.name, ...d.aliases].join(" ") : ""}`;
    const taste = rank("taste", styleQuery, 2, 1);
    let voice = rank("voice", styleQuery, 1, 1);
    if (!voice.length && byKind.voice.length) voice = [byKind.voice.find((v) => truthy(v.meta && v.meta.default)) || byKind.voice[0]];

    const out = [];
    out.push(`# 工作简报 · 按「${M.name}」的方式完成任务`);
    out.push(`> ${M.disclosure}${M.snapshot ? `（人格包快照：${M.snapshot}）` : ""}`);
    out.push(`## 任务\n${String(task).trim()}${context && context.trim() ? `\n\n**背景**\n${context.trim()}` : ""}`);
    out.push(`## 角色锁定\n${roleLock()}`);
    if (d) out.push(`## 交付物结构：${d.name}${howNote(how, deliverable)}\n${deliverableBlock(d)}`);
    if (P.principles.length) out.push(`## 决策原则\n${numbered(P.principles)}`);
    if (methods.length) out.push(`## 相关方法\n\n${methods.map((c) => renderCard(c)).join("\n\n")}`);
    else out.push(`## 相关方法\n没有找到直接相关的方法卡：按上面的决策原则和交付物结构来做，并在结尾列出需要${NAME}本人确认的关键判断。`);
    if (decisions.length) out.push(`## 可参考的真实决策\n\n${decisions.map((c) => renderCard(c, { max: 1200 })).join("\n\n")}`);
    if (taste.length) out.push(`## 品味：什么是好的\n\n${taste.map((c) => renderCard(c, { max: 1200 })).join("\n\n")}`);
    if (voice.length) out.push(`## 表达风格\n\n${voice.map((c) => renderCard(c, { max: 1000 })).join("\n\n")}`);
    out.push(`## 交付前自检\n${checklist(d)}`);
    if (P.prohibitions.length) out.push(`## 禁区（不能做）\n${bullets(P.prohibitions)}`);
    out.push(`---\n写完后可以调用 \`review\` 工具，按${NAME}的标准检查这份稿子。`);
    return {
      text: out.join("\n\n"),
      used: {
        deliverable: d ? d.name : null,
        deliverable_match: how,
        methods: methods.map((c) => c.id),
        decisions: decisions.map((c) => c.id),
        taste: taste.map((c) => c.id),
        voice: voice.map((c) => c.id),
      },
    };
  }

  function sectionPresent(text, name) {
    const t = norm(text);
    const parts = String(name).split(/与|和|及|＆|&|\/|、|·/).map((s) => norm(s)).filter(Boolean);
    if (parts.some((p) => t.includes(p))) return true;
    const heads = text.split("\n").filter((l) => /^\s*(#{1,6}\s|\*\*|\d+[.、)]|[一二三四五六七八九十]+[、.])/.test(l) || /[：:]\s*$/.test(l));
    const target = grams(name);
    if (!target.size) return false;
    return heads.some((h) => {
      const hg = grams(h);
      let hit = 0;
      for (const g of target) if (hg.has(g)) hit++;
      return hit / target.size >= 0.5;
    });
  }

  function review({ draft, deliverable = "" }) {
    const text = String(draft);
    const lines = text.split("\n");
    const { d, how } = resolveDeliverable(deliverable, deliverable ? "" : lines.slice(0, 3).join("\n"));
    const must = [];
    const should = [];

    if (d) {
      const missing = d.sections.filter((s) => !sectionPresent(text, s.name)).map((s) => `「${s.name}」`);
      if (missing.length) must.push(`缺少「${d.name}」要求的部分：${missing.join("")}`);
    }
    for (const rule of OVERREACH) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(rule.re);
        if (m) {
          (rule.level === "must" ? must : should).push(`第 ${i + 1} 行「${clip(m[0], 30)}」：${rule.why}。改成建议，或标注【需${NAME}确认】`);
          break;
        }
      }
    }
    const hits = banned.filter((b) => text.includes(b.term));
    if (hits.length) must.push(`用了${NAME}明确避免的说法：${hits.map((h) => `「${h.term}」（${h.from}）`).join("、")}`);

    const globalSource = lines.some((l) => /^\s*(?:#{1,6}\s*|\*\*|[-*]\s*)?(?:数据)?(?:口径|来源|数据说明)/.test(l));
    if (!globalSource) {
      const bad = [];
      lines.forEach((l, i) => { if (NUM_RE.test(l) && !SOURCE_RE.test(l)) bad.push(`第 ${i + 1} 行「${clip(l, 36)}」`); });
      if (bad.length) should.push(`这些数字没有写口径或来源（或标【待确认】）：${bad.slice(0, 5).join("；")}${bad.length > 5 ? ` 等共 ${bad.length} 处` : ""}`);
    }
    if (d && d.sections.length && LEAD_RE.test(d.sections[0].name) && sectionPresent(text, d.sections[0].name)) {
      const head = lines.map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ");
      if (!LEAD_RE.test(head)) should.push(`结论没有放在最前面：「${d.sections[0].name}」应该是第一部分`);
    }
    const todo = (text.match(/【待确认[^】]*】/g) || []).length;
    if (todo) should.push(`还有 ${todo} 处【待确认】，发出前要补齐或请${NAME}确认`);
    if (text.replace(/\s/g, "").length < 80) should.push("稿子很短：确认是否覆盖了交付物的每个部分");

    const out = [`# 自检报告 · 按「${M.name}」的标准`];
    out.push(`交付物：${d ? d.name + howNote(how, deliverable) : "未指定"} · 必须修改 ${must.length} 项 · 建议 ${should.length} 项`);
    if (must.length) out.push(`## 必须修改\n${numbered(must)}`);
    if (should.length) out.push(`## 建议\n${numbered(should)}`);
    if (!must.length && !should.length) out.push("没有发现结构或措辞上的问题。");
    if (P.quality.length) out.push(`## 还需要人工确认（${NAME.trimStart()}的质量标准）\n${P.quality.map((q) => `- [ ] ${q}`).join("\n")}`);
    out.push("> 自动检查只看结构和措辞，不判断内容对错。");
    return { text: out.join("\n\n"), must, should, deliverable: d ? d.name : null };
  }

  function cardIndex() {
    const rows = KINDS.filter((k) => byKind[k].length).map((k) => `- ${KIND_LABEL[k]}（${byKind[k].length}）：${byKind[k].map((c) => c.title).join("；")}`);
    return rows.length ? rows.join("\n") : "（暂无）";
  }

  function findExamples({ query, kind = "any", limit = 3 }) {
    const k = KINDS.includes(kind) ? kind : "any";
    const n = Math.min(Math.max(Number.isInteger(limit) ? limit : 3, 1), 5);
    const hits = rank(k, query, n, 1);
    if (!hits.length) return `没有找到和「${clip(query, 40)}」直接相关的${KIND_LABEL[k]}。\n\n现有条目：\n${cardIndex()}`;
    return [
      `# ${NAME.trimStart()}的${KIND_LABEL[k]} · 「${clip(query, 40)}」`,
      ...hits.map((c) => `${renderCard(c, { max: 6000, level: 2 })}\n\n*类型：${KIND_LABEL[c.kind]} · 编号：${c.id}*`),
    ].join("\n\n");
  }

  function profile() {
    const o = [`# ${M.name}${M.role ? ` · ${M.role}` : ""}`];
    if (M.tagline) o.push(`> ${M.tagline}`);
    o.push(`**说明**：${M.disclosure}`);
    if (P.identity) o.push(`## 身份\n${P.identity}`);
    if (P.profile) {
      if (P.profile.intro) o.push(P.profile.intro);
      for (const s of P.profile.sections) o.push(`## ${s.title}\n${s.body}`);
    }
    if (P.principles.length) o.push(`## 决策原则\n${numbered(P.principles)}`);
    if (P.quality.length) o.push(`## 质量标准\n${bullets(P.quality)}`);
    if (P.prohibitions.length) o.push(`## 禁区\n${bullets(P.prohibitions)}`);
    if (P.deliverables.length) o.push(`## 交付物结构\n${P.deliverables.map((d) => `- **${d.name}**：${d.sections.map((s) => s.name).join(" → ")}`).join("\n")}`);
    if (P.goals) o.push(`## 长期目标\n${P.goals}`);
    for (const s of P.extraSections) o.push(`## ${s.title}\n${s.body}`);
    o.push(`## 知识库\n${cardIndex()}`);
    o.push(`---\n快照：${M.snapshot || "未注明"} · TwinKit v${ENGINE_VERSION}`);
    return o.join("\n\n");
  }

  function promptPack() {
    const o = [`# ${NAME.trimStart()}的数字分身 · 提示词包`];
    o.push(`> 由 TwinKit v${ENGINE_VERSION} 从人格包导出${M.snapshot ? `（快照 ${M.snapshot}）` : ""}。把全文粘贴到任意 AI 的“系统提示词 / 自定义指令 / 项目说明”即可使用。\n> ${M.disclosure}`);
    o.push(`## 你的角色\n${roleLock()}\n- 有人问你是不是${NAME}本人时，如实说明你是 AI 数字分身。`);
    if (P.identity) o.push(`## 关于${NAME.trimEnd()}\n${P.identity}`);
    if (P.principles.length) o.push(`## 决策原则\n${numbered(P.principles)}`);
    if (P.prohibitions.length) o.push(`## 禁区\n${bullets(P.prohibitions)}`);
    if (P.quality.length) o.push(`## 质量标准\n${bullets(P.quality)}`);
    if (P.deliverables.length) {
      o.push(`## 交付物结构\n\n${P.deliverables.map((d) => `### ${d.name}${d.default ? "（默认）" : ""}\n${deliverableBlock(d)}`).join("\n\n")}`);
    }
    const groups = [["method", "方法库", 1500], ["decision", "真实决策案例", 1000], ["taste", "品味", 1000], ["voice", "表达风格", 1000]];
    for (const [k, label, max] of groups) {
      if (byKind[k].length) o.push(`## ${label}\n\n${byKind[k].map((c) => renderCard(c, { max })).join("\n\n")}`);
    }
    o.push(`## 工作流程\n1. 判断交付物类型，套用对应结构${defaultDeliverable ? `（没说就用「${defaultDeliverable.name}」）` : ""}。\n2. 找出相关的方法和决策案例，按决策原则做取舍。\n3. 用${NAME}的表达风格写；缺信息就标【待确认】。\n4. 交付前对照质量标准和禁区逐条自检。`);
    return o.join("\n\n");
  }

  // -------------------------------------------------------------- MCP 定义
  const deliverableNames = P.deliverables.map((d) => d.name);
  const TOOLS = {
    work_brief: {
      title: "工作简报",
      description: `动手写任何交付物（方案、汇报、复盘等）之前先调用：按${WHO}的决策原则、方法、真实决策案例、品味和表达风格，为当前任务生成一份工作简报，然后严格按简报完成。${deliverableNames.length ? `可用交付物：${deliverableNames.join("、")}。` : ""}`,
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "要完成的任务，越具体越好", maxLength: 4000 },
          deliverable: { type: "string", description: `交付物类型（可选，不填自动判断）${deliverableNames.length ? `：${deliverableNames.join(" / ")}` : ""}`, maxLength: 100 },
          context: { type: "string", description: "补充背景、数据或限制（可选）", maxLength: 8000 },
        },
        required: ["task"],
      },
      run: (a) => brief(a).text,
    },
    review: {
      title: "按本人标准自检",
      description: `按${NAME}的标准检查一份草稿：缺失的结构、越权表述（替本人承诺/审批）、TA 避免的说法、没有口径的数字。只做检查，不改稿。`,
      inputSchema: {
        type: "object",
        properties: {
          draft: { type: "string", description: "要检查的草稿全文", maxLength: 30000 },
          deliverable: { type: "string", description: "交付物类型（可选）", maxLength: 100 },
        },
        required: ["draft"],
      },
      run: (a) => review(a).text,
    },
    find_examples: {
      title: "查找方法与案例",
      description: `在${NAME}的知识库里查找相关的方法、真实决策案例、品味（好坏对比）或表达风格示例，返回全文。`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "要找什么，例如“价格战”“周报”", maxLength: 500 },
          kind: { type: "string", enum: ["any", ...KINDS], description: "类型：any / method / decision / taste / voice（默认 any）" },
          limit: { type: "integer", minimum: 1, maximum: 5, description: "最多返回几条（默认 3）" },
        },
        required: ["query"],
      },
      run: (a) => findExamples(a),
    },
    get_profile: {
      title: "档案",
      description: `获取${NAME}的档案：身份、经历、决策原则、质量标准、禁区、交付物结构和知识库目录。`,
      inputSchema: { type: "object", properties: {} },
      run: () => profile(),
    },
  };

  function toolList() {
    return Object.entries(TOOLS).map(([name, t]) => ({
      name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }));
  }

  function checkArgs(schema, args) {
    if (args === null || typeof args !== "object" || Array.isArray(args)) return "arguments 必须是对象";
    for (const k of schema.required || []) {
      if (typeof args[k] !== "string" || !args[k].trim()) return `缺少必填参数 ${k}`;
    }
    for (const [k, v] of Object.entries(args)) {
      const spec = schema.properties[k];
      if (!spec || v === undefined || v === null) continue;
      if (spec.type === "string" && typeof v !== "string") return `参数 ${k} 必须是字符串`;
      if (spec.type === "integer" && !Number.isInteger(v)) return `参数 ${k} 必须是整数`;
      if (spec.maxLength && typeof v === "string" && v.length > spec.maxLength) return `参数 ${k} 太长（最多 ${spec.maxLength} 个字符）`;
      if (spec.enum && !spec.enum.includes(v)) return `参数 ${k} 只能是：${spec.enum.join(" / ")}`;
    }
    return null;
  }

  const PROMPTS = [
    {
      name: "work_as_twin",
      title: `按${NAME}的方式工作`,
      description: `把${NAME}的工作简报放进对话，然后按 TA 的方式完成任务。`,
      arguments: [
        { name: "task", description: "要完成的任务", required: true },
        { name: "deliverable", description: "交付物类型（可选）", required: false },
      ],
    },
  ];

  const RESOURCES = [
    { uri: "twin://profile", name: "profile", title: `${M.name} · 档案`, description: "身份、原则、标准、交付物结构和知识库目录", mimeType: "text/markdown" },
    { uri: "twin://prompt-pack", name: "prompt-pack", title: `${M.name} · 提示词包`, description: "不支持 MCP 时，把它粘贴到任意 AI 的自定义指令", mimeType: "text/markdown" },
  ];

  function instructions() {
    return `这是${WHO}的 AI 数字分身（TwinKit）。写方案、汇报、复盘等交付物之前，先调用 work_brief 拿到工作简报并严格照做；写完用 review 自检；需要原始案例时用 find_examples。${M.disclosure}`;
  }

  function ok(id, result) {
    return { jsonrpc: "2.0", id, result };
  }

  function fail(id, code, message) {
    return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
  }

  function dispatch(msg, state) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, -32600, "Invalid Request");
    if (!("method" in msg) && ("result" in msg || "error" in msg)) return null;
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg.id, -32600, "Invalid Request");
    if (!("id" in msg)) return null;
    const { id, method } = msg;
    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    try {
      switch (method) {
        case "initialize": {
          const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
          return ok(id, {
            protocolVersion: v,
            capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
            serverInfo: { name: `twinkit-${M.handle}`, title: `${M.name} · 数字分身`, version: ENGINE_VERSION },
            instructions: instructions(),
          });
        }
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, { tools: toolList() });
        case "tools/call": {
          const t = TOOLS[params.name];
          if (!t) return fail(id, -32602, `Unknown tool: ${params.name}`);
          const args = params.arguments === undefined ? {} : params.arguments;
          const problem = checkArgs(t.inputSchema, args);
          if (problem) return ok(id, { content: [{ type: "text", text: `参数错误：${problem}` }], isError: true });
          state.active = true;
          return ok(id, { content: [{ type: "text", text: t.run(args) }] });
        }
        case "prompts/list":
          return ok(id, { prompts: PROMPTS });
        case "prompts/get": {
          if (params.name !== "work_as_twin") return fail(id, -32602, `Unknown prompt: ${params.name}`);
          const a = params.arguments || {};
          if (typeof a.task !== "string" || !a.task.trim()) return fail(id, -32602, "缺少必填参数 task");
          state.active = true;
          const b = brief({ task: a.task.slice(0, 4000), deliverable: typeof a.deliverable === "string" ? a.deliverable.slice(0, 100) : "" });
          return ok(id, {
            description: PROMPTS[0].description,
            messages: [{ role: "user", content: { type: "text", text: `${b.text}\n\n---\n请严格按以上简报完成任务，直接输出交付物正文。` } }],
          });
        }
        case "resources/list":
          return ok(id, { resources: RESOURCES });
        case "resources/templates/list":
          return ok(id, { resourceTemplates: [] });
        case "resources/read": {
          const uri = params.uri;
          if (uri === "twin://profile") return ok(id, { contents: [{ uri, mimeType: "text/markdown", text: profile() }] });
          if (uri === "twin://prompt-pack") return ok(id, { contents: [{ uri, mimeType: "text/markdown", text: promptPack() }] });
          return fail(id, -32002, `Resource not found: ${uri}`);
        }
        default:
          return fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      return fail(id, -32603, "Internal error");
    }
  }

  // -------------------------------------------------------------- HTTP
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID, X-Twin-Token",
    "Access-Control-Max-Age": "86400",
  };

  function respond(body, status = 200, headers = {}) {
    return new Response(body, { status, headers: { ...CORS, ...headers } });
  }

  function json(obj, status = 200, headers = {}) {
    return respond(JSON.stringify(obj), status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  }

  function isPublic(env) {
    return String(env.TWIN_PUBLIC ?? "").trim().toLowerCase() === "true";
  }

  function safeEqual(a, b) {
    const x = new TextEncoder().encode(String(a));
    const y = new TextEncoder().encode(String(b));
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
    return diff === 0;
  }

  function access(request, env, pathToken) {
    if (isPublic(env)) return { ok: true, mode: "none" };
    if (!env.TWIN_TOKEN) {
      return { ok: false, response: json({ error: "not_configured", message: '这个分身还没有配置访问方式：设置 TWIN_PUBLIC="true"（公开），或设置密钥 TWIN_TOKEN（私有）。' }, 503) };
    }
    const auth = request.headers.get("authorization") || "";
    const bearer = (auth.match(/^Bearer\s+(.+)$/i) || [])[1];
    const given = (bearer && bearer.trim()) || request.headers.get("x-twin-token") || pathToken;
    if (given && safeEqual(given, env.TWIN_TOKEN)) return { ok: true, mode: "token" };
    return { ok: false, response: json({ error: "unauthorized", message: "需要令牌：在请求头加 Authorization: Bearer <令牌>，或使用 /t/<令牌>/mcp 地址。" }, 401) };
  }

  async function limited(request, env) {
    const rl = env.TWIN_RATE_LIMITER;
    if (!rl || typeof rl.limit !== "function") return false;
    try {
      const { success } = await rl.limit({ key: request.headers.get("cf-connecting-ip") || "anonymous" });
      return !success;
    } catch {
      return false;
    }
  }

  async function readDays(kv) {
    try {
      const v = JSON.parse((await kv.get("active_days")) || "[]");
      return Array.isArray(v) ? v.filter((d) => typeof d === "string") : [];
    } catch {
      return [];
    }
  }

  async function recordActive(env) {
    const kv = env.TWIN_STATS;
    const day = today();
    if (!kv || lastActiveDay === day) return;
    try {
      const days = await readDays(kv);
      if (!days.includes(day)) {
        days.push(day);
        days.sort();
        await kv.put("active_days", JSON.stringify(days.slice(-120)));
      }
      lastActiveDay = day;
    } catch {
      /* 统计失败不影响服务 */
    }
  }

  async function activeDays28(env) {
    const days = await readDays(env.TWIN_STATS);
    const since = new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10);
    return days.filter((d) => d >= since && d <= today()).length;
  }

  async function health(env) {
    const pub = isPublic(env);
    const body = { ok: true, server: "twinkit", version: ENGINE_VERSION, auth: pub ? "none" : env.TWIN_TOKEN ? "token" : "unconfigured" };
    if (pub) Object.assign(body, { persona: M.handle, name: M.name, snapshot: M.snapshot || null, fictional: !!M.fictional });
    if (env.TWIN_STATS && String(env.TWIN_PUBLIC_STATS ?? "").trim().toLowerCase() === "true") body.active_days_28d = await activeDays28(env);
    return body;
  }

  function landing(origin, env) {
    const pub = isPublic(env);
    const ep = `${origin}/mcp`;
    const page = (title, inner) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
body{margin:0;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328;background:#f6f8fa}
main{max-width:760px;margin:0 auto;padding:40px 20px 64px}h1{margin:.2em 0 0;font-size:32px}h2{margin-top:2em;font-size:20px}h3{font-size:15px;margin:1.4em 0 .4em;color:#57606a}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;background:#fff8c5;border:1px solid #d4a72c;font-size:13px}
.role{color:#57606a;margin:.2em 0 1em}.note{padding:12px 14px;background:#fff;border:1px solid #d0d7de;border-radius:8px;font-size:14px}
pre{background:#0d1117;color:#e6edf3;padding:12px 14px;border-radius:8px;overflow:auto;font-size:13px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
li{margin:.3em 0}a{color:#0969da}footer{margin-top:48px;color:#57606a;font-size:13px}</style></head><body><main>${inner}</main></body></html>`;
    if (!pub) {
      return page("TwinKit 数字分身", `<p class="badge">AI 数字分身 · 私有</p><h1>这是一个私有的数字分身</h1><p class="note">需要令牌才能接入。MCP 地址：<code>${escapeHtml(ep)}</code>（请求头 <code>Authorization: Bearer &lt;令牌&gt;</code>）。</p><footer>Powered by <a href="${REPO_URL}">TwinKit</a> v${ENGINE_VERSION}</footer>`);
    }
    const slug = M.handle;
    const cursor = JSON.stringify({ mcpServers: { [slug]: { url: ep } } }, null, 2);
    const vscode = JSON.stringify({ servers: { [slug]: { type: "http", url: ep } } }, null, 2);
    const tools = toolList().map((t) => `<li><b>${escapeHtml(t.name)}</b>：${escapeHtml(t.description)}</li>`).join("");
    const q = defaultDeliverable ? `用${NAME}的方式，帮我写一份${defaultDeliverable.name}：……` : `用${NAME}的方式帮我……`;
    return page(`${M.name} · AI 数字分身`, `<p class="badge">AI 数字分身 · 不是本人</p>
<h1>${escapeHtml(M.name)}</h1><p class="role">${escapeHtml(M.role)}</p>${M.tagline ? `<p>${escapeHtml(M.tagline)}</p>` : ""}
<p class="note">${escapeHtml(M.disclosure)}</p>
<h2>接入你的 AI（MCP，公开，无需令牌）</h2><p>地址：<code>${escapeHtml(ep)}</code></p>
<h3>Claude Code</h3><pre><code>claude mcp add --transport http ${escapeHtml(slug)} ${escapeHtml(ep)}</code></pre>
<h3>Cursor（~/.cursor/mcp.json）</h3><pre><code>${escapeHtml(cursor)}</code></pre>
<h3>VS Code（.vscode/mcp.json）</h3><pre><code>${escapeHtml(vscode)}</code></pre>
<h3>只支持本地 stdio 的客户端</h3><pre><code>npx -y mcp-remote ${escapeHtml(ep)}</code></pre>
<p>接好后对 AI 说：<code>${escapeHtml(q)}</code></p>
<h2>它能做什么</h2><ul>${tools}</ul>
<p>不用 MCP？<a href="/prompt.md">下载提示词包</a>，粘贴到任意 AI 的自定义指令里。</p>
<footer>Powered by <a href="${REPO_URL}">TwinKit</a> v${ENGINE_VERSION}${M.snapshot ? ` · 人格包快照 ${escapeHtml(M.snapshot)}` : ""} · 用同样的方式做一个你自己的分身</footer>`);
  }

  async function handleMcp(request, env, ctx) {
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) return json(fail(null, -32600, "请求体过大"), 413);
    let raw;
    try {
      raw = await request.text();
    } catch {
      return json(fail(null, -32700, "Parse error"), 400);
    }
    if (raw.length > MAX_BODY) return json(fail(null, -32600, "请求体过大"), 413);
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return json(fail(null, -32700, "Parse error：请求体不是合法的 JSON"), 400);
    }
    const state = { active: false };
    let out;
    if (Array.isArray(msg)) {
      if (!msg.length) return json(fail(null, -32600, "Invalid Request：空的批量请求"), 400);
      const list = msg.map((m) => dispatch(m, state)).filter(Boolean);
      out = list.length ? list : null;
    } else {
      out = dispatch(msg, state);
    }
    if (state.active && env.TWIN_STATS) {
      const p = recordActive(env);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
      else await p;
    }
    if (!out) return respond(null, 202);
    return json(out);
  }

  async function fetch(request, env = {}, ctx) {
    env = env || {};
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let path = url.pathname.replace(/\/+$/, "") || "/";
    let pathToken = null;
    const tm = path.match(/^\/t\/([^/]+)(\/.*)?$/);
    if (tm) {
      try { pathToken = decodeURIComponent(tm[1]); } catch { pathToken = tm[1]; }
      path = tm[2] || "/";
    }
    if (method === "OPTIONS") return respond(null, 204);
    if (path === "/health") return json(await health(env));
    if (path.startsWith("/.well-known/")) return json({ error: "not_found" }, 404);
    const wantsHtml = method === "GET" && /text\/html/i.test(request.headers.get("accept") || "");
    if ((path === "/" || path === "/mcp") && wantsHtml) return respond(landing(url.origin, env), 200, { "Content-Type": "text/html; charset=utf-8" });
    if (path === "/" && method === "GET") {
      const pub = isPublic(env);
      return json({
        server: "twinkit",
        version: ENGINE_VERSION,
        mcp: `${url.origin}/mcp`,
        health: `${url.origin}/health`,
        ...(pub ? { persona: { name: M.name, role: M.role, tagline: M.tagline }, prompt_pack: `${url.origin}/prompt.md` } : { auth: "token" }),
        docs: REPO_URL,
      });
    }
    if (path === "/prompt.md" && method === "GET") {
      const a = access(request, env, pathToken);
      if (!a.ok) return a.response;
      return respond(promptPack(), 200, { "Content-Type": "text/markdown; charset=utf-8" });
    }
    if (path !== "/mcp") return json({ error: "not_found", message: `MCP 地址是 ${url.origin}/mcp` }, 404);
    if (method !== "POST") {
      return json({ error: "method_not_allowed", message: "这是 MCP 服务器（Streamable HTTP，无状态）：请用 MCP 客户端以 POST 访问这个地址。用浏览器打开可以看到接入说明。" }, 405, { Allow: "POST, OPTIONS" });
    }
    const a = access(request, env, pathToken);
    if (!a.ok) return a.response;
    if (await limited(request, env)) return json(fail(null, -32000, "请求太频繁，请稍后再试"), 429, { "Retry-After": "60" });
    return handleMcp(request, env, ctx);
  }

  return { persona: P, version: ENGINE_VERSION, brief, review, findExamples, profile, promptPack, tools: toolList, fetch };
}

let defaultTwin = null;

export default {
  async fetch(request, env, ctx) {
    if (!PERSONA) {
      return new Response("TwinKit：还没有注入人格包。请先运行 npm run build，再部署 dist/worker.js。", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (!defaultTwin) defaultTwin = createTwin(PERSONA);
    return defaultTwin.fetch(request, env || {}, ctx);
  },
};
