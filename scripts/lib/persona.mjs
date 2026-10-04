// TwinKit 人格包解析器：把 persona/ 目录里的 Markdown 解析成一个 JSON bundle。
// 零依赖，Node >= 18。格式说明见 docs/persona-spec.md。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";

export const FORMAT = "twinkit-persona/1";
export const CARD_KINDS = ["methods", "decisions", "taste", "voice"];
export const KIND_SINGULAR = { methods: "method", decisions: "decision", taste: "taste", voice: "voice" };

export class PersonaError extends Error {}

const META_ALIASES = {
  name: ["姓名", "名字", "名称", "name"],
  role: ["角色", "职位", "头衔", "role", "title"],
  tagline: ["一句话", "简介", "一句话介绍", "tagline", "summary"],
  language: ["语言", "language", "lang"],
  snapshot: ["快照日期", "快照", "更新日期", "更新", "snapshot", "updated"],
  disclosure: ["披露", "披露语", "声明", "disclosure"],
  handle: ["标识", "英文标识", "handle", "slug", "id"],
  fictional: ["虚构", "虚构人物", "fictional"],
  keywords: ["关键词", "关键字", "标签", "keywords", "tags"],
  when: ["适用", "适用场景", "适用于", "when", "applies", "use when"],
  date: ["日期", "时间", "date"],
  scene: ["场景", "对象", "scene", "audience", "context"],
  default: ["默认", "default"],
  source: ["来源", "出处", "source"],
};

const SECTION_ALIASES = {
  identity: ["身份", "我是谁", "关于我", "identity", "about", "about me", "who i am"],
  principles: ["决策原则", "原则", "做决定的原则", "principles", "decision principles"],
  prohibitions: ["禁区", "红线", "边界", "不做的事", "prohibitions", "boundaries", "never"],
  quality: ["质量标准", "标准", "交付标准", "quality", "quality bar", "standards"],
  deliverables: ["交付物", "交付物结构", "交付格式", "deliverables", "formats", "deliverable formats"],
  goals: ["长期目标", "职业规划", "目标", "goals", "career", "long-term goals"],
};

const metaIndex = buildIndex(META_ALIASES);
const sectionIndex = buildIndex(SECTION_ALIASES);

function buildIndex(aliases) {
  const m = new Map();
  for (const [key, list] of Object.entries(aliases)) for (const a of list) m.set(a.toLowerCase(), key);
  return m;
}

export function metaKey(raw) {
  return metaIndex.get(String(raw).trim().toLowerCase()) || null;
}

export function sectionKey(title) {
  return sectionIndex.get(String(title).trim().toLowerCase().replace(/[：:]$/, "")) || null;
}

function stripComments(text) {
  // 去掉 HTML 注释（模板里的填写说明），但保留代码块里的内容
  const out = [];
  let inFence = false;
  let marker = "";
  let inComment = false;
  for (const line of text.split("\n")) {
    const fence = !inComment && line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) { inFence = true; marker = fence[1][0]; }
      else if (fence[1][0] === marker) inFence = false;
      out.push(line);
      continue;
    }
    if (inFence) { out.push(line); continue; }
    let rest = line;
    let kept = "";
    while (rest.length) {
      if (inComment) {
        const end = rest.indexOf("-->");
        if (end === -1) { rest = ""; break; }
        rest = rest.slice(end + 3);
        inComment = false;
      } else {
        const start = rest.indexOf("<!--");
        if (start === -1) { kept += rest; rest = ""; break; }
        kept += rest.slice(0, start);
        rest = rest.slice(start + 4);
        inComment = true;
      }
    }
    // 整行都是注释时不留空行
    if (kept.trim() === "" && line.trim() !== "") continue;
    out.push(kept);
  }
  return out.join("\n");
}

/** 解析单个 Markdown 文件：# 标题、标题下的 `- 键：值` 元信息、## 小节。代码块内的 # 不算标题。 */
export function parseMarkdown(src) {
  const text = stripComments(String(src).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
  let title = "";
  const meta = {};
  const intro = [];
  const sections = [];
  let cur = null;
  let inFence = false;
  let marker = "";
  let metaOpen = true;
  for (const line of text.split("\n")) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) { inFence = true; marker = fence[1][0]; }
      else if (fence[1][0] === marker) inFence = false;
      (cur ? cur.lines : intro).push(line);
      metaOpen = false;
      continue;
    }
    if (!inFence) {
      const h1 = line.match(/^#\s+(.+?)\s*#*\s*$/);
      if (h1 && !title && !cur) { title = h1[1].trim(); continue; }
      const h2 = line.match(/^##\s+(.+?)\s*#*\s*$/);
      if (h2) { cur = { title: h2[1].trim(), lines: [] }; sections.push(cur); metaOpen = false; continue; }
      if (!cur && metaOpen) {
        const m = line.match(/^\s*[-*+]\s*([^:：\n]{1,24}?)\s*[:：]\s*(.*)$/);
        if (m && metaKey(m[1])) { meta[m[1].trim()] = m[2].trim(); continue; }
        if (line.trim() === "") { intro.push(line); continue; }
        metaOpen = false;
      }
    }
    (cur ? cur.lines : intro).push(line);
  }
  return {
    title,
    meta,
    intro: tidy(intro.join("\n")),
    sections: sections.map((s) => ({ title: s.title, body: tidy(s.lines.join("\n")) })),
  };
}

function tidy(s) {
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeMeta(raw) {
  const out = {};
  const extra = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const key = metaKey(k);
    if (key) out[key] = v;
    else extra[k] = v;
  }
  if (Object.keys(extra).length) out.extra = extra;
  return out;
}

export function splitTerms(s) {
  return [...new Set(String(s || "").split(/[、,，;；|/]+/).map((x) => x.trim()).filter(Boolean))];
}

export function truthy(v) {
  return /^(是|对|true|yes|y|1)$/i.test(String(v || "").trim());
}

/** 把列表/段落拆成条目：支持 - * + 1. 1) 1、 开头的列表；没有列表就按段落。 */
export function parseList(body) {
  if (!body) return [];
  const items = [];
  let cur = null;
  let sawMarker = false;
  for (const line of body.split("\n")) {
    const m = line.match(/^\s{0,3}(?:[-*+]\s+|\d{1,3}[.)]\s+|\d{1,3}、\s*)(.*)$/);
    if (m) { sawMarker = true; cur = m[1].trim(); items.push(cur); continue; }
    if (line.trim() === "") { cur = null; continue; }
    if (cur !== null && /^\s+/.test(line)) { items[items.length - 1] += " " + line.trim(); continue; }
    if (!sawMarker) { items.push(line.trim()); cur = null; continue; }
    if (cur !== null) items[items.length - 1] += " " + line.trim();
  }
  return items.filter(Boolean);
}

function parseDeliverableHeading(h) {
  const m = h.match(/^(.+?)\s*[（(]([^）)]*)[）)]\s*$/);
  const name = (m ? m[1] : h).trim();
  const tags = m ? splitTerms(m[2]) : [];
  const isDefault = tags.some((t) => /^(默认|default)$/i.test(t));
  const aliases = tags.filter((t) => !/^(默认|default)$/i.test(t));
  return { name, aliases, default: isDefault };
}

function splitSectionNames(items) {
  if (items.length === 1 && /\s[/→>]\s|→|\s\/\s/.test(items[0])) {
    return items[0].split(/\s*(?:\/|→|>)\s*/).map((s) => s.trim()).filter(Boolean);
  }
  return items;
}

export function parseDeliverables(body) {
  const list = [];
  let cur = null;
  for (const line of String(body || "").split("\n")) {
    const h = line.match(/^###\s+(.+?)\s*#*\s*$/);
    if (h) { cur = { ...parseDeliverableHeading(h[1]), raw: [] }; list.push(cur); continue; }
    if (cur) cur.raw.push(line);
  }
  const out = list.map((d) => {
    const names = splitSectionNames(parseList(d.raw.join("\n")));
    const sections = names.map((n) => {
      const m = n.match(/^\*{0,2}([^：:*]{1,30}?)\*{0,2}\s*[：:]\s*(.+)$/);
      return m ? { name: m[1].trim(), hint: m[2].trim() } : { name: n.replace(/\*\*/g, "").trim(), hint: "" };
    }).filter((s) => s.name);
    return { name: d.name, aliases: d.aliases, default: d.default, sections };
  });
  if (out.length && !out.some((d) => d.default)) out[0].default = true;
  return out;
}

export function slugify(s) {
  const slug = String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "twin";
}

function listMarkdown(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".md") && !/^[_.]/.test(f) && f.toLowerCase() !== "readme.md")
    .sort((a, b) => a.localeCompare(b))
    .map((f) => join(dir, f));
}

function read(file) {
  return readFileSync(file, "utf8");
}

export function parseCard(src, { kind, id, file }) {
  const doc = parseMarkdown(src);
  const meta = normalizeMeta(doc.meta);
  return {
    id,
    kind,
    file,
    title: doc.title || id,
    keywords: splitTerms(meta.keywords),
    meta,
    intro: doc.intro,
    sections: doc.sections,
  };
}

/** 读取人格包目录下所有会被解析的文件（validate 用来做隐私扫描）。 */
export function personaFiles(dir) {
  const files = [];
  for (const f of ["persona.md", "profile.md"]) if (existsSync(join(dir, f))) files.push(join(dir, f));
  for (const kind of CARD_KINDS) files.push(...listMarkdown(join(dir, kind)));
  return files.map((path) => ({ path, rel: relative(dir, path), text: read(path) }));
}

export function loadPersona(dir) {
  const personaPath = join(dir, "persona.md");
  if (!existsSync(personaPath)) throw new PersonaError(`找不到 ${personaPath}（人格包至少需要 persona.md）`);
  const doc = parseMarkdown(read(personaPath));
  const meta = normalizeMeta(doc.meta);
  const sec = {};
  const extraSections = [];
  for (const s of doc.sections) {
    const key = sectionKey(s.title);
    if (key && !sec[key]) sec[key] = s;
    else extraSections.push(s);
  }
  const name = meta.name || doc.title.replace(/\s*[·|-].*$/, "").trim() || "未命名";
  const fictional = truthy(meta.fictional);
  let profile = null;
  const profilePath = join(dir, "profile.md");
  if (existsSync(profilePath)) {
    const p = parseMarkdown(read(profilePath));
    profile = { title: p.title, meta: normalizeMeta(p.meta), intro: p.intro, sections: p.sections };
  }
  const cards = {};
  for (const kind of CARD_KINDS) {
    cards[kind] = listMarkdown(join(dir, kind)).map((file) => {
      const id = `${KIND_SINGULAR[kind]}/${basename(file, ".md")}`;
      return parseCard(read(file), { kind: KIND_SINGULAR[kind], id, file: relative(dir, file) });
    });
  }
  return {
    format: FORMAT,
    meta: {
      name,
      role: meta.role || "",
      tagline: meta.tagline || "",
      language: meta.language || "zh",
      snapshot: meta.snapshot || "",
      handle: slugify(meta.handle || name),
      fictional,
      disclosure: meta.disclosure || defaultDisclosure(name, fictional),
      extra: meta.extra || {},
    },
    title: doc.title,
    identity: sec.identity ? sec.identity.body : doc.intro,
    principles: parseList(sec.principles && sec.principles.body),
    prohibitions: parseList(sec.prohibitions && sec.prohibitions.body),
    quality: parseList(sec.quality && sec.quality.body),
    deliverables: parseDeliverables(sec.deliverables && sec.deliverables.body),
    goals: sec.goals ? sec.goals.body : "",
    extraSections,
    profile,
    cards,
  };
}

export function defaultDisclosure(name, fictional = false) {
  if (fictional) return `「${name}」是用于演示的虚构人物；这是 TA 的 AI 数字分身，内容均为虚构示例。`;
  return `这是「${name}」的 AI 数字分身，根据本人整理的工作方法生成，不是本人；输出仅供参考，不代表本人的实时意见或承诺。`;
}

/** 默认人格包目录：有 persona/persona.md 就用它，否则用示例。 */
export function defaultPersonaDir(root) {
  const own = join(root, "persona");
  if (existsSync(join(own, "persona.md"))) return { dir: own, example: false };
  return { dir: join(root, "examples", "zhou-yu"), example: true };
}
