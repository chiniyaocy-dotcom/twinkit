# 部署

TwinKit 构建出来的是一个**单文件**的 `dist/worker.js`，标准 `fetch` 接口，没有任何依赖。推荐部署到 Cloudflare Workers（免费额度每天 10 万次请求），也可以在本地或任何能跑 Node 的地方运行。

## 先在本地跑通

```bash
npm run validate          # 检查人格包
npm run dev               # http://127.0.0.1:8787 （改完人格包刷新即可生效）
npm run dev -- --token abc   # 模拟私有模式：需要 Authorization: Bearer abc
```

## Cloudflare Workers（命令行）

1. 编辑 `wrangler.toml`：把 `name = "my-twin"` 改成你的分身名。
2. 登录并部署：

   ```bash
   npx wrangler login
   npm run deploy
   ```

   `wrangler` 会先运行 `node scripts/build.mjs`，再上传 `dist/worker.js`。完成后得到地址 `https://<name>.<你的子域>.workers.dev`，MCP 地址是后面加 `/mcp`。
3. 验证：

   ```bash
   curl https://<name>.<你的子域>.workers.dev/health
   ```

### 公开模式与私有模式

| | 公开（默认） | 私有 |
|---|---|---|
| 设置 | `TWIN_PUBLIC = "true"` | `TWIN_PUBLIC = "false"`，再运行 `npx wrangler secret put TWIN_TOKEN` |
| 谁能用 | 任何知道地址的人 | 持有令牌的人 |
| 客户端配置 | 只填地址 | 加请求头 `Authorization: Bearer <令牌>`；不支持自定义请求头的客户端用 `https://…/t/<令牌>/mcp` |
| 落地页 / `/health` | 显示名字和接入说明 | 不显示名字 |
| 能否进 Gallery | 可以 | 不可以 |

**公开模式下，任何人都能通过工具读到人格包的全部内容。** 不想公开的内容请用私有模式，同时把 GitHub 仓库设为 Private。

两个都没设置时，分身会返回 503 并提示你选择一种模式。

### 限流

`wrangler.toml` 里默认开启了按 IP 限流（每 60 秒 60 次）。限流器出错时会放行，不会影响正常使用。不需要可以删掉 `[[ratelimits]]` 那一段。

### 活跃天数统计（可选）

想知道分身是不是真的在被使用（以及登记到 Gallery 后参与“持续使用”统计），可以开启一个极简的统计：

```bash
npx wrangler kv namespace create TWIN_STATS
```

把输出的 `id` 填进 `wrangler.toml` 里 `[[kv_namespaces]]` 那一段并取消注释。它只记录“哪天有过工具调用”（每天最多写一次），不记录任何内容、IP 或身份信息。想在 `/health` 公开“近 28 天活跃天数”，再把 `TWIN_PUBLIC_STATS` 改成 `"true"`。

### 自定义域名

在 Cloudflare 控制台 → Workers → 你的 Worker → Settings → Domains & Routes 添加自定义域名，MCP 地址相应变成 `https://你的域名/mcp`。

### 更新与回滚

改完人格包后再运行一次 `npm run deploy`。部署出错可以 `npx wrangler rollback` 回到上一个版本。建议在 `persona.md` 里同步更新 `快照日期`。

## Cloudflare Workers（不用命令行）

1. 本地运行 `npm run build`，得到 `dist/worker.js`。
2. Cloudflare 控制台 → Workers & Pages → Create → 选 “Hello World” 模板 → Deploy。
3. 点 “Edit code”，删掉原来的代码，把 `dist/worker.js` 的全部内容粘贴进去 → Deploy。
4. Settings → Variables and Secrets：添加 `TWIN_PUBLIC` = `true`（或者添加 Secret `TWIN_TOKEN` 走私有模式）。

这种方式没有限流和统计（需要在控制台的 Bindings 里另外添加）。

## 本地 stdio（不部署）

只给自己用、或者客户端只支持本地命令时：

```json
{
  "command": "node",
  "args": ["/绝对路径/twinkit/scripts/stdio.mjs", "--persona", "/绝对路径/twinkit/persona"]
}
```

各客户端的具体写法见 [clients.md](clients.md)。stdio 模式每次启动都会重新读取人格包。

## 其他平台

`dist/worker.js` 只用到 Web 标准 API（`Request` / `Response` / `URL`），理论上可以运行在 Deno Deploy、Vercel Edge 等支持 `export default { fetch }` 的平台。也可以在服务器上运行 `node scripts/serve.mjs --host 0.0.0.0 --port 8787`，前面放一个 HTTPS 反向代理。这些方式没有内置限流，请自行处理。
