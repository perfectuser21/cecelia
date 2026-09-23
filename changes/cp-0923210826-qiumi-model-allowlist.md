## Brain {VERSION} — 秋米路由认「用 <型号>」：模型允许清单显式命中，claude 引擎改走 anthropic 原生通道

- 主理人 0923 拍板：厂商 × 型号两层，正文写「用 grok-4.7」「用 opus-5」「用 sol」直接命中；型号清单不手抄，`QIUMI_MODEL_ALLOWLIST`（JSON 数组）与 OpenClaw `agents.defaults.modelPolicy.allow` 同步（0923 已扩到 26 个并逐个实调）。
- 匹配规则 `resolveModelRef`：全名 > 短名全等 > 以 `-<token>` 结尾且唯一（`sol`→`openai/gpt-5.6-sol`，`opus-5`→`anthropic/claude-opus-5`，不误吞 `opus-5-5`）；多候选不猜；清单外不认。便宜闸新增 `hardModel`（matchedBy `text:model`），agent 分支 `model = hardModel ?? modelMap[engine]`，事件留痕。
- `DEFAULT_MODEL_MAP.claude` 由 `claude-cli/claude-sonnet-5` 改为 `anthropic/claude-sonnet-5`：OpenClaw 的 claude-cli 通道 0923 实测任何型号 180s 无输出（债 419ab185），另一会话 10:05 已把 sonnet-5 运行时切到原生 API 并验证通。
- 守卫：env.test.js（清单解析 / 六种解析情形 / claude 映射）、cheap-gates.test.js（全名/短名/引擎词不误判/清单外/多个取首）、qiumi-router.test.js（hardModel 覆盖 engine 映射、无型号走默认、用 claude 走原生），变异各验红。executor 不改（`payload.model` 已透传 `--model`）。
