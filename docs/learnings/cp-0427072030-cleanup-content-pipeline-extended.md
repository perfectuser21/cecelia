# Learning — cleanup-content-pipeline-extended

**分支**: `cp-0427072030-cleanup-content-pipeline-extended`
**Brain Task**: `1a8a7363-e6f4-476d-8b16-0f4a5acb4d94`
**日期**: 2026-04-27

## 背景

Cecelia Brain 内部曾有两套 content-pipeline 编排：
1. **老路径**：`content-pipeline-orchestrator.js` (35KB) + `content-pipeline-executors.js` (40KB)，
   被 `tick.js` 周期调用 + routes endpoints (`/run`、`/e2e-trigger`、`/batch-e2e-trigger`) 同步调用
2. **新路径**：`workflows/content-pipeline.graph.js` (27KB) LangGraph 实现 + shim 文件
   (`content-pipeline-graph.js` / `content-pipeline-graph-runner.js`)，被 `/run-langgraph` endpoint 调用

实际生产路径（2 个并行调研 agent 已验证）：
- ZJ Dashboard → POST /api/pipeline/trigger (ZJ apps/api:5200) → INSERT zenithjoy.pipeline_runs
- ZJ pipeline-worker (Python launchd, 60s 轮询) 用 LangGraph 编排 6 阶段 (PR zenithjoy#216 已合并 + 已部署)
- Cecelia 端真活的只有：POST /api/brain/tasks（创任务）+ POST /api/brain/can-run（调度许可）+ POST /api/brain/llm-service/generate（LLM 服务）

in-Brain orchestrator 早就从 `tick.js` 注释掉了（PR #2640 阶段 3），但 routes endpoint 仍调用，5 个文件 + 14 个测试还活着。

### 根本原因

下线一个子系统时只删入口（tick.js）、没删整链路（routes endpoint / 实现文件 / 测试文件），导致：
- 27KB + 35KB + 40KB = 100+KB 死代码堆积
- 14 个测试（其中 3 个 mock 不全，被强行 skip）继续浪费 CI 时间
- LangGraph workflow 用 `MemorySaver` 不落 PgCheckpointer，1153 个 step events 是手动测试遗留
- 新人读代码时看到双路径会误以为两套都在用，浪费认知

### 下次预防

- [ ] **下线子系统三步走**：① 删入口（tick / cron / scheduler）→ ② 删 endpoint / API 调用面 → ③ 删实现 + 测试，三步必须在同一个 PR 完成。不能"先废入口，等以后再删实现"。
- [ ] **删 src 文件时必须 grep 调用方**：搜 `import.*<filename>` + `from.*<filename>` + `require.*<filename>` 三种 pattern；CI lint 应自动跑这一条。
- [ ] **shim 文件（re-export only）有自然过期日**：写 shim 时必须在文件 header 写 sunset date 或 successor PR，过期 PR 必须删 shim。
- [ ] **下线时同步看测试**：删 src 文件 → grep `__tests__` 找配套测试文件 → 一并删。skip 列表里的 test 是技术债指示器，定期清理。
- [ ] **跨仓库迁移做完要在两边写个 README/comment 互链**：ZJ pipeline-worker 接管 content-pipeline 时，Cecelia 这边的 routes/tick/orchestrator 文件应该 header 注释指向 ZJ，避免下个人重新实现。

## 本 PR 范围

删 6 个文件（5 实现 + 1 shim 一对）、16 个测试文件、1 个废 smoke.sh，改 4 个文件
（routes/content-pipeline.js / routes/execution.js / executor.js / tick-runner.js），
更新 2 个测试 mock（golden-path.integration / content-pipeline-trigger-topics），
版本 bump 1.225.0 → 1.226.0（4 个文件同步），新增 cleanup-content-pipeline-smoke.sh。
