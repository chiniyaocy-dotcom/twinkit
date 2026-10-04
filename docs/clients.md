# 接入各种 AI 客户端

下面用演示地址举例，换成你自己的地址即可：

```text
https://twinkit-demo.2wpdmn54ks.workers.dev/mcp
```

私有模式需要加请求头 `Authorization: Bearer <令牌>`；客户端不支持自定义请求头时，改用 `https://…/t/<令牌>/mcp`（令牌会出现在地址里，注意不要截图外传）。

> 各客户端的界面和配置格式更新很快，以官方文档为准。

## Claude Code

```bash
claude mcp add --transport http zhou-yu https://twinkit-demo.2wpdmn54ks.workers.dev/mcp
# 私有模式：
claude mcp add --transport http my-twin https://my-twin.example.workers.dev/mcp --header "Authorization: Bearer <令牌>"
```

## Claude（网页版 / 桌面版）

设置 → Connectors（连接器）→ 添加自定义连接器，填入 MCP 地址（可用性以 Claude 当前套餐规则为准）。

也可以在桌面版的 `claude_desktop_config.json` 里用本地 stdio 桥接：

```json
{
  "mcpServers": {
    "zhou-yu": { "command": "npx", "args": ["-y", "mcp-remote", "https://twinkit-demo.2wpdmn54ks.workers.dev/mcp"] }
  }
}
```

## Cursor

`~/.cursor/mcp.json`（全局）或项目里的 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "zhou-yu": { "url": "https://twinkit-demo.2wpdmn54ks.workers.dev/mcp" }
  }
}
```

私有模式加 `"headers": { "Authorization": "Bearer <令牌>" }`。

## VS Code（GitHub Copilot 智能体模式）

项目里的 `.vscode/mcp.json`：

```json
{
  "servers": {
    "zhou-yu": { "type": "http", "url": "https://twinkit-demo.2wpdmn54ks.workers.dev/mcp" }
  }
}
```

私有模式同样可以加 `"headers"`。

## Codex CLI

`~/.codex/config.toml`，用 stdio 桥接：

```toml
[mcp_servers.zhou-yu]
command = "npx"
args = ["-y", "mcp-remote", "https://twinkit-demo.2wpdmn54ks.workers.dev/mcp"]
```

## Gemini CLI

`~/.gemini/settings.json`：

```json
{
  "mcpServers": {
    "zhou-yu": { "httpUrl": "https://twinkit-demo.2wpdmn54ks.workers.dev/mcp" }
  }
}
```

## Cherry Studio 等桌面客户端

在 MCP 服务器设置里新建一个服务器，类型选 “Streamable HTTP”（可流式传输的 HTTP），填入地址。

## 本地 stdio（不经过网络）

任何支持 stdio 的客户端都可以直接运行本地人格包：

```json
{
  "command": "node",
  "args": ["/绝对路径/twinkit/scripts/stdio.mjs", "--persona", "/绝对路径/twinkit/persona"]
}
```

## 不支持 MCP 的 AI

打开 `https://<你的地址>/prompt.md`（私有模式需要令牌），或者使用本地构建出的 `dist/prompt.md`，把全文粘贴到 ChatGPT 的 GPTs / 项目说明、Claude 的 Projects、Kimi、豆包等的自定义指令里。提示词包包含全部内容，但没有“按任务调取”和 `review` 自检。

## 用起来

接好以后，直接说“用 <名字> 的方式……”。如果 AI 没有主动调用工具，可以明确说：“先调用 work_brief 拿工作简报，写完用 review 自检。”
