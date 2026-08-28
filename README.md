# dsh-commandcode-plan-autosync

一键把 [CommandCode](https://commandcode.ai) 所选订阅档位的模型同步到 DeepSeek Harness 的 `llm-pi-ai` 供应商配置中，并在设置页提供「一键创建/更新」按钮。已存在目标供应商时只刷新模型列表，用户配置的密钥与地址保持不变。

## 为什么要用这个插件

- **DSH 的 llm-pi-ai 供应商目录是静态快照**，不会自己刷新。CommandCode 的 [Provider API](https://commandcode.ai/docs/provider) 现有 61 个模型且持续上新（每款有各自的上下文/价格/能力），手抄进 `settings.yaml` 既不现实也容易过期。
- **官方的 `/provider/v1/models` 接口只返回 id / name / context_length**，没有任何推理（thinking）或视觉能力信息。插件额外解析官方 [GOAT 计划页](https://commandcode.ai/docs/plans/goat) 内嵌的完整目录（每模型含 `reasoning` / `vision` / `caps` / 四项定价 / 最低计划要求），把能力正确映射进 DSH 配置。
- **订阅分档**：CommandCode 区分多个档位（Go / GOAT / Pro / Max），模型按 `minPlanName` 累计归属。插件提供「订阅类型」下拉框，每个档位对应**独立的模型供应商**，互不覆盖。
- **混合路由问题**：CommandCode 提供 OpenAI 兼容（`/chat/completions`）与 Anthropic 兼容（`/messages`）两套端点，Claude 系列走错端点会直接 400。插件按模型自动拆分：Claude 进 `commandcode-<档位>-anthropic`（`api: anthropic-messages`），其余进 `commandcode-<档位>-autosync`（`api: openai-completions`）。

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

## 安装

推荐直接从 GitHub 安装（`web` profile）：

```sh
pnpm dsh plugin --profile web add github:CJYLZS/dsh-commandcode-plan-autosync
```

安装后重启 DSH Web，进入 设置 → 模型供应商，找到「CommandCode 计划同步」卡片：选择订阅类型（默认 goat），点击 **一键创建/更新**。

## API Key 配置

插件默认读取环境变量 `COMMANDCODE_API_KEY`（可通过插件配置 `targetApiKeyEnv` 修改名字）。

在 DSH 中配置密钥的方式二选一：

1. **凭据管理**（推荐）：在 DSH 设置里为 `llm-pi-ai` 的 `apiKeyEnv`（`COMMANDCODE_API_KEY`）配置凭据值，密钥只进入 `.credentials.yaml`，不会写入 `settings.yaml`。
2. **环境变量**：启动 DSH 前 `export COMMANDCODE_API_KEY=cmd_xxx`。

Key 在 [commandcode.ai](https://commandcode.ai) Studio 的 API keys 页面创建（除 Go 计划外均可用；GOAT/Pro/Max 按套餐额度计费，Provider 计划按量付费）。

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

目标供应商名由 `plan` 推导（`commandcode-<plan>-autosync` / `commandcode-<plan>-anthropic`），不需要单独配置。

## FAQ

**切换档位会怎样？** 下拉框选择新档位并保存后，点「一键创建/更新」会创建该档位的供应商；旧档位的供应商保留不动（互不覆盖）。想清理旧供应商需手动删除。

**为什么 goat 档没有 `commandcode-goat-anthropic`？** GOAT 档只含开源模型，没有 Claude，因此不会生成 Anthropic 路由供应商。

**Claude 模型怎么用？** 官方 API 要求 Claude 走 `/messages`（Anthropic 格式）。`pro` / `max` 档自动创建 `commandcode-<plan>-anthropic` 供应商（`api: anthropic-messages`）；若在 OpenAI 路由供应商里调用 Claude id，会得到 400。

**为什么有些模型没有思考档位？** 官方目录只标注 `reasoning: true/false`，不提供档位枚举。`reasoning: false` 的模型写入 `reasoningEfforts: false` 防止 DSH 发送思考参数；`reasoning: true` 的模型由 `compat.supportsReasoningEffort` 统一放行。

**调用超出档位的模型会怎样？** 目录按 `minPlanName` 严格过滤，写入的模型都在所选档位内；上游列表若新增模型而目录尚未收录，插件会按纯列表写入全部（降级模式，结果中带 warning 提示）。