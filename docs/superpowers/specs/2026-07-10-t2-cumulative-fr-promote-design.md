# 九要素 T2：累积 FR 通电 — promoteToRegression 接入终态收口 + line-context 读端对齐 golden_path.feature_id

日期：2026-07-10
任务：3127bbbf-af48-4cc3-95dc-bf4f52220e8b（nine-elements-integrity plan_seq=2）
上游架构：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md
上游决策：88f675e5（T2 落点）；铁律：新增后处理逻辑必须进 lib/callback-postprocess.js 共享管道，禁内联 callback-processor.js（防第四次分叉）

## 目标

golden_path 表 07-06 建齐后一直 0 行（累积 FR 断线）。本任务把写入方接到 harness 任务
merged 终态收口（fail-open），并把读端 SQL 从 tasks.ability_id 绕行改为 golden_path.feature_id
直连，使"已验收行为"真正开始沉淀并被 proposer/generator/evaluator 注入消费。

## 对架构文档的一处修正（调研实证）

架构文档假设 callback-processor 是 harness 终态唯一收口。调研实证（relay 模式）：
- relay 容器只 POST `/api/brain/harness/callback/:containerId`，被 200 ack 后不进 callback 管道；
- 实际 completed 路径是 ① harness-report Step 1 `PATCH /api/brain/tasks/:id`（routes/tasks.js:347，
  且 result/pr_url 被丢弃）② harness-relay-watchdog 两处直写 `UPDATE tasks SET status='completed'`
  （harness-relay-watchdog.js:154-166 / :193-206，PR discovery 分支会写 tasks.pr_url）。

因此只接 callback 两路径对 relay 覆盖率≈0（死代码）。修正：共享函数仍进 callback-postprocess.js，
但接线点扩为 4 处（下表），逻辑单点、多路触发，幂等安全（promoteToRegression ① 为
DELETE by owner_task_id + INSERT 覆盖写）。

## 变更清单

| 文件 | 变更 |
|---|---|
| `packages/brain/src/lib/callback-postprocess.js` | 新增 `promoteRegressionOnHarnessMerged(task_id, result, pr_url, pool)` |
| `packages/brain/src/harness-promote-regression.js` | ① `params.dbOnly=false` 参数：DB 事务成功后直接返回 `{ok, dbWritten, yamlPrUrl:null, reason:'db_only'}`，跳过 commit 校验与 yaml PR；② feature_id 兜底：`payload.feature_id` 缺失/无效时回退 `task.ability_id`（同样过 journey_features 存在性验证）；③ sprint 文件读取兜底：worktree 缺文件时回退 `DEFAULT_BASE_REPO` 主仓路径 |
| `packages/brain/src/callback-processor.js` | completed 分支 serialUnlockNext 之后加一行调用（catch 只 warn） |
| `packages/brain/src/routes/execution.js` | 同上（:1476 后，:893 的 completed 块内） |
| `packages/brain/src/routes/tasks.js` | PATCH handler status→completed 且 task_type='harness_initiative' 时调用（fail-open） |
| `packages/brain/src/harness-relay-watchdog.js` | 两处 `UPDATE ... completed` 后调用（fail-open） |
| `packages/brain/src/harness-line-context.js` | 累积 FR SQL：去掉 `JOIN tasks`，改 `JOIN journey_features jf ON gp.feature_id = jf.id`；status 过滤保持 `IN ('done','working')` 不动（'working' 为既有死值债，不在本任务扩权） |
| `packages/brain/src/routes/abilities.js` | `GET /journeys/:id/golden-paths` 同源 SQL 同步改（避免同源分叉） |
| `packages/brain/scripts/smoke/callback-postprocess-smoke.sh` | 棘轮加一条：grep 新函数 export + 两 callback 路径引用 |
| `packages/brain/scripts/smoke/journey-goldenpaths-invariants-smoke.sh` | 夹具补写 gp.feature_id（新旧 join 双兼容） |

## promoteRegressionOnHarnessMerged 行为

1. 查 tasks 行：`task_type !== 'harness_initiative'` → return（静默）。
2. merged 证据：`pr_url 参数 || tasks.pr_url || result?.pr_url || result?.merged` 任一即视为 merged；
   全无 → warn + return（fail-open，不 throw）。
3. `sprintDir = payload.sprint_dir`；缺 → warn + return。
4. `worktreePath = harnessTaskWorktreePath(task_id)`；若 `<worktreePath>/<sprintDir>/sprint-prd.md`
   不存在（worktree 已被收割）→ 回退 `DEFAULT_BASE_REPO`（merge 后 sprint 文件已在 main，主仓常驻 main；
   仍缺则 promoteToRegression 内部走 nothing_to_freeze skip + 告警，不炸）。
5. 调 `promoteToRegression({pool}, {task, sprintDir, subTasks:[{pr_url}], worktreePath, dbOnly:true})`。
6. 全函数任何异常由调用方 `.catch` 只 warn（与 serialUnlockNext 同风格）。

yaml PR（②）本版不通电，维持现状由 CI 侧消化（架构文档风险条：避免一次接通两个副作用）。

## 测试策略

- **单测（mock）**：
  - `harness-promote-regression.test.js`：dbOnly 用例（断言无 execFile 调用、reason='db_only'）；
    feature_id 兜底用例（payload 无 feature_id、task.ability_id 有效 → INSERT 参数带该 id）。
  - 新 `__tests__/callback-postprocess-promote.test.js`：非 harness 类型跳过 / 无 merged 证据跳过 /
    有证据时以 dbOnly:true 调用 / 异常不外抛。
  - `harness-line-context.test.js`：SQL 断言从旧 join 改为 `ON gp.feature_id = jf.id`（:110-111）。
- **集成（brain-integration，真 postgres）**：新 `__tests__/integration/promote-regression.integration.test.js`：
  种 harness_initiative 任务 + journey_features 行 + tmp worktree 夹具（sprint-prd.md/contract-dod.md）→
  调 promoteRegressionOnHarnessMerged → 断言 golden_path 新增行且 feature_id 非空 →
  再调 fetchLineContext 断言新 SQL 能读回。
- **smoke（棘轮）**：callback-postprocess-smoke.sh 新增断言 proven-to-fire（先故意去掉 export 看它红）。

## 守卫（哨兵）

- 逻辑接缝：上述 CI 单测 + 集成测试（regression，永久留 CI）。
- 分叉接缝：callback-postprocess-smoke.sh 棘轮扩条（机器闸，防第四次分叉复发）。

## 不包含

- yaml PR（②）通电；'working' 状态枚举债修正；PROMPT_MAX_LEN/MAX_FR_ABILITIES 扩容（T3）；
  reaper 收割时序根治（在案另一战役）。
