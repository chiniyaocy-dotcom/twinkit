// 本地运行时共用：加载人格包 + 创建分身（serve / stdio / eval 使用）。
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultPersonaDir } from "./persona.mjs";
import { validatePersona } from "./validate.mjs";

export async function loadTwin({ root, personaDir, log = console.error }) {
  const picked = personaDir ? { dir: resolve(personaDir), example: false } : defaultPersonaDir(root);
  const v = validatePersona(picked.dir);
  if (!v.ok) {
    const err = new Error(`人格包检查没通过（${picked.dir}）：\n${v.errors.map((e) => `  ✗ ${e}`).join("\n")}`);
    err.code = "INVALID_PERSONA";
    throw err;
  }
  const { createTwin } = await import(pathToFileURL(join(root, "engine", "worker.template.js")).href);
  return { twin: createTwin(v.bundle), dir: picked.dir, example: picked.example, warnings: v.warnings, log };
}
