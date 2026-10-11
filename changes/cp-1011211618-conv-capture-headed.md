## Brain {VERSION} — 修对话自动捕获（09-10 迁 us-vps 后静默归零）+ 有头会话收尾自动 handoff

- 根因：Brain 容器里没有 `~/.claude/projects`，适配器静默返回空，`conversation-capture` 每 10 分钟报 pushed=0/errors=0 全绿，`captures(source=conversation-claude)` 最后一条停在 2026-09-09；出处登记写本机已不存在的 `cecelia` 库，且主理人直接跑 `claude` 不经 launcher，`session_provenance` human 也停在 09-09
- 修法：容器内默认远端模式——`ssh mmv` 只读跑同一份三适配器源码（data: URL 动态 import，mmv 不落文件，openclaw-run-ingest 同款），回传尾部 turns；本地模式 claude 目录缺失、远端 ssh/解析失败一律计 `adapter_failures`，job 变红不再静默 0；未登记出处的会话以 transcript `entrypoint=cli`（交互 TTY）判为有头真人会话（无头 `claude -p` 为 `sdk-cli`，照旧跳过）
- 有头收尾（新模块 `headed-session-handoff.js`）：会话结束（闲置≥15min）且有摘要后，按 transcript 里真人/Skill 的 `--task-id`、Bash claim（≤3）或 `session_provenance.task_id` 认关联任务 → 摘要并入 handoff（已有真 handoff 只追加不覆盖，`headed_sessions` 按会话幂等；未终态任务加「有头续接」下一步，kind 走 `resume_headed` 适配点，接力棒未认该类型时按 note 写）；无关联 → 经 `createRoutedTask` 补建 completed 账本任务（`source=conversation`、`source_id=headed-session:<sid>`、只记账不派发）挂摘要；Notion 走任务既有投影通道
- 环境变量：`CECELIA_CONVERSATION_CAPTURE_MODE=local|remote`（默认容器 remote）、`CECELIA_CONVERSATION_CAPTURE_HOST`（默认 mmv）
- 回归测试：远端脚本真跑 fixture、目录缺失/ssh 失败必红、entrypoint 判定、关联任务分档、handoff 合并幂等、真库账本建单集成测试；任务 c8b27bc5，决策 c4fba481
