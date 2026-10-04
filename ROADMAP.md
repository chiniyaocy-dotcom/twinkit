# 路线图

## v0.1（当前）
- 人格包格式 `twinkit-persona/1`，空白模板 + 虚构示例
- MCP 引擎：`work_brief` / `review` / `find_examples` / `get_profile`
- Cloudflare Workers 部署（公开 / 令牌、限流、活跃天数统计），本地 HTTP 与 stdio
- 盲评工具链和预先登记的评测协议
- Gallery 与目标进度统计

## v0.2：上手更快
- `npx twinkit` 命令行：不用克隆仓库就能 new / dev / deploy
- 内置“采访”提示词（MCP prompt）：在任意客户端里让 AI 采访你，直接写出人格包文件
- 英文版工作简报和审稿报告
- 更好的检索：同义词、按交付物加权

## v0.3：越用越像
- 纠错回路：使用中发现“不像”，分身提出对人格包的修改建议，**本人确认后**才写入
- 人格包版本和快照对比：每次修改后自动跑一组回归任务，看“像本人”分有没有下降

## v0.4：分级权限
- L0 只读简报（当前）→ L1 起草到指定位置 → L2 对外动作（必须本人逐次确认）
- 调用审计日志（只记录元数据）

## 研究
- 首份 5 人合并评测报告
- 多模型对比：同一个人格包在不同模型上的“像本人”分
- 公开的匿名评测数据集（经参与者同意）

想推动哪一项？到 [Discussions](https://github.com/chiniyaocy-dotcom/twinkit/discussions) 说说你的场景。
