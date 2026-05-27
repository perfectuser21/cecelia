# Harness Pipeline 5 Bug Fix — Design Spec

Date: 2026-05-27  
Branch: cp-0527160626-harness-pipeline-5bug-fix

---

## Summary

5 independently scoped fixes to the harness pipeline. All bugs confirmed via code inspection. Each fix is surgical — no architectural changes.

---

## B1: Liveness误标 Failure（容器退出但 PR 已合并）

### Root Cause
`_waitForSubGraphCompletion`（`harness-initiative.graph.js:1176`）检测到容器死亡时，直接 invoke `resume:{status:'failed'}` 而不检查 PR 是否已 merged。若容器在 `merge_pr` 完成后退出，pipeline 会把已完成的 WS 标为 failed，LangGraph routing channel 写 null，pipeline 卡死。

### Fix
在容器死亡检测块中，先检查 PR 状态：
1. 新增 `_checkPrMerged(prUrl)` 函数：用 `execFileCb('gh', ['pr', 'view', prUrl, '--json', 'state', '-q', '.state'])` 查 PR 状态
2. 若返回 `MERGED` → 返回 `{...state.values, status:'merged'}`（不走 failure 路径）
3. 若返回非 MERGED 或查询失败 → 保持原有 failure 路径

### Regression Test
新增 case in `harness-container-liveness.test.js`：
- Mock：`gh pr view` 返回 `MERGED`，container exited
- 断言：`compiled.invoke` **不被调用**（或以 `resume:{status:'merged'}` 调用），返回 `{status:'merged'}`

---

## B2: 僵尸容器不清理

### Root Cause
1. `zombie-reaper.js` 豁免了所有 `harness_*` 类型（设计合理，防误杀长跑任务）
2. Initiative 变 failed/completed 时无任何 `docker rm -f` 调用
3. 容器没有 `harness_initiative_id` label，无法按 label 过滤

### Fix
新建 `packages/brain/src/harness-container-cleanup.js`：
- `killInitiativeContainers(initiativeId)` 函数：
  1. `docker ps -q` 获取所有运行中容器 ID
  2. 逐个 `docker inspect --format '{{range .Config.Env}}{{.}}\n{{end}}'`
  3. 过滤出含 `HARNESS_INITIATIVE_ID=<id>` 的容器
  4. 批量 `docker rm -f`
  5. 失败单个不阻断，记 warn log

在 `harness-initiative.graph.js` 的 failed/completed 转换点调用：
- `runInitiative` early failure return 后
- `runPhaseCIfReady` 的 phase='failed' 写入后
- phase='done' 写入后

### Regression Test
新建 `packages/brain/src/__tests__/harness-container-cleanup.test.js`：
- Mock `execFile`：第一次（docker ps）返回容器 ID 列表，第二次（docker inspect）返回含目标 initiative_id 的 env 列表
- 断言：`docker rm -f <matching_id>` 被调用

---

## B3: Planner 写 task-plan.json 时 initiative_id = "pending"

### Root Cause
`harness-initiative.graph.js` 的 Planner prompt（~line 125）向 Planner 容器说明 `initiative_id`，但 SKILL.md v8 不要求 Planner 输出 task-plan.json。当 GAN proposer 输出 task-plan.json 时，写了 `"pending"` 作为 initiative_id 占位。虽然 graph 有覆盖逻辑（line 189-191, 687-688），但 `parsePrdNode` 在覆盖前跑 `parseTaskPlan`，抛出 warning 噪音，且 "pending" 进 DB 有概率引发下游校验问题。

### Fix
更新 Planner prompt（`harness-initiative.graph.js:113-131`），明确：
```
initiative_id 必须填写 $HARNESS_INITIATIVE_ID 环境变量的值，禁止填写 "pending" 或其他占位符。
```

同时在 `packages/workflows/skills/harness-planner/SKILL.md` 中补充：在 task-plan.json 的 schema 说明里注明 `initiative_id` 必须为 `$HARNESS_INITIATIVE_ID`。

### Regression Test
不新增独立测试（已有覆盖逻辑的测试），在 `harness-planner-push-noise.test.js` 或现有文件中补充断言：Planner 输出中不含 `initiative_id: "pending"` 的静默路径。

---

## B4: NightlyOrchestrator daily_logs.type VARCHAR(20) 溢出

### Root Cause
`daily_logs.type` 是 `VARCHAR(20)`，CHECK 约束只含 `('repo', 'summary')`。`nightly-orchestrator.js` 和 `nightly-tick.js` 写 `'nightly_orchestration'`（21 字符），两个错误叠加（长度 + 约束不在列表内）。

### Fix
新建迁移 `packages/brain/migrations/286_daily_logs_type_expand.sql`：
```sql
-- Migration 286: Expand daily_logs.type to VARCHAR(50) + add nightly types
ALTER TABLE daily_logs ALTER COLUMN type TYPE VARCHAR(50);
ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_type_check;
ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_type_check
  CHECK (type IN ('repo', 'summary', 'nightly_orchestration', 'consolidation', 'nightly_tick'));
```

### Regression Test
新增 `packages/brain/src/__tests__/nightly-orchestrator-daily-log.test.js`：
- Mock pool.query，验证 INSERT 语句含 `type='nightly_orchestration'`（21 字符）
- 验证不抛出 "value too long" 错误

---

## B5: LangSmith 429（月度 quota 耗尽）

### Root Cause
`packages/brain/.env` 中 `LANGSMITH_TRACING=true` + 有效 API key，LangGraph 在每次 invocation 时向 LangSmith 发送 trace，月度 unique traces quota 耗尽，每次 tick 记录 429 错误。

### Fix
`packages/brain/.env` 中将 `LANGSMITH_TRACING=true` 改为 `LANGSMITH_TRACING=false`。保留 API key 配置不删（方便以后重新开启）。

### Regression Test
不加独立测试（env 变量修改，无逻辑可测）。验证方式：Brain reload 后 5 次 tick 日志中不再出现 `429` / `traces usage limit`。

---

## Files Changed

| 文件 | 操作 | Bug |
|------|------|-----|
| `packages/brain/src/workflows/harness-initiative.graph.js` | 修改 | B1 + B2 |
| `packages/brain/src/harness-container-cleanup.js` | 新建 | B2 |
| `packages/brain/src/__tests__/harness-container-liveness.test.js` | 修改（新增 case） | B1 |
| `packages/brain/src/__tests__/harness-container-cleanup.test.js` | 新建 | B2 |
| `packages/workflows/skills/harness-planner/SKILL.md` | 修改 | B3 |
| `packages/brain/migrations/286_daily_logs_type_expand.sql` | 新建 | B4 |
| `packages/brain/src/__tests__/nightly-orchestrator-daily-log.test.js` | 新建 | B4 |
| `packages/brain/.env` | 修改 | B5 |

---

## Test Strategy

- B1, B2, B4: **unit tests** with mocked execFile/pool.query — fast, deterministic, permanent in CI
- B3: config change — verified via existing graph test coverage
- B5: env change — verified via Brain log monitoring

---

## Constraints

- B1: `gh pr view` 失败时必须 fall back 到 failure 路径（不能因 gh 不可用导致 zombie WS）
- B2: 单个容器 `docker rm -f` 失败不阻断其他容器清理
- B4: 迁移必须幂等（`IF NOT EXISTS` / `IF EXISTS`）
- B5: `.env` 中保留 API key 注释，方便以后重新开启
