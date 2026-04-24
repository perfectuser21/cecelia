# Phase C1 — graph-runtime 骨架 Learning

## 做了什么
Brain v2 L2 Orchestrator 第一块砖 + SSOT checkpoint schema（单 PR 合并 C0+C1）：
- `migrations/244_langgraph_checkpoints.sql` 新建 checkpoints / checkpoint_blobs / checkpoint_writes 三表（之前靠 executor.js 散建 PostgresSaver.setup() 非 SSOT）
- `brain-manifest.js` EXPECTED_SCHEMA_VERSION 243→244
- `packages/brain/src/orchestrator/` 4 文件：graph-runtime.js（runWorkflow 入口 + thread_id 格式强制 `{taskId}:{attemptN}`）+ pg-checkpointer.js（PostgresSaver 单例）+ workflow-registry.js（注册表 Map）+ README.md
- 8 单测全 pass（格式 / 非法参数 / 未注册 / has-checkpoint 分流 / retry 递增）

## 根本原因
Brain v2 spec §6 要求 L2 统一 workflow 运行时，但当前 harness-gan-graph / harness-initiative-runner / content-pipeline-graph 三个 runner 各自初始化 PostgresSaver、各自用裸 UUID 作 thread_id、没有 attempt_n 概念 → retry 污染 checkpoint、Brain 重启 resume 路径不稳。本 PR 建基础设施，后续 Phase C2-C5 逐个迁 runner 到 workflows/*.graph.js。

## 下次预防
- [ ] LangGraph schema 必走 migration（migrations/244）而非依赖 PostgresSaver.setup()，避免跨环境表漂移
- [ ] 新 L2 API（runWorkflow）未接线前 CI 加 grep assertion，防意外早接
- [ ] 单测 mock LangGraph 用最小 stub（fromConnString + get 两个方法），不真连 pg（pg 测试留 integration 测试做）

## 关键决策
**合并 C0 + C1 单 PR**：原 Plan 建议分，但 C1 pg-checkpointer 测试需要 checkpoints 表存在，分开会阻塞。300 行单 PR 仍可控。

**不加 tasks.attempt_n 列**（YAGNI）：runWorkflow(attemptN) 参数让 caller 决定从哪取（现有 tasks.retry_count 可复用）。Phase D task-router 接线时再看是否加列。

**不接线 tick.js / executor.js**：本 PR 只建 API，CI grep 守门确认 tick.js 零 runWorkflow 调用。C2 加 WORKFLOW_RUNTIME env flag 首次灰度。
