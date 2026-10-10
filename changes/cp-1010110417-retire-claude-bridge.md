## Brain {VERSION} — 彻底下线 Claude Code 无头调用通道

任务 76a160b3（决策 067867c8、3859041e）。主理人曾因 claude -p / 订阅 OAuth 被自动化调用而封号，Brain 侧所有拉起 claude CLI 的路径下线，单一来源 `lib/claude-channel.js`（`claude_channel_retired`）。

- Brain 不再自动拉起 cecelia-bridge；桥接的 `/llm-call`、`/trigger-cecelia` 一律 410 `claude_channel_retired`，notebook 端点不变；cecelia-run.sh 开头即退出。
- executor 的 US 桥接 / Docker claude 派发删除，执行时返回 `claude_channel_retired`；dispatcher 按 no_executor 收口（回 queued、放 claim，不计熔断 / dispatch 失败 / autoblock），同一 tick 换下一个候选继续派。派发前可用性检查传入任务时恒可用（不探活已不自启的桥接、不预测路由）；手动派发落到 claude 路径返回 409 `claude_channel_retired`。
- llm-caller 的 anthropic（经桥接）不发请求、直接走 fallbacks，不计入账号熔断；anthropic-api、codex、minimax、openai 不变。
- Commander 默认 runner、宿主 SSH 逃逸（host-executor）、skill-relay 的 claude 执行体（含 headed tmux）、容器缺省 claude 执行体、worker 池 tmux 发射、对话回路、skill 评估 worker 均拒绝 claude；orchestrator 不再注册 claude provider，auto 落 codex；分配引导员不再选 claude。
- 删除无运行进程的 AI Gateway（packages/workflows/gateway）及 deploy.sh 中对应段落。
- 保留新编码流水线 `scripts/coding-workflow/`（runClaude/spawnClaude 用机器默认 Claude 登录），防复活守卫对该目录白名单并有反向用例证明白名单生效。
- skill-relay 本机执行闸（`local_execution_disabled_on_scheduler`）先于 claude 退役检查，闸关时错误码不变；秋米总闸旁路的 `onlyTaskTypes` 改从注册表 `OPENCLAW_PASSTHROUGH_TASK_TYPES` 派生（行为不变）。
