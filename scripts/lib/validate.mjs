// 人格包检查：结构是否完整、占位符是否替换、有没有隐私信息。
import { loadPersona, personaFiles, PersonaError, CARD_KINDS } from "./persona.mjs";

const PII = [
  { level: "error", label: "手机号", re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { level: "error", label: "身份证号", re: /(?<![\dA-Za-z])[1-9]\d{16}[\dXx](?![\dA-Za-z])/g },
  { level: "error", label: "密钥或令牌", re: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g },
  { level: "warn", label: "邮箱", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { level: "warn", label: "座机号", re: /(?<![\d.])0\d{2,3}-\d{7,8}(?!\d)/g },
  { level: "warn", label: "银行卡号", re: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g, check: luhn },
];

const RECOMMENDED = { methods: 3, decisions: 3, taste: 1, voice: 1 };
const KIND_HINT = {
  methods: "方法卡",
  decisions: "真实决策（最能让分身像你）",
  taste: "品味对比卡",
  voice: "表达风格卡",
};

function luhn(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 16 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function mask(s) {
  const t = String(s);
  if (t.length <= 6) return "***";
  return `${t.slice(0, 3)}***${t.slice(-2)}`;
}

/** 检查一个人格包目录。返回 { ok, errors, warnings, bundle, stats }。 */
export function validatePersona(dir, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  let bundle;
  try {
    bundle = loadPersona(dir);
  } catch (e) {
    if (e instanceof PersonaError) return { ok: false, errors: [e.message], warnings, bundle: null, stats: null };
    throw e;
  }

  for (const f of personaFiles(dir)) {
    const placeholderLines = [];
    // 占位符只在注释以外检查（模板的填写说明里会提到 {{…}}），隐私扫描则包括注释
    const visible = f.text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, "")).split("\n");
    f.text.split("\n").forEach((line, i) => {
      if (/\{\{[^}]*\}\}/.test(visible[i] || "")) placeholderLines.push(i + 1);
      for (const p of PII) {
        for (const m of line.matchAll(p.re)) {
          if (p.check && !p.check(m[0])) continue;
          (p.level === "error" ? errors : warnings).push(`${f.rel}:${i + 1} 疑似${p.label}「${mask(m[0])}」——人格包里不要放隐私或密钥`);
        }
      }
    });
    if (placeholderLines.length) {
      const shown = placeholderLines.slice(0, 8).join("、");
      errors.push(`${f.rel}：还有 ${placeholderLines.length} 行 {{占位符}} 没替换（第 ${shown}${placeholderLines.length > 8 ? "…" : ""} 行）`);
    }
  }

  const M = bundle.meta;
  if (!M.name || M.name === "未命名") errors.push("persona.md：缺少名字（写 `- 姓名：…`，或在第一行写 `# 名字`）");
  if (!M.role) warnings.push("persona.md：建议写上 `- 角色：…`，分身会用它锁定身份");
  if (!M.snapshot) warnings.push("persona.md：建议写上 `- 快照日期：YYYY-MM-DD`，让使用者知道内容有多新");
  if (!bundle.identity) warnings.push("persona.md：建议写「## 身份」，用几句话介绍你");
  if (!bundle.principles.length) errors.push("persona.md：缺少「## 决策原则」（至少 3 条）");
  else if (bundle.principles.length < 3) warnings.push(`persona.md：决策原则只有 ${bundle.principles.length} 条，建议 5–10 条`);
  if (!bundle.prohibitions.length) errors.push("persona.md：缺少「## 禁区」（分身绝对不能做的事）");
  if (!bundle.quality.length) errors.push("persona.md：缺少「## 质量标准」（你验收时检查什么）");
  if (!bundle.deliverables.length) errors.push("persona.md：缺少「## 交付物」（用 ### 写每种交付物，下面列出它的结构）");
  for (const d of bundle.deliverables) if (!d.sections.length) errors.push(`persona.md：交付物「${d.name}」下面没有列出结构`);
  if (!/AI|分身|虚构|digital twin/i.test(M.disclosure)) errors.push("persona.md：披露语必须说明这是 AI 数字分身（或删掉 `- 披露：` 使用默认披露语）");

  for (const kind of CARD_KINDS) {
    const have = bundle.cards[kind].length;
    if (have < RECOMMENDED[kind]) warnings.push(`${kind}/：现在 ${have} 张，建议至少 ${RECOMMENDED[kind]} 张${KIND_HINT[kind]}`);
    for (const c of bundle.cards[kind]) {
      if (!c.sections.length && !c.intro) errors.push(`${c.file}：内容是空的`);
      if (!c.keywords.length) warnings.push(`${c.file}：没有 \`- 关键词：\`，这张卡很难被自动调出`);
    }
  }

  const size = Buffer.byteLength(JSON.stringify(bundle));
  if (size > 800_000) warnings.push(`人格包有 ${Math.round(size / 1024)} KB，偏大（Workers 免费版脚本压缩后上限 3 MB），建议精简`);

  const stats = {
    name: M.name,
    handle: M.handle,
    principles: bundle.principles.length,
    deliverables: bundle.deliverables.length,
    ...Object.fromEntries(CARD_KINDS.map((k) => [k, bundle.cards[k].length])),
    bytes: size,
  };
  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, bundle, stats };
}
