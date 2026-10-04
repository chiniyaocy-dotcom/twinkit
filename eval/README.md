# 评测：分身像不像本人？

三步完成一次盲评。协议和判定标准见 [docs/eval-protocol.md](../docs/eval-protocol.md)。

## 0. 准备任务

复制 [tasks.example.md](tasks.example.md) 为 `eval/tasks.md`，换成你自己的 20 个真实任务。有时间的话，挑 5 个以上任务在看到 AI 输出**之前**写下你自己的版本（`### 本人答案`），用来测试评委能不能认出你。

登记任务（可选但推荐）：`shasum -a 256 eval/tasks.md`，把结果贴到 Discussions 的[“评测登记”帖](https://github.com/chiniyaocy-dotcom/twinkit/discussions/2)里。

## 1. 生成回答和盲评包

```bash
# 默认用 GitHub Models（免费额度）：需要一个有 models:read 权限的 GitHub 令牌
export GITHUB_TOKEN=...
node eval/run.mjs --tasks eval/tasks.md

# 也可以用其他兼容 OpenAI 接口的服务
node eval/run.mjs --tasks eval/tasks.md --provider deepseek      # DEEPSEEK_API_KEY
node eval/run.mjs --tasks eval/tasks.md --provider dashscope     # DASHSCOPE_API_KEY（通义千问）
node eval/run.mjs --tasks eval/tasks.md --provider openai        # OPENAI_API_KEY
node eval/run.mjs --tasks eval/tasks.md --base-url https://…/v1 --model 模型名 --api-key-env 你的环境变量

# 只检查流程、不调用模型
node eval/run.mjs --dry-run
```

输出目录默认是 `eval/runs/<日期>-<标识>/`（已在 `.gitignore` 里）：

| 文件 | 用途 |
|---|---|
| `outputs.json` | 全部回答和提示词（复现用） |
| `rate.html` | **发给评委**：双击就能打分，盲评包已经内置 |
| `rating-pack.json` | 同样的盲评包（也可以用 `eval/rate.html` 手动加载） |
| `key.json` | 答案表：**只有你能看**，不要发给评委 |

中途失败了就再运行一次同样的命令，会从断点续跑（跨天续跑时加 `--out` 指向原来的目录）。GitHub Models 免费额度有每分钟和每天的请求上限，默认每次调用间隔 4.5 秒；20 个任务 × 3 个条件 = 60 次调用。

也可以在 GitHub Actions 里运行：Actions → “生成评测盲评包” → Run workflow，生成结果在 artifact 里下载。注意：**公开仓库**的 artifact 任何登录用户都能下载，里面有答案表 `key.json` 和全部回答——请在私有仓库里运行（用 “Use this template” 建私有仓库即可），或者在本地运行。

## 2. 请评委打分

把 `rate.html` 发给你自己和至少 2 位了解你工作方式的人。页面完全离线，进度会保存在评委自己的浏览器里，可以分几次完成。做完后评委点“下载评分文件”发回给你；下载不了就点“复制内容”，粘贴给你也行。

## 3. 生成报告

把收回的文件放进 `eval/runs/<目录>/ratings/`（文件名和扩展名都不限，粘贴来的内容存成 `.txt` 也行）。同一个代号交了多份时，只保留完成度最高、最新的一份；完成度不足 80% 的按协议排除，报告里会列出被排除的文件和原因。

```bash
node eval/analyze.mjs --run eval/runs/<目录>
# 多人合并：
node eval/analyze.mjs --run eval/runs/a --run eval/runs/b --out eval/reports/合并
```

得到 `report.md`（给人看）和 `summary.json`（给程序看）。如果愿意公开，把报告链接写进你的 Gallery 条目的 `eval.report` 字段。
