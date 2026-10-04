# TwinKit

**Turn the way you work into a digital twin that any AI can plug into — and measure how much it actually sounds like you.**

[中文](README.md) · MIT · zero dependencies · MCP (Streamable HTTP)

Generic AI drafts are often *correct but not you*: right structure, empty phrasing, and trade-offs you would never make.

TwinKit is not a chatbot and not a voice/face clone. It captures what makes your work valuable — **how you decide, your quality bar, the decisions you have made, your taste, and your voice** — in a plain-Markdown *persona pack*, and serves it as an [MCP](https://modelcontextprotocol.io) server. Claude, Cursor, VS Code, Codex and other MCP clients ask your twin for a **work brief** before they start, and **review** the draft against your standards when they finish.

## Try the demo (30 seconds)

The demo twin "Zhou Yu" is a **fictional** operations director of a bubble-tea chain ([source pack](examples/zhou-yu/), in Chinese).

```bash
claude mcp add --transport http zhou-yu https://twinkit-demo.2wpdmn54ks.workers.dev/mcp
```

Cursor: `{"mcpServers": {"zhou-yu": {"url": "https://twinkit-demo.2wpdmn54ks.workers.dev/mcp"}}}` · VS Code: `{"servers": {"zhou-yu": {"type": "http", "url": "…/mcp"}}}` · stdio-only clients: `npx -y mcp-remote https://twinkit-demo.2wpdmn54ks.workers.dev/mcp`. More in [docs/clients.md](docs/clients.md).

## Build your own (about 30 minutes)

Node.js 18+, nothing to install.

```bash
# Click "Use this template" (choose Private if your pack is confidential), then clone it
npm run new        # creates an empty persona/ pack
                   # fill it in — or paste docs/interview-prompt.md into any AI and let it interview you
npm run validate   # structure, leftover placeholders, privacy scan (phone numbers, IDs, emails, API keys)
npm run dev        # local server at http://127.0.0.1:8787
npm run deploy     # Cloudflare Workers (free tier: 100k requests/day)
```

Section names and metadata keys accept English (`## Principles`, `## Never`, `## Quality bar`, `## Deliverables`, `- Keywords:` …) — see [docs/persona-spec.md](docs/persona-spec.md). Generated briefs are currently in Chinese; English output is on the [roadmap](ROADMAP.md).

## What the twin exposes

| | |
|---|---|
| `work_brief` tool | Picks the relevant methods, past decisions, taste and voice for a task and assembles a brief: role lock, deliverable structure, checklist, prohibitions |
| `review` tool | Flags missing sections, overreach (promising/approving on the owner's behalf), words the owner never uses, and numbers without a source |
| `find_examples`, `get_profile` | Full-text cases and the profile |
| `work_as_twin` prompt, `twin://profile`, `twin://prompt-pack` | For clients that support prompts/resources |
| `/prompt.md` | A single prompt pack for tools without MCP |

All tools are read-only.

## Measuring "does it sound like me?"

`eval/` runs a blind, pre-registered experiment: the same model answers ~20 of your real tasks under three conditions — *task only*, *"you are a <role>"*, and *with your twin* (plus, optionally, your own handwritten answers). You and at least two people who know your work rate each answer 1–5 for likeness and usability in an offline page with the sources hidden. `eval/analyze.mjs` reports means with task-level bootstrap 95% CIs, paired twin-vs-role differences and win rates, Krippendorff's α, and whether raters can pick out your own answer. Protocol: [docs/eval-protocol.md](docs/eval-protocol.md).

**Status:** tooling is ready; we are recruiting the first five volunteers. We do not claim any effect size until real results are published.

## Safety

The twin always discloses that it is an AI, only represents the person who built it (or who gave explicit consent), and cannot promise, sign, approve, pay or publish on the owner's behalf. See [docs/safety.md](docs/safety.md).

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If you would like to be one of the first five people to try TwinKit with your real persona pack, [open a pilot issue](https://github.com/chiniyaocy-dotcom/twinkit/issues/new?template=persona_pilot.md).

License: [MIT](LICENSE)
