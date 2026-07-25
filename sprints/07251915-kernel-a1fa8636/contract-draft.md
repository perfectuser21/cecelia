# Sprint Contract Draft (Round 3)

contract-gate: active
覆盖父路 Kernel telemetry 账本 第 1-5 步

## Notes

- context-manifest: unavailable
- registry freshness: api/db/test registry 最新扫描于 2026-07-18，已过期 166.2h；命名风格仅作参考，PRD 仍为法律。
- judgment-pending-user: ⚠️orphan attempt 在 lease 过期后优先 resume 还是优先结构化终结
- red-evidence: sprint 契约测试需从仓库根 `npx vitest run sprints/...` 执行；`packages/brain/vitest.config.js` 已明确不再 include `sprints/**`

## Response Schema（推导来源: [api_registry推导/PRD字面]）

### Endpoint: `GET /api/brain/harness/tasks/:task_id/attempt-telemetry`
**Success (HTTP 200)**:
```json
{
  "task_id": "uuid",
  "run_count": 4,
  "logical_cycle_count": 2,
  "totals": {
    "active_time_ms": 1200,
    "wall_time_ms": 1800,
    "wait_time_ms": 600,
    "retry_count": 1,
    "recovery_count": 1,
    "invalid_count": 1
  },
  "role_metrics": [
    {
      "role": "generator",
      "workstream_key": "ws1",
      "active_time_ms": 900,
      "wall_time_ms": 1200,
      "wait_time_ms": 300,
      "retry_count": 1,
      "recovery_count": 0,
      "invalid_count": 0
    }
  ],
  "attempts": [
    {
      "attempt_id": "uuid",
      "run_id": "uuid",
      "hop": 9,
      "role": "generator",
      "status": "completed",
      "logical_cycle_id": "cycle-2",
      "attempt_kind": "retry",
      "retry_of_attempt_id": "uuid-or-null",
      "restart_reason": "ci_failed-or-null",
      "workstream_key": "ws1",
      "started_at": "2026-07-25T00:00:00.000Z",
      "completed_at": "2026-07-25T00:05:00.000Z",
      "derived": false
    }
  ]
}
```
- `task_id` (string, 必填): 来源——api_registry 既有 `GET /runs/:id` / `GET /initiative-runs/:id` 的 UUID 风格 + PRD 任务聚合语义
- `run_count` (number, 必填): 来源——PRD 第 4 步“按 task 聚合多个 run”
- `logical_cycle_count` (number, 必填): 来源——PRD 第 4-5 步“恢复 logical cycle 视角”
- `totals` (object, 必填): 来源——PRD 第 4 步的 `active_time_ms` / `wall_time_ms` / `wait_time_ms` / `retry_count` / `recovery_count` / `invalid_count`
- `role_metrics` (array, 必填): 来源——PRD 第 4 步“按 role 与 workstream 拆分”
- `attempts` (array, 必填): 来源——PRD 第 1-3 步“attempt lineage + orphan 收口”
- `attempts[].logical_cycle_id` (string, 必填): 来源——PRD 第 1 步
- `attempts[].status` (string, 必填): 来源——PRD 第 2-3 步，区分 `starting|running|completed|failed|blocked|needs_context|cancelled`
- `attempts[].attempt_kind` (string, 必填): 来源——PRD 第 1 步；允许值 `initial|fix|retry|resume|recovery`
- `attempts[].retry_of_attempt_id` (string|null, 必填): 来源——PRD 第 1 步
- `attempts[].restart_reason` (string|null, 必填): 来源——PRD 第 1 步
- `attempts[].workstream_key` (string, 必填): 来源——PRD 第 1 步
- `attempts[].started_at` / `attempts[].completed_at` (string|null, 必填): 来源——PRD 第 2 步
- `attempts[].derived` (boolean, 必填): 来源——PRD 第 2 步“无法原生记录者必须明确 derived 标志”
**禁用字段名**: `attempt_count`, `cycle_id`, `kind`, `time_ms`, `run_total`
**Error (HTTP 4xx)**:
```json
{"error":"<string>"}
```

## 已知约束（来自回归测试）

- [packages/brain/src/__tests__/migration-357-harness-attempts.test.js] → `stores provider-neutral attempt state`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] → `按 run/hop 幂等创建 attempt，并持久化冻结 Skill 元数据`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] → `starting/running/heartbeat 都使用 lease owner fencing`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] → `watchdog 只能 reclaim 已过期的同一个非终态 attempt`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] → `reclaim 后按 lease fencing 原子轮换 callback secret hash`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] → `终态写入只接受一次，重复 callback 返回 deduped`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] → `resume 只允许同一个 attempt；同角色的新 attempt 也不能偷用旧 session`
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] → `persisted BLOCKED/NEEDS_CONTEXT streak`、`same SHA no-progress`、`failure-set recurrence requests human review`
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 为每个 harness attempt 增加 lineage/时间/分类字段；收口 lease 过期 orphan；提供按 task 聚合多 run 的 telemetry 查询 API。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | additive migration；真实 PostgreSQL Red→Green；查询接口本地集成测试内完成；不新增高频扫描器。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不改变 Kernel 路由决策与合同冻结语义；租户隔离；lease fencing；同一旧 attempt 不得重复终结。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | attempt telemetry 为事实账本，不主动过期；derived 时间仅在原始起止缺失时有效，待未来原生事件补齐后可回填替换。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | PG 集成测试与 watchdog/orchestrator 回归在 CI 内发现；若 orphan 长期 running，watchdog/recovery 测试和 telemetry 查询应暴露 `completed_at` 缺失。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | migration/attempt-store 失败时 fail-closed；query API 参数错误返回 4xx；resume/recovery 仅基于结构化证据，无法安全 resume 时结构化终结。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | API 返回 telemetry JSON；PG 中 attempt 字段与 completed_at/derived 标志可查询；4-run fixture 还原结果必须命中 4/2/5/9/5 计数映射。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️orphan attempt 是否应归类为 `resume` 还是 `recovery` | A. 仅看 lease 过期; B. 看 lease 过期 + provider_session_id + reclaim 来源 | B. 看 lease 过期 + provider_session_id + reclaim 来源 | PRD要求结构化证据，不得从自然语言猜 | 误记 lineage，导致损耗账本失真 |
| ⚠️judge/reporter 时间是否可视为原生时间 | A. 一律写 NOW(); B. 原生事件优先，缺失时返回 `derived=true` | B. 原生事件优先，缺失时 derived | PRD 明确禁止伪造原始时间戳 | UI 把系统损耗误判为有效工作时间 |
| 4-run fixture 中 invalid evaluation 如何归类 | A. 看 reviewer/judge 文本; B. 看结构化 verdict / failure_class / failure_signature | B. 结构化 verdict / failure_class / failure_signature | PRD 明确“只使用结构化证据” | 错把无效评估当 retry，污染 logical cycle |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| additive migration 失败 | 中止迁移，保持旧 schema 不变 | 是 | 不执行生产写入，仅在测试库 Red→Green |
| orphan reclaim 发现 lease 已被新 owner 接管 | 不重复终结旧 attempt，返回 no-op | 是 | 保留旧 attempt，交给新 owner/后续 reconcile |
| telemetry API 参数缺失或 task 不存在 | 返回 400/404 + `error` | 是 | 不返回猜测值 |
| judge/reporter 无原生起止事件 | 返回 `derived=true` 的时间字段 | N/A | 不伪造原始时间戳 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 为 Brain 内部 attempt/telemetry 热修复，不新增对外可写 agent 输入面。

## 真实调用方请求 shape

### Query caller: `GET /api/brain/harness/tasks/:task_id/attempt-telemetry`
- 认证方式: 复用现有 Brain harness 只读路由风格，本合同不新增 body 认证字段
- 路径参数: `task_id`（UUID）
- Query 参数: `include_attempts=true|false`（可选，默认 `true`）
- Content-Type: 无请求体
- 响应: `application/json`
- 契约要求: 不允许把 `task_id` 换到 body；不允许把 `logical_cycle_id` 缩写为 `cycle_id`

## 接缝清单

- `attempt-store.js` ↔ `harness_attempts` 真 PostgreSQL：新增 lineage/时间字段必须在真实 PG 中可写可读，验证方式为 migration + psql 查询。
- `harness-relay-watchdog.js`/resume 路径 ↔ `harness_attempts` lease 字段：lease 过期 orphan 只能被一次 reclaim/resume 或结构化终结，验证方式为 PG 集成测试。
- `routes/harness*.js` ↔ 聚合查询结果：UI/API 读取的 task 聚合 telemetry 必须基于真实 `initiative_runs + harness_attempts + decision_log` 还原，验证方式为 HTTP + jq + fixture。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/attempt-store.js` ↔ `public.harness_attempts`（本单改写 attempt 写路径与终态时间账本，测试必须真 PostgreSQL）
- `packages/brain/src/harness-relay-watchdog.js` ↔ `packages/brain/src/orchestrator/attempt-store.js`（本单改 orphan reclaim/resume 接缝，测试必须真调相邻模块）
- `packages/brain/src/routes/harness*.js` ↔ `initiative_runs/harness_attempts/orchestrator_decision_log`（本单新增聚合查询 API，测试必须真查 PG）
- `packages/brain/src/orchestrator/kernel-handlers.js` ↔ dispatcher metadata（本单只允许最小接线，但分类字段透传不可被 mock 吞掉）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

[入口：Kernel 新建/恢复 Harness attempt] → [写入 lineage 与统一时间字段] → [lease 过期 orphan 被 resume 或结构化终结] → [task 聚合 API 还原 logical cycle 与系统损耗] → [4-run fixture 校验 4/2/5/9/5 原始计数映射且不改变既有决策]

### Step 1: 为每个新建 attempt 写入 lineage 与 workstream 元数据
**来源**: `[FROM_PRD]` — PRD 核心场景第 1 步与第 18 行。

**可观测行为**: 新建的 attempt 可查询到 `logical_cycle_id`、`attempt_kind`、`retry_of_attempt_id`、`restart_reason`、`workstream_key`，且 schema 仅 additive。

**验证命令**:
```bash
psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "
SELECT column_name
FROM information_schema.columns
WHERE table_name='harness_attempts'
  AND column_name IN (
    'logical_cycle_id',
    'attempt_kind',
    'retry_of_attempt_id',
    'restart_reason',
    'workstream_key'
  )
ORDER BY column_name;
" | tr '\n' ',' | grep -q 'attempt_kind,logical_cycle_id,restart_reason,retry_of_attempt_id,workstream_key,' || exit 1
```

**硬阈值**: 五个新增字段全部存在；不删除或改名既有字段。

---

### Step 2: planner/generator/reviewer/evaluator/judge/reporter 都有统一起止时间或 derived 标志
**来源**: `[FROM_PRD]` — PRD 核心场景第 2 步与第 19、31 行。

**可观测行为**: role 级 attempt 在 `starting`、`running`、终态时都能读到统一时间字段；无法原生记录者显式 `derived=true`。

**验证命令**:
```bash
RESP=$(curl -sf "http://localhost:5221/api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true")
echo "$RESP" | jq -e '
  .attempts
  | length >= 1
  and all(.[]; has("started_at") and has("completed_at") and has("derived"))
' >/dev/null
```

**硬阈值**: 所有返回的 attempt 都含 `started_at`、`completed_at`、`derived` 三字段；judge/reporter 无原生时间时必须 `derived=true`。

---

### Step 3: lease 过期 orphan 会被 resume/recovery 链路认领或结构化终结
**来源**: `[FROM_PRD]` — PRD 核心场景第 3 步与第 20、29、61 行。

**可观测行为**: `starting` / `running` 的过期 orphan 不会永久悬挂；要么出现新的 `resume|recovery` attempt，要么旧 attempt 进入结构化终态。

**验证命令**:
```bash
DEADLINE=$((SECONDS + 60))
until psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "
SELECT COUNT(*)
FROM harness_attempts
WHERE run_id='${TEST_RUN_ID}'
  AND created_at > NOW() - interval '5 minutes'
  AND (
    attempt_kind IN ('resume','recovery')
    OR (
      id='${ORPHAN_ATTEMPT_ID}'
      AND status IN ('failed','cancelled','blocked','needs_context')
      AND completed_at IS NOT NULL
    )
  );
" | grep -q '^[1-9]'; do
  [ $SECONDS -lt $DEADLINE ] || { echo 'FAIL: within 60s orphan 未收口'; exit 1; }
  sleep 2
done
echo "OK: within 60s orphan 收口"
```

**硬阈值**: 60s 内 orphan 完成 resume/recovery 或结构化终结；旧 attempt 不得永久 `running`。

---

### Step 4: task 聚合 API 返回 role/workstream 时间账本与损耗计数
**来源**: `[FROM_PRD]` — PRD 核心场景第 4 步与第 21、30 行。

**可观测行为**: 查询 API 能按 task 聚合多 run，返回 `active_time_ms`、`wall_time_ms`、`wait_time_ms`、`retry_count`、`recovery_count`、`invalid_count`，并保留 role/workstream 视角与 attempt 级 lineage 明细。

**验证命令**:
```bash
RESP=$(curl -sf "http://localhost:5221/api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true")
echo "$RESP" | jq -e '
  .task_id == "'"${TEST_TASK_ID}"'"
  and (.run_count | type == "number")
  and (.logical_cycle_count | type == "number")
  and (.totals.active_time_ms | type == "number")
  and (.totals.wall_time_ms | type == "number")
  and (.totals.wait_time_ms | type == "number")
  and (.totals.retry_count | type == "number")
  and (.totals.recovery_count | type == "number")
  and (.totals.invalid_count | type == "number")
  and (.role_metrics | type == "array")
  and all(.role_metrics[]?; (.role | type == "string")
    and (.workstream_key | type == "string")
    and (.active_time_ms | type == "number")
    and (.wall_time_ms | type == "number")
    and (.wait_time_ms | type == "number")
    and (.retry_count | type == "number")
    and (.recovery_count | type == "number")
    and (.invalid_count | type == "number"))
  and (.attempts | type == "array")
  and all(.attempts[]?;
    (.attempt_id | type == "string")
    and (.run_id | type == "string")
    and (.hop | type == "number")
    and (.role | type == "string")
    and (.status | type == "string")
    and (.logical_cycle_id | type == "string")
    and (.attempt_kind | type == "string")
    and ((.retry_of_attempt_id == null) or (.retry_of_attempt_id | type == "string"))
    and ((.restart_reason == null) or (.restart_reason | type == "string"))
    and (.workstream_key | type == "string")
    and ((.started_at == null) or (.started_at | type == "string"))
    and ((.completed_at == null) or (.completed_at | type == "string"))
    and (.derived | type == "boolean"))
' >/dev/null
echo "$RESP" | jq -e 'keys == ["attempts","logical_cycle_count","role_metrics","run_count","task_id","totals"]' >/dev/null
echo "$RESP" | jq -e 'has("attempt_count") | not' >/dev/null
echo "$RESP" | jq -e 'has("cycle_id") | not' >/dev/null
```

**硬阈值**: top-level keys 精确等于 `["attempts","logical_cycle_count","role_metrics","run_count","task_id","totals"]`；禁用字段名不得出现。

---

### Step 5: 4-run fixture 能把原始 4/2/5/9/5 计数还原为 logical cycle 与系统损耗
**来源**: `[FROM_PRD]` — PRD 核心场景第 5 步与第 22、32、94 行。

**可观测行为**: 固定 fixture 在多 run 场景下能区分 logical cycle、retry 损耗、recovery 损耗与 invalid evaluation，而不是只显示 raw role counts；并能从结构化 attempts 还原 `4/2/5/9/5` 原始角色计数。

**验证命令**:
```bash
RESP=$(curl -sf "http://localhost:5221/api/brain/harness/tasks/${FIXTURE_TASK_ID}/attempt-telemetry?include_attempts=true")
echo "$RESP" | jq -e '
  .run_count == 4
  and .logical_cycle_count == 2
  and .totals.retry_count == 2
  and .totals.recovery_count == 1
  and .totals.invalid_count == 1
  and ([.attempts[] | select(.role=="planner")] | length) == 4
  and ([.attempts[] | select(.role=="proposer")] | length) == 2
  and ([.attempts[] | select(.role=="reviewer")] | length) == 5
  and ([.attempts[] | select(.role=="generator")] | length) == 9
  and ([.attempts[] | select(.role=="judge")] | length) == 5
  and ([.attempts[] | select(.attempt_kind=="retry")] | length) >= 1
' >/dev/null
```

**硬阈值**: fixture 中 `run_count=4`、`logical_cycle_count=2`，且 `4/2/5/9/5` 原始角色计数与 retry/recovery/invalid 可分离统计。

---

### Step 6: 不改变既有 Kernel 路由决策和合同冻结语义
**来源**: `[FROM_PRD]` — PRD 背景与第 22、36、94 行。

**可观测行为**: 既有 kernel 决策回归和批准/冻结路径保持不退化。

**验证命令**:
```bash
npx vitest run packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=dot
```

**硬阈值**: 既有 Kernel wiring PG 集成回归继续通过，不因 telemetry 热修复改变 merge/approval/contract freeze 语义。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt lineage + query API + orphan 收口 | `sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts` | `GET /api/brain/harness/tasks/:task_id/attempt-telemetry 返回 telemetry schema`、`GET /api/brain/harness/tasks/:task_id/attempt-telemetry response keys 精确等于 telemetry 合同 keys`、`migration 358 adds lineage telemetry columns to harness_attempts`、`expired running attempt is resumed or structurally closed instead of hanging forever` | 当前 `harness.routes.js` 无新端点、`358_kernel_attempt_telemetry.sql` 尚不存在，仓库根 `npx vitest run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts` 应出现 4 个失败用例 |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

export DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
export TEST_TASK_ID="${TEST_TASK_ID:-11111111-1111-4111-8111-111111111111}"
export FIXTURE_TASK_ID="${FIXTURE_TASK_ID:-22222222-2222-4222-8222-222222222222}"
export TEST_RUN_ID="${TEST_RUN_ID:-33333333-3333-4333-8333-333333333333}"
export ORPHAN_ATTEMPT_ID="${ORPHAN_ATTEMPT_ID:-44444444-4444-4444-8444-444444444444}"

cd /workspace/packages/brain

npx vitest run src/__tests__/migration-357-harness-attempts.test.js src/orchestrator/__tests__/attempt-store.test.js
npx vitest run src/__tests__/integration/kernel-wiring.pg.integration.test.js
npx vitest run src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js src/routes/__tests__/harness.routes.test.js
cd /workspace
npx vitest run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts
cd /workspace/packages/brain

RESP=$(curl -sf "http://localhost:5221/api/brain/harness/tasks/${FIXTURE_TASK_ID}/attempt-telemetry?include_attempts=true")
echo "$RESP" | jq -e '
  .run_count == 4
  and .logical_cycle_count == 2
  and .totals.retry_count == 2
  and .totals.recovery_count == 1
  and .totals.invalid_count == 1
' >/dev/null

psql "$DB_URL" -Atc "
SELECT COUNT(*)
FROM harness_attempts
WHERE id='${ORPHAN_ATTEMPT_ID}'
  AND created_at > NOW() - interval '5 minutes'
  AND (
    attempt_kind IN ('resume','recovery')
    OR (status IN ('failed','cancelled','blocked','needs_context') AND completed_at IS NOT NULL)
  );
" | grep -q '^[1-9]'

bash /workspace/scripts/check-version-sync.sh
echo "✅ Kernel telemetry Golden Path 验证通过"
```
