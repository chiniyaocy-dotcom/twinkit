# 更新记录

## 0.1.0（2026-10-04）

第一个公开版本。

- 人格包格式 `twinkit-persona/1`：纯 Markdown（身份、决策原则、禁区、质量标准、交付物结构、方法、真实决策、品味、表达风格）。
- 引擎：单文件 MCP 服务器（Streamable HTTP，无状态），工具 `work_brief` / `review` / `find_examples` / `get_profile`，提示词 `work_as_twin`，资源 `twin://profile`、`twin://prompt-pack`。
- 部署：Cloudflare Workers（公开或令牌模式、按 IP 限流、可选活跃天数统计）；本地 HTTP（`npm run dev`）和 stdio（`npm run stdio`）。
- 工具链：`npm run new` / `validate`（结构、占位符、隐私扫描）/ `build`（Worker + 提示词包）。
- 评测：`eval/run.mjs` 生成三种条件的盲评包，`eval/rate.html` 离线打分，`eval/analyze.mjs` 出报告（bootstrap 置信区间、配对检验、Krippendorff's α）。
- Gallery：本人授权的分身登记、在线探测、目标进度自动统计。
- 示例：虚构人物“周屿”（连锁茶饮运营总监）。
