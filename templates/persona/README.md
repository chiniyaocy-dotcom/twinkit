# 人格包模板

运行 `npm run new` 会把这个目录复制到 `persona/`。然后：

1. 把所有 `{{…}}` 换成你的内容（或者用 [采访提示词](../../docs/interview-prompt.md) 让 AI 帮你生成）。
2. `npm run validate` 检查结构、占位符和隐私信息。
3. `npm run dev` 在本地试用，满意后 `npm run deploy`。

格式说明见 [docs/persona-spec.md](../../docs/persona-spec.md)。
