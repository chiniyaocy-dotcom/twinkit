# 参与贡献

谢谢你愿意帮忙！TwinKit 刻意保持简单：**零依赖、Node 18+、纯 Markdown 人格包**。

## 开发

```bash
git clone https://github.com/chiniyaocy-dotcom/twinkit.git
cd twinkit
npm test          # 全部测试（node:test，无需安装依赖）
npm run dev       # 用示例人格包启动本地分身
```

目录：

| 路径 | 内容 |
|---|---|
| `engine/worker.template.js` | 分身引擎（MCP、工作简报、审稿、落地页），构建时注入人格包 |
| `scripts/` | `new` / `validate` / `build` / `serve` / `stdio` / `gallery-check` |
| `eval/` | 盲评生成、打分页面、统计分析 |
| `examples/zhou-yu/` | 虚构示例人格包 |
| `templates/persona/` | 空白模板 |
| `docs/` | 文档 |

## 约定

- 不引入运行时依赖。需要新能力时，先看能不能用 Web 标准 API 或 Node 内置模块实现。
- 引擎代码必须同时能在 Cloudflare Workers 和 Node 18+ 上运行。
- 改动行为时补测试；`npm test` 必须通过。
- 文档以中文为主，欢迎补充英文。面向用户的文字尽量短句、具体。
- 人格包格式的改动要保持向后兼容，并更新 [docs/persona-spec.md](docs/persona-spec.md)。

## 特别需要帮助的地方

- 更多客户端的接入说明和截图（[docs/clients.md](docs/clients.md)）
- 英文版工作简报（引擎多语言）
- 更好的检索（在不引入依赖的前提下）
- 评测：更多模型的对比、更好的评委界面
- 不同职业的示例人格包（必须是虚构人物，或本人授权）

## 提交

1. Fork，新建分支。
2. 提交 PR，说明改了什么、为什么。
3. 登记 Gallery 条目时，请完成 PR 模板里的确认项。

## 行为准则

友善、具体、对事不对人。不接受骚扰、歧视和人身攻击；维护者可以删除不当内容并限制参与。
