# dsh-commandcode-provider

**English** | [简体中文](#简体中文)

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **A lightweight plugin — almost no extra dependencies.** It is plain JavaScript (no build step, no framework), ships only two small files plus a one-file patch, and its sole runtime dependency is `@deepseek-ai/schemastery`, which any dsh plugin already has. Everything else it uses comes from the dsh host itself (`ctx.web`, the settings seam, the credentials seam, the loopback bridge).

One-click sync of [CommandCode](https://commandcode.ai) subscription-tier models into DeepSeek Harness' `llm-pi-ai` provider configuration, with a "Create / Update" button in the settings page. Existing target providers are only refreshed (model list updated) — your configured keys and base URLs are preserved. On top of that, it can replace dsh's built-in web search (no separate search API key needed) and show your CommandCode account usage right in the settings card.

## Why this plugin

- **dsh's `llm-pi-ai` provider catalog is a static snapshot** that never refreshes itself. CommandCode's [Provider API](https://commandcode.ai/docs/provider) currently lists 61 models and grows continuously (each with its own context/pricing/capabilities). Hand-copying them into the provider configuration is impractical and goes stale.
- **The official `/provider/v1/models` endpoint returns only id / name / context_length** — no reasoning or vision capability info. This plugin additionally parses the complete per-model catalog embedded in the official [GOAT plan page](https://commandcode.ai/docs/plans/goat) (`reasoning` / `vision` / `caps` / four pricing fields / min plan) and maps capabilities correctly into dsh config.
- **Subscription tiers**: CommandCode has multiple tiers (Go / GOAT / Pro / Max); models accrue by `minPlanName`. The plugin offers a "Subscription" dropdown; each tier maps to its **own independent model provider**, so tiers never overwrite each other.
- **Mixed routing**: CommandCode serves both an OpenAI-compatible (`/chat/completions`) and an Anthropic-compatible (`/messages`) endpoint; sending Claude models to the wrong endpoint returns 400. The plugin splits models automatically: Claude models go into `commandcode-<plan>-anthropic` (`api: anthropic-messages`), everything else into `commandcode-<plan>-autosync` (`api: openai-completions`).
- **Web search without a second API key**: stock dsh needs a separate `DEEPSEEK_API_KEY` before the model's `web_search` tool works at all. This plugin serves the same tool from your CommandCode account key, so one subscription covers chat and search — no dsh search key to configure or pay for.
- **Account usage at a glance**: the settings card shows live CommandCode usage (five-hour/weekly window limits with progress bars, monthly credits, request/cost/token totals), so you can see a rate-limit or out-of-credits wall coming before you hit it.

## Tiers and providers

| Subscription (dropdown) | Total models | Includes | Generated providers |
| --- | --- | --- | --- |
| `goat` (default) | 43 | Go + GOAT open models (no Claude) | `commandcode-goat-autosync` |
| `pro` | 56 | everything in goat + Pro tier (Claude Sonnet/Haiku, GPT, Gemini, …) | `commandcode-pro-autosync` + `commandcode-pro-anthropic` |
| `max` | 61 | all models (incl. Claude Opus/Fable, Fugu Ultra) | `commandcode-max-autosync` + `commandcode-max-anthropic` |

Tiers are **cumulative** (defined by the `minPlanName` field, matching the official docs: the Pro page states "includes everything in the GOAT plan"). The Go tier offers no API access (403) so it is not an option.

## Mapping rules (upstream → llm-pi-ai YAML)

| Upstream (official catalog) | llm-pi-ai model field |
| --- | --- |
| `contextWindow` / `context_length` | `contextWindow` |
| `vision: true` | `input: ["text", "image"]` (else `["text"]`) |
| `reasoning: false` | `reasoningEfforts: false` (disable thinking parameters) |
| `reasoning: true` | no `reasoningEfforts` written; governed by provider `compat.supportsReasoningEffort` |
| `minPlanName` | filters models by the selected tier |
| `vendor: Anthropic` (or id starting with `claude-`) | routed into the `api: anthropic-messages` provider |
| everything else | routed into the `api: openai-completions` provider |

The official catalog has no per-model reasoning-effort list (e.g. `low/medium/high`), so the plugin does not invent one; `reasoning: true` models rely on the provider-level `compat: {thinkingFormat: "openai", supportsReasoningEffort: true}` (overridable via `targetCompat`).

## Web search (optional)

When enabled, the plugin's **Command Code search provider** backs dsh's model-facing `web_search` tool via the Command Code Provider API's `/alpha/web-search` endpoint — the **same API key and account** as your chat traffic, so no separate search key or endpoint is configured.

**Why this is useful:** stock dsh ships web search backed by DeepSeek's own Messages API, which means you need a **separate `DEEPSEEK_API_KEY`** (billed on top of whatever you pay for chat) before the model can search at all. With a CommandCode subscription you already have an account key that unlocks search — this plugin reuses that **same key** for search, so you no longer depend on dsh's own search API key. One subscription, one key: chat and search both covered.

- Served on the dsh web seam (`ctx.web`) as provider id `commandcode`, and auto-selected while the toggle is on (restoring the previous search provider when toggled off or when the plugin unloads).
- `numResults` is clamped to Command Code's range (1–10, default 5); results map to dsh's `WebSearchSource` shape (`url`/`title`/`snippet`).
- Requires the account key (`COMMANDCODE_API_KEY` by default — the same credential the chat providers use). Off by default; enable in the settings card (takes effect immediately after Save, no restart).

## Usage dashboard (optional)

The settings card also shows **account usage** — requests, success rate, cost, tokens, credit balances, and the 5-hour/weekly window limits — fetched Host-side from the account endpoints (`/alpha/whoami`, `/alpha/usage/summary`, `/alpha/billing/credits`, `/alpha/billing/subscriptions`) with the same account key. The key never leaves the host.

**What you get at a glance:** how many requests you have left in the current five-hour and weekly windows (with progress bars and reset times), how many credits your plan still has this month, and your recent request/success/cost/token totals — so you can see whether a rate-limit or "out of credits" wall is approaching before you hit it, and confirm that a session actually consumed what you expected.

- Each endpoint degrades independently: a transient failure shows a partial-data note instead of blanking the card; when every endpoint fails the same way the card names the cause (invalid key / service unavailable / network).
- The usage endpoints live on the API root (`/alpha/*`), which is distinct from the chat base `/provider/v1`. Use the **Usage / search API base** field in the card if your deployment differs.

## Install

The settings page rides dsh's settings API, which changed in the `0.1.7-alpha.1` line, so pick the plugin tag that matches the dsh you run:

| dsh | Plugin | Install (`web` profile) |
| --- | --- | --- |
| `0.1.7-alpha.1` … `<0.2.0` | `v0.2.1` | `dsh plugin --profile web add github:CJYLZS/dsh-commandcode-provider#v0.2.1` |
| `0.1.7-alpha.1` … `<0.2.0` | `v0.2.0` (Plugins page only) | `dsh plugin --profile web add github:CJYLZS/dsh-commandcode-provider#v0.2.0` |
| `0.1.5-rc.3` and older | `v0.1.3` | `dsh plugin --profile web add github:CJYLZS/dsh-commandcode-provider#v0.1.3` |

`#<ref>` is the Git ref the install resolves. Without one, the repository's default branch is installed, which tracks the newest line.

For a local checkout, link the directory instead of copying it — a later edit applies on the next restart, with no reinstall:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-commandcode-provider
```

Restart dsh Web after installing, then open **Settings → CommandCode**, or the **Plugins** page's bundle card and **Configure** on its row — both mount the same page. Choose the subscription (default `goat`) and click **Create / Update**.

### dsh compatibility

| dsh | Plugin | Settings surface |
| --- | --- | --- |
| `≥ 0.1.7-alpha.1` | `v0.2.1` | A page of its own in Settings (`settings.section`, nav label **CommandCode**), beside the Plugins page's row configuration |
| `≥ 0.1.7-alpha.1` | `v0.2.0` | The Plugins page's row configuration (`plugins.row.config`) only |
| `≤ 0.1.5-rc.3` | `v0.1.3` | A registered settings section (`settings.register` / `installSection`), listed with the model providers |

`v0.2.1` and `v0.2.0` both read and write their configuration as live references of their own Cordis `Config`; `v0.2.1` adds the standalone Settings page. `v0.1.3` uses the removed `settings.register` / `installSection` API and the retired `settings.plugin.item` slot, so it does not load on `0.1.7-alpha.1` or later.

A mismatch shows up as `web boot: 1 entry did not activate … pending (waiting for service: settingsScope)` in the browser, and as `settings.register is not a function` for this package in `$DSH_HOME/logs/startup-*.log` when running `v0.1.3` on the newer dsh.

## API key setup

After you click **Create / Update**, the plugin auto-creates a model provider for your tier — `commandcode-goat-autosync` by default (with `commandcode-pro-…` / `commandcode-max-…` for the other tiers). That provider is where the API key goes.

**Recommended — via the dsh Models page:**

1. In dsh, go to **Settings → Models** (the page lists every provider, including the one this plugin created).
2. Find **`commandcode-goat-autosync`** (or your tier's provider) and click **Edit**.
3. Paste your CommandCode API key into the **API key** field and **Save**.

That's it — the key is stored in dsh's credential store and is used for chat, web search, and the usage card alike.

**Alternative — environment variable:** `export COMMANDCODE_API_KEY=cmd_xxx` before starting dsh. (The plugin's config option `targetApiKeyEnv` renames the variable it reads.)

Where does the key come from? Create one on the [commandcode.ai](https://commandcode.ai) Studio API keys page (all tiers except Go; GOAT/Pro/Max bill against subscription credits, Provider plans are pay-as-you-go).

## Configuration

| Field | Default | Description |
| --- | --- | --- |
| `sourceURL` | `https://api.commandcode.ai/provider/v1/models` | Official live model list |
| `catalogURL` | `https://commandcode.ai/docs/plans/goat` | Official GOAT plan page (capability catalog); falls back to the plain list when it fails |
| `plan` | `goat` | Subscription tier: `goat` / `pro` / `max` |
| `targetApiKeyEnv` | `COMMANDCODE_API_KEY` | Credential environment variable name |
| `targetBaseURL` | `https://api.commandcode.ai/provider/v1` | API base URL |
| `targetCompat` | `{thinkingFormat: "openai", supportsReasoningEffort: true}` | compat override for the openai route |
| `extraIds` | `[]` | Extra private model ids to write (outside the catalog, into the openai-route provider) |
| `autoSync` | `false` | Periodic auto-sync (off by default; enable in the card) |
| `autoSyncIntervalMs` | `6h` | Auto-sync interval (min 60s) |
| `webSearch` | `false` | Serve dsh's `web_search` with Command Code (`/alpha/web-search`) |
| `usageBaseURL` | `https://api.commandcode.ai` | API root for usage/search endpoints (`/alpha/*`) |

Target provider names are derived from `plan` (`commandcode-<plan>-autosync` / `commandcode-<plan>-anthropic`); no separate configuration needed.

## FAQ

**What happens when I switch tiers?** Pick the new tier in the dropdown and Save, then click **Create / Update**: the new tier's provider is created; the old tier's provider is left untouched (tiers never overwrite each other). Remove a stale provider manually.

**Why is there no `commandcode-goat-anthropic`?** The GOAT tier contains only open models — no Claude — so no Anthropic-route provider is generated.

**How do Claude models work?** The official API requires Claude on `/messages` (Anthropic format). The `pro` / `max` tiers automatically create `commandcode-<plan>-anthropic` (`api: anthropic-messages`); calling a Claude id through an OpenAI-route provider returns 400.

**Why do some models have no reasoning efforts?** The official catalog only marks `reasoning: true/false`, no effort lists. `reasoning: false` models get `reasoningEfforts: false` so dsh never sends thinking parameters; `reasoning: true` models are governed by `compat.supportsReasoningEffort`.

**What if I call a model above my tier?** The catalog filters strictly by `minPlanName`, so written models are all inside the selected tier; when upstream adds a model the catalog has not yet indexed, the plugin writes the full plain list (degraded mode, with a warning in the result).

---

# 简体中文

[English](#dsh-commandcode-provider) | **简体中文**

> **轻量插件——几乎没有额外依赖。** 纯 JavaScript 实现（无构建步骤、无框架），只附带两个小文件加一个单文件 patch；唯一的运行时依赖是 `@deepseek-ai/schemastery`，而这是任何 dsh 插件本来就会装的。其余能力全部来自 dsh 宿主本身（`ctx.web`、settings 能力缝、凭据能力缝、loopback bridge）。

一键把 [CommandCode](https://commandcode.ai) 所选订阅档位的模型同步到 DeepSeek Harness 的 `llm-pi-ai` 供应商配置中，并在设置页提供「一键创建/更新」按钮。已存在目标供应商时只刷新模型列表，用户配置的密钥与地址保持不变。除此之外，它还能替代 dsh 自带的 web 搜索（无需单独的搜索 API key），并在设置卡片里直接展示你的 CommandCode 账户用量。

## 为什么要用这个插件

- **DSH 的 llm-pi-ai 供应商目录是静态快照**，不会自己刷新。CommandCode 的 [Provider API](https://commandcode.ai/docs/provider) 现有 61 个模型且持续上新（每款有各自的上下文/价格/能力），手抄进供应商配置既不现实也容易过期。
- **官方的 `/provider/v1/models` 接口只返回 id / name / context_length**，没有任何推理（thinking）或视觉能力信息。插件额外解析官方 [GOAT 计划页](https://commandcode.ai/docs/plans/goat) 内嵌的完整目录（每模型含 `reasoning` / `vision` / `caps` / 四项定价 / 最低计划要求），把能力正确映射进 DSH 配置。
- **订阅分档**：CommandCode 区分多个档位（Go / GOAT / Pro / Max），模型按 `minPlanName` 累计归属。插件提供「订阅类型」下拉框，每个档位对应**独立的模型供应商**，互不覆盖。
- **混合路由问题**：CommandCode 提供 OpenAI 兼容（`/chat/completions`）与 Anthropic 兼容（`/messages`）两套端点，Claude 系列走错端点会直接 400。插件按模型自动拆分：Claude 进 `commandcode-<档位>-anthropic`（`api: anthropic-messages`），其余进 `commandcode-<档位>-autosync`（`api: openai-completions`）。
- **搜索无需第二把 API key**：原版 dsh 要单独的 `DEEPSEEK_API_KEY`，模型的 `web_search` 工具才能用。本插件直接用你的 CommandCode 账户 key 提供同一个搜索工具——一个订阅同时覆盖聊天和搜索，不用再配置、再付费买 dsh 的搜索 key。
- **用量一眼可见**：设置卡片直接展示 CommandCode 实时用量（5 小时/周窗口限额带进度条、本月剩余额度、请求/成本/Token 汇总），限流或额度耗尽之前就能提前看到。

## 订阅档位与供应商

| 订阅类型（下拉框） | 模型总数 | 包含 | 生成的供应商 |
| --- | --- | --- | --- |
| `goat`（默认） | 43 | Go + GOAT 开源模型（无 Claude） | `commandcode-goat-autosync` |
| `pro` | 56 | goat 全部 + Pro 档（Claude Sonnet/Haiku、GPT、Gemini 等） | `commandcode-pro-autosync` + `commandcode-pro-anthropic` |
| `max` | 61 | 全部模型（含 Claude Opus/Fable、Fugu Ultra） | `commandcode-max-autosync` + `commandcode-max-anthropic` |

档位是**累计包含**关系（`minPlanName` 字段定义，与官方文档一致：Pro 页写明 "includes everything in the GOAT plan"）。Go 档不提供 API 访问（403），因此不在选项中。

## 映射规则（上游 → llm-pi-ai YAML）

| 上游（官方目录） | llm-pi-ai 模型字段 |
| --- | --- |
| `contextWindow` / `context_length` | `contextWindow` |
| `vision: true` | `input: ["text", "image"]`（否则 `["text"]`） |
| `reasoning: false` | `reasoningEfforts: false`（禁用思考参数） |
| `reasoning: true` | 不写 `reasoningEfforts`，由供应商 `compat.supportsReasoningEffort` 决定 |
| `minPlanName` | 按所选档位过滤模型 |
| `vendor: Anthropic`（或 id 以 `claude-` 开头） | 归入 `api: anthropic-messages` 供应商 |
| 其余模型 | 归入 `api: openai-completions` 供应商 |

官方目录没有每个模型的思考档位列表（如 `low/medium/high`），因此插件不臆造档位映射；`reasoning: true` 的模型直接依赖供应商级 `compat: {thinkingFormat: "openai", supportsReasoningEffort: true}`（可通过 `targetCompat` 覆盖）。

## Web 搜索（可选）

开启后，插件的 **Command Code 搜索供应商** 为 dsh 的模型 `web_search` 工具提供后端，走 Command Code Provider API 的 `/alpha/web-search` 端点——与聊天**同一个 API Key、同一个账户**，无需单独配置搜索 key 或端点。

**为什么值得开：** 原版 dsh 的 web 搜索由 DeepSeek 自己的 Messages API 提供，意味着你需要再配一个**单独的 `DEEPSEEK_API_KEY`**（在聊天费用之外另行计费），模型才能搜索。而只要你有 CommandCode 订阅，账户 key 本身就解锁搜索能力——本插件直接复用这把**同一个 key** 做搜索，从此不再依赖 dsh 自己的搜索 API key。一个订阅、一把 key，聊天和搜索都搞定。

- 注册在 dsh web 能力缝（`ctx.web`）上，provider id 为 `commandcode`；开关开启期间自动被选中（关闭或插件卸载时恢复之前的搜索供应商）。
- `numResults` 会被钳制在 Command Code 的范围内（1–10，默认 5）；结果映射为 dsh 的 `WebSearchSource` 结构（`url`/`title`/`snippet`）。
- 需要账户 key（默认 `COMMANDCODE_API_KEY`——与聊天供应商同一个凭据）。默认关闭；在设置卡片里开启（保存后立即生效，无需重启）。

## 用量统计（可选）

设置卡片同时展示**账户用量**——请求数、成功率、成本、Token、额度余额以及 5 小时/周窗口限额——数据在宿主侧用同一个账户 key 从账户端点（`/alpha/whoami`、`/alpha/usage/summary`、`/alpha/billing/credits`、`/alpha/billing/subscriptions`）抓取。key 不会离开宿主。

**一眼看清：** 当前 5 小时/周窗口还剩多少请求（带进度条与重置时间）、本月套餐还剩多少额度，以及最近的请求数/成功率/成本/Token 汇总——在撞上「限流」或「额度耗尽」之前就能提前发现，也能确认某次会话实际消耗是否符合预期。

- 每个端点独立降级：某个端点临时失败时显示局部数据提示而不会清空整卡；当所有端点以同一方式失败时，卡片会点明原因（key 无效 / 服务不可用 / 网络错误）。
- 用量端点位于 API 根路径（`/alpha/*`），与聊天的 `/provider/v1` 基址不同。如果部署环境不同，请使用卡片中的「用量/搜索 API 地址」字段。

## 安装

设置页依赖 dsh 的 settings API，而它在 `0.1.7-alpha.1` 这一代有变更，所以请按你正在运行的 dsh 选择插件 tag：

| dsh | 插件版本 | 安装命令（`web` profile） |
| --- | --- | --- |
| `0.1.7-alpha.1` … `<0.2.0` | `v0.2.1` | `dsh plugin --profile web add github:CJYLZS/dsh-commandcode-provider#v0.2.1` |
| `0.1.7-alpha.1` … `<0.2.0` | `v0.2.0`（仅插件页） | `dsh plugin --profile web add github:CJYLZS/dsh-commandcode-provider#v0.2.0` |
| `0.1.5-rc.3` 及更早 | `v0.1.3` | `dsh plugin --profile web add github:CJYLZS/dsh-commandcode-provider#v0.1.3` |

`#<ref>` 就是安装时解析的 Git ref。不写时安装仓库默认分支，也就是最新的一代。

本地检出则用链接方式安装，避免拷贝——之后每次改动在重启后生效，不需要重新安装：

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-commandcode-provider
```

安装后重启 DSH Web，打开 **设置 → CommandCode**，或从 **插件（Plugins）** 页进入本 bundle 卡片并在该行点 **配置（Configure）**——两处打开的是同一个页面。选择订阅类型（默认 goat），点击 **一键创建/更新**。

### dsh 兼容性

| dsh | 插件版本 | 设置界面 |
| --- | --- | --- |
| `≥ 0.1.7-alpha.1` | `v0.2.1` | 设置页里独立的 **CommandCode** 页（`settings.section`），与插件页的行配置并存 |
| `≥ 0.1.7-alpha.1` | `v0.2.0` | 仅插件页的行配置（`plugins.row.config`） |
| `≤ 0.1.5-rc.3` | `v0.1.3` | 注册式设置节（`settings.register` / `installSection`），与模型供应商并列显示 |

`v0.2.1` 与 `v0.2.0` 都把配置读写为自身 Cordis `Config` 的实时引用，`v0.2.1` 在此之上增加了设置页里的独立页面；`v0.1.3` 用的是已被删除的 `settings.register` / `installSection` 与已退役的 `settings.plugin.item`，因此在 `0.1.7-alpha.1` 及之后无法加载。

版本不匹配时的表现：浏览器里 `web boot: 1 entry did not activate … pending (waiting for service: settingsScope)`；在新版 dsh 上运行 `v0.1.3` 时，`$DSH_HOME/logs/startup-*.log` 里本包会有 `settings.register is not a function`。

## API Key 配置

点击「一键创建/更新」后，插件会自动创建对应档位的**模型供应商**——默认是 `commandcode-goat-autosync`（其它档位为 `commandcode-pro-…` / `commandcode-max-…`）。API key 就配在这个自动创建的供应商上。

**推荐方式——在 dsh 的模型页配置：**

1. 进入 dsh 的 **设置 → 模型**（该页列出所有供应商，包括本插件自动创建的）。
2. 找到 **`commandcode-goat-autosync`**（或你档位对应的供应商），点击 **编辑**。
3. 在 **API 密钥** 输入框粘贴你的 CommandCode API key，点击 **保存**。

完成。key 会存入 dsh 的凭据库，聊天、web 搜索和用量卡片共用这一把。

**备选方式——环境变量：** 启动 dsh 前 `export COMMANDCODE_API_KEY=cmd_xxx`。（插件配置项 `targetApiKeyEnv` 可修改它读取的变量名。）

Key 从哪来？在 [commandcode.ai](https://commandcode.ai) Studio 的 API keys 页面创建（除 Go 计划外均可用；GOAT/Pro/Max 按套餐额度计费，Provider 计划按量付费）。

## 配置项

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `sourceURL` | `https://api.commandcode.ai/provider/v1/models` | 官方实时模型列表 |
| `catalogURL` | `https://commandcode.ai/docs/plans/goat` | 官方 GOAT 计划页（能力目录）；抓取失败时降级为纯列表 |
| `plan` | `goat` | 订阅档位：`goat` / `pro` / `max` |
| `targetApiKeyEnv` | `COMMANDCODE_API_KEY` | 凭据环境变量名 |
| `targetBaseURL` | `https://api.commandcode.ai/provider/v1` | API 基地址 |
| `targetCompat` | `{thinkingFormat: "openai", supportsReasoningEffort: true}` | openai 路由的 compat 覆盖 |
| `extraIds` | `[]` | 额外写入的私有模型 id（目录之外，进 openai 路由供应商） |
| `autoSync` | `false` | 定时自动同步（默认关闭，需在卡片里手动开启） |
| `autoSyncIntervalMs` | `6h` | 自动同步间隔（最小 60s） |
| `webSearch` | `false` | 用 CommandCode 提供 dsh 的 `web_search`（`/alpha/web-search`） |
| `usageBaseURL` | `https://api.commandcode.ai` | 用量/搜索端点所在 API 根路径（`/alpha/*`） |

目标供应商名由 `plan` 推导（`commandcode-<plan>-autosync` / `commandcode-<plan>-anthropic`），不需要单独配置。

## FAQ

**切换档位会怎样？** 下拉框选择新档位并保存后，点「一键创建/更新」会创建该档位的供应商；旧档位的供应商保留不动（互不覆盖）。想清理旧供应商需手动删除。

**为什么 goat 档没有 `commandcode-goat-anthropic`？** GOAT 档只含开源模型，没有 Claude，因此不会生成 Anthropic 路由供应商。

**Claude 模型怎么用？** 官方 API 要求 Claude 走 `/messages`（Anthropic 格式）。`pro` / `max` 档自动创建 `commandcode-<plan>-anthropic` 供应商（`api: anthropic-messages`）；若在 OpenAI 路由供应商里调用 Claude id，会得到 400。

**为什么有些模型没有思考档位？** 官方目录只标注 `reasoning: true/false`，不提供档位枚举。`reasoning: false` 的模型写入 `reasoningEfforts: false` 防止 DSH 发送思考参数；`reasoning: true` 的模型由 `compat.supportsReasoningEffort` 统一放行。

**调用超出档位的模型会怎样？** 目录按 `minPlanName` 严格过滤，写入的模型都在所选档位内；上游列表若新增模型而目录尚未收录，插件会按纯列表写入全部（降级模式，结果中带 warning 提示）。
