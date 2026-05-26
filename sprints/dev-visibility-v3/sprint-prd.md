# Sprint PRD — 开发链路可见性 v3：全程产物持久化 + Generator 信息完整性

## OKR 对齐

- **对应 KR**：KR（Cecelia 开发链路全链路可见性）
- **当前进度**：Brain API 不可达，无法获取实时进度
- **本次推进预期**：4 个 WS 各修复一项可见性/信息完整性断层

## 背景

开发链路存在 4 个信息断层：
①notion 未同步 decisions/initiative_contracts；
②dev SKILL Route B 不注册 Brain 任务；
③generator 收不到 sprint-prd.md 内容；
④generator SKILL Step 0.5 注释误导"并行派发"（实为串行）。

## Golden Path（核心场景）

harness initiative 全链路执行：

1. **WS1** — Brain tick 调 `runNotionPushSync()` → 新增 `pushDecisions()` + `pushInitiativeContracts()` 把两张表的未同步行推到 Notion，更新 `notion_synced_at`
2. **WS2** — 用户运行 `/dev`（无 `--task-id`）并确认 PrepPRD → dev SKILL **Route B** 调 `POST localhost:5221/api/brain/tasks`（`task_type=dev`）注册任务；Route A（有 `--task-id`，任务已存在）保持不变
3. **WS3** — Brain 派 generator 时 → `buildGeneratorPrompt(task, opts)` 从 `opts.prdContent` 取 PRD 内容，拼入 `## Sprint PRD` 段；`runSubTaskNode` 把 `state.prdContent` 传入 `opts`
4. **WS4** — generator SKILL `SKILL.md` Step 0.5 注释由"并行派发"改为"串行派发（每个 ws merge gate 通过后 Brain 才启动下一个）"；确认文件名统一为 `sprint-contract.md`，移除 `contract-draft.md` 旧引用

## Response Schema

N/A — 本次无新 HTTP 端点，全为内部函数与 SKILL 文档变更

## 边界情况

- `decisions` / `initiative_contracts` 表若无 `notion_synced_at` 列 → migration 先加列（NULL 默认值），再执行同步
- `pushDecisions` / `pushInitiativeContracts` 找不到 Notion 映射时静默跳过（与现有 `pushIssues` 行为一致）
- Route B POST Brain 失败（Brain 离线）→ 打 `warn` 日志，不阻断 `/dev` 流程继续
- `prdContent` 为 null/空时 `buildGeneratorPrompt` 跳过 `sprint_prd` 段，不注入空段

## 范围限定

**在范围内**：
- `packages/brain/src/notion-push-sync.js` 加 `pushDecisions` + `pushInitiativeContracts`
- DB migration：`decisions` 和 `initiative_contracts` 表加 `notion_synced_at timestamptz`
- `packages/workflows/skills/dev/SKILL.md` Route B 加 POST Brain 步骤
- `packages/brain/src/harness-utils.js buildGeneratorPrompt` 加 `sprint_prd` 段
- `packages/brain/src/workflows/harness-initiative.graph.js runSubTaskNode` 传 `prdContent`
- `packages/workflows/skills/harness-generator/SKILL.md` Step 0.5 注释串行化

**不在范围内**：
- 改 Notion 数据库 schema（只扩展同步范围）
- 改 dev SKILL Route A 流程（--task-id 路径已有 Brain task）
- proposer / evaluator / harness-planner 改动

## 假设

- [ASSUMPTION: `decisions` 表字段含 `id`、`title`、`body`，结构与 `issues` 类似]
- [ASSUMPTION: `initiative_contracts` 表字段含 `id`、`title`，有稳定主键]
- [ASSUMPTION: dev SKILL PrepPRD 确认点在 Stage 1 Spec 阶段完成后]
- [ASSUMPTION: `buildGeneratorPrompt` 接收 opts 对象，可新增 `prdContent` 字段而不破坏现有调用方]

## 预期受影响文件

- `packages/brain/src/notion-push-sync.js` — WS1：新增两个同步函数 + runNotionPushSync 调用
- `packages/brain/migrations/` — WS1：migration 加 notion_synced_at 列
- `packages/workflows/skills/dev/SKILL.md` — WS2：Route A/B 描述 + Route B POST Brain 步骤
- `packages/brain/src/harness-utils.js` — WS3：buildGeneratorPrompt 加 sprint_prd 段
- `packages/brain/src/workflows/harness-initiative.graph.js` — WS3：runSubTaskNode 传 prdContent
- `packages/workflows/skills/harness-generator/SKILL.md` — WS4：Step 0.5 注释串行 + 文件名统一

## journey_type: autonomous
## journey_type_reason: 同时涉及 packages/brain/（autonomous）和 packages/engine/skills/（dev_pipeline），取栈上最前者 autonomous
## target_environment: local_api
## target_environment_reason: 全为 Brain 内部函数 + SKILL 文档改动，E2E 通过 curl localhost:5221 + 本地 notion-push-sync 脚本验证
