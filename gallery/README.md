# Gallery：真实的人，真实的分身

这里登记的是**本人用自己的工作方式做的、公开可接入的**分身。每周一自动探测一次在线状态，结果在 [STATUS.md](STATUS.md)。

## 登记你的分身

1. 按 [部署文档](../docs/deploy.md) 部署一个**公开模式**的分身，确认 `https://<你的地址>/health` 能打开。
2. （推荐）开启活跃天数统计，并设置 `TWIN_PUBLIC_STATS = "true"`，这样 Gallery 能统计“持续使用”。
3. 在 `gallery/entries/` 新建 `<标识>.json`（文件名和 `handle` 一致）：

```json
{
  "handle": "zhang-san",
  "name": "张三",
  "role": "B2B SaaS 产品经理",
  "summary": "写 PRD 和做需求取舍的方式",
  "endpoint": "https://zhang-san-twin.example.workers.dev/mcp",
  "pack": "https://github.com/zhangsan/my-twin/tree/main/persona",
  "owner": "zhangsan",
  "consent": {
    "owner_is_subject": true,
    "ai_disclosure": true,
    "date": "2026-10-10"
  }
}
```

| 字段 | 说明 |
|---|---|
| `handle` | 小写字母、数字、`-` |
| `endpoint` | 公开的 MCP 地址，以 `/mcp` 结尾，不能带令牌 |
| `pack` | 人格包的公开链接；不想公开源文件就写 `"private"` |
| `owner` | 你的 GitHub 用户名：**必须和提交 PR 的账号一致** |
| `consent.owner_is_subject` | 必须为 `true`：这是你本人的分身 |
| `consent.ai_disclosure` | 必须为 `true`：分身会表明自己是 AI |
| `eval`（可选） | `{ "report": "评测报告链接" }` |

4. 运行 `node scripts/gallery-check.mjs` 确认格式正确，然后提交 PR，勾选 PR 模板里的确认项。

想下架：提交一个删除该文件的 PR，或开 issue，我们会尽快处理。

## 规则

- 只收录本人提交的本人分身；为他人建分身必须有对方的书面授权，并由对方本人提交。
- 分身必须表明自己是 AI，不能冒充本人对外承诺、签署或审批。
- 人格包和分身输出中不能有他人隐私、歧视、违法内容；不符合的条目会被下架。
- `demo: true` 的条目是演示用的（例如虚构的周屿），不计入任何统计。
