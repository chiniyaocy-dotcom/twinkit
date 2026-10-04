// 解析评测任务文件（格式见 eval/tasks.example.md）。
export function parseTasks(src) {
  const text = String(src).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const tasks = [];
  let cur = null;
  let mode = "body";
  for (const line of text.split("\n")) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      const m = h2[1].match(/^([A-Za-z]{0,3}\d{1,4})[\s.:：、-]+(.+)$/);
      cur = {
        id: m ? m[1].toUpperCase() : `T${String(tasks.length + 1).padStart(2, "0")}`,
        title: (m ? m[2] : h2[1]).trim(),
        deliverable: "",
        context: "",
        body: [],
        human: [],
      };
      tasks.push(cur);
      mode = "body";
      continue;
    }
    if (!cur) continue;
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      mode = /本人|真人|human|owner/i.test(h3[1]) ? "human" : "body";
      continue;
    }
    if (mode === "human") { cur.human.push(line); continue; }
    const meta = line.match(/^\s*[-*]\s*(交付物|deliverable|背景|context)\s*[:：]\s*(.*)$/i);
    if (meta) {
      if (/交付物|deliverable/i.test(meta[1])) cur.deliverable = meta[2].trim();
      else cur.context = meta[2].trim();
      continue;
    }
    cur.body.push(line);
  }
  const seen = new Set();
  return tasks.map((t) => {
    if (seen.has(t.id)) throw new Error(`任务编号重复：${t.id}`);
    seen.add(t.id);
    const body = t.body.join("\n").trim();
    return {
      id: t.id,
      title: t.title,
      deliverable: t.deliverable,
      context: t.context,
      prompt: [t.title, body, t.context ? `背景：${t.context}` : ""].filter(Boolean).join("\n\n"),
      human: t.human.join("\n").trim() || null,
    };
  });
}
