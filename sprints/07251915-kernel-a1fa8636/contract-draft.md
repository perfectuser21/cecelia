# Sprint Contract Draft (Round 5)

contract-gate: active
覆盖父路 Kernel telemetry 账本 第 1-5 步

## Notes

- context-manifest: unavailable
- registry freshness: api/db/test registry 最新扫描于 2026-07-18，已过期 166.2h；命名风格仅作参考，PRD 仍为法律。
- judgment-pending-user: ⚠️orphan attempt 在 lease 过期后优先 resume 还是优先结构化终结
- initiative_id: unavailable in proposer inputs，本轮 task-plan.json 以 `pending` 占位，待上游注入后可无语义冲突替换
- red-evidence: 两份 sprint 契约测试必须从仓库根显式执行；Red 是缺 migration/query/orphan 收口能力导致的 `expect` 断言失败，不接受连接生产库、测试 runner 启动失败或 import collection error 伪装 Red
- database-safety: 只允许显式 `TEST_DATABASE_URL` 且数据库名以 `_test|_scratch` 结尾；禁止 `DB_URL` / `DATABASE_URL` / `postgresql://localhost/cecelia` fallback

## Response Schema（推导来源: [api_registry推导/PRD字面]）

### Endpoint: `GET /api/brain/harness/tasks/:task_id/attempt-telemetry`
**Success (HTTP 200)**:
```json
{
  "task_id": "uuid",
  "run_count": 4,
  "logical_cycle_count": 2,
  "raw_counts": {
    "planner": 4,
    "reviewer": 5,
    "generator": 9,
    "judge": 5
  },
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
- `raw_counts` (object, 必填): 来源——PRD 第 5 步“4-run fixture 中 4/2/5/9/5 raw counts 可还原”；至少包含 `planner/reviewer/generator/judge`
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
**禁用字段名**: `attempt_count`, `cycle_id`, `kind`, `time_ms`, `run_total`, `secret`, `token`, `callback_secret_hash`, `error_message`, `task_bundle`, `result`
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

## 账本语义冻结（计算来源、边界与聚合等式）

### 时间字段来源

- `effective_start_at = started_at`。若 role 缺原生 start 事件，写入方可从该 attempt 的结构化 `created_at` 投影到 `started_at`，但必须同时持久化 `time_derived=true`；禁止从日志或 agent 文本提取时间。
- `effective_end_at = completed_at`。本 sprint 的固定 fixture 只聚合终态 attempt；非终态只返回明细，不进入已完成 totals，避免查询时钟导致不可复现。缺原生 end 事件时允许以同一结构化终态事务的 `updated_at` 投影到 `completed_at`，并置 `time_derived=true`。
- `active_time_ms = max(0, effective_end_at - effective_start_at)`。
- `wait_time_ms = max(0, effective_start_at - created_at)`。
- `wall_time_ms = max(0, effective_end_at - created_at)`；对合法时间序列必须机械满足 `wall_time_ms = active_time_ms + wait_time_ms`。
- 负区间一律归零且三者同时为 0，不得回传负耗时；`NULL` 不能被静默当 0，只有上述结构化投影补齐后才参与 totals。

### 六类 role 与 derived

- PRD 要求的计时 role 全集固定为 `planner/generator/reviewer/evaluator/judge/reporter`；fixture 六类必须全部出现，禁止 `all([])` 或空 `role_metrics` 假绿。
- `judge`、`reporter` fixture 明确 `time_derived=true`，API 对应 attempt 必须 `derived=true`；其余 role fixture 为原生时间，`derived=false`。
- `role_metrics` 以 `(role, workstream_key)` 分组；每个组分别满足 wall 等式。所有组的 active/wait/wall/retry/recovery/invalid 之和必须逐字段等于 `totals`。
- 固定 4-run fixture 共 25 个终态 attempt，每个 attempt 的 `created_at=00:00:00.000Z`、`started_at=00:00:00.500Z`、`completed_at=00:00:01.500Z`，因此每条为 active=1000、wait=500、wall=1500，totals 必须精确为 `25000/12500/37500`，禁止“number 即可”或任意填 0。

### 分类与 lineage

- `retry_count` 只统计结构化 `attempt_kind='retry'`。
- `recovery_count` 只统计结构化 `attempt_kind IN ('resume','recovery')`。
- `invalid_count` 只统计结构化 `result.evaluation.valid=false`；禁止从 `result.agent_text`、`error_message`、stdout 或日志中搜索 `invalid/retry/recovery`。
- `attempt_kind IN ('retry','resume','recovery')` 时 `retry_of_attempt_id` 必须非空并指向同 task lineage 的旧 attempt；`initial|fix` 不得凭自然语言升级为 retry/recovery。
- 固定 fixture 在 agent 文本与错误消息中放入相反噪声 `retry recovery invalid watchdog_overdue`，结构化字段为 normal 时三个计数仍为 0。

### 租户与脱敏

- query 必须同时以 `tenant_id + task_id` 约束 `initiative_runs` 后再关联 `harness_attempts`；只按 task/run 查不合格。
- 双租户 fixture 在同一隔离 schema 真写 tenant-a/tenant-b。tenant-a 查询 tenant-b task 必须返回结构化 `telemetry_not_found`，不能回空的成功响应泄露“存在性”。
- 响应采用字段白名单，绝不返回 `callback_secret_hash/task_bundle/result/error_message`；fixture 把 `SUPER-SECRET-TOKEN`、bearer、原始 agent 内容写入这些列，序列化响应仍不得命中敏感串。

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
| additive migration 失败或 URL 非 `_test/_scratch` | 在首次连接/SQL 前中止，保持旧 schema 不变 | 是 | 无生产 fallback；仅隔离 test schema Red→Green |
| orphan reclaim 发现 lease 已被新 owner 接管 | 旧 owner fenced，不能改状态/时间/secret，返回结构化 no-op | 是 | 保留新 owner 的 live attempt，交给后续 reconcile |
| orphan resume 回执为 `null`/`false` | 本轮结构化终结一次并记录 failure code，不当作成功 | 是 | 第二次扫描与重复 callback 必须 dedupe |
| telemetry API 参数缺失或 task 不存在 | 返回 400/404 + `error` | 是 | 不返回猜测值 |
| judge/reporter 无原生起止事件 | 返回 `derived=true` 的时间字段 | N/A | 不伪造原始时间戳 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 为 Brain 内部 attempt/telemetry 热修复，不新增对外可写 agent 输入面。

## Risks

| 风险 | 机械缓解 | 验收证据 |
|---|---|---|
| 生产库被测试误触 | `TEST_DATABASE_URL` 必填且库名仅 `_test/_scratch`；连接前 fail-closed；无任何生产默认值 | PG contract 的安全测试用 `cecelia` / `cecelia_dev` 负例，测试查询 `current_database()` |
| orphan 重复收口或旧 owner 覆盖新 owner | lease owner fencing + 终态单写 + 同一 fixture 连续扫描两次 + 旧 callback 重放 | 真调用 `reconcileExpiredKernelAttempt` 后查真实 PG，终结行严格 1 条，live 新 owner 保持 running |
| 跨租户聚合 | 查询入口强制 `tenant_id + task_id`，双租户同 schema 交叉查询 | tenant-a 无法读取 tenant-b task/attempt，返回 `telemetry_not_found` |
| judge/reporter derived 误分类 | 时间来源与公式冻结；六 role 非空全集；judge/reporter 必为 `derived=true` | 固定 25-attempt fixture 验 exact totals + role 总和 + derived |
| agent 自然语言污染分类或泄密 | 仅使用 `attempt_kind` / `result.evaluation.valid`；响应字段白名单 | 相反文本噪声不改变计数，secret/token/raw content 不出现在 JSON |

## 真实调用方请求 shape

### Query caller: `GET /api/brain/harness/tasks/:task_id/attempt-telemetry`
- 作用域方式: trusted Brain caller 必须带 `x-tenant-id` header；服务端以该值匹配 `tasks.payload.tenant_id` 后再关联 `initiative_runs.current_task_id`，不得只按 run/task 扫全表
- 路径参数: `task_id`（UUID）
- Query 参数: `include_attempts=true|false`（可选，默认 `true`）
- Content-Type: 无请求体
- 响应: `application/json`
- 契约要求: 不允许把 `task_id`/`tenant_id` 换到 body；不允许把 `logical_cycle_id` 缩写为 `cycle_id`；缺 tenant header 返回 400，tenant/task 不匹配返回 404 `telemetry_not_found`

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
: "${TEST_DATABASE_URL:?必须显式指向 _test/_scratch 测试库}"
node -e 'const d=new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);if(!/(_test|_scratch)$/.test(d)||d==="cecelia")process.exit(1)'
npx vitest run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts \
  -t '真实隔离 PG 执行 additive migration 两次且不改写 357 既有列' --reporter=verbose
```

**硬阈值**: migration 文件为当前 next `361_kernel_attempt_telemetry.sql`；隔离 schema 先执行真实 357，再执行 361 两次；六个新增字段（含 `time_derived`）存在，357 的既有列名/类型/nullability 前缀逐项等价；任何非测试库在连接或 SQL 前失败。

---

### Step 2: planner/generator/reviewer/evaluator/judge/reporter 都有统一起止时间或 derived 标志
**来源**: `[FROM_PRD]` — PRD 核心场景第 2 步与第 19、31 行。

**可观测行为**: role 级 attempt 在 `starting`、`running`、终态时都能读到统一时间字段；无法原生记录者显式 `derived=true`。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts \
  -t '时间公式冻结|六类计时 role' --reporter=verbose
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts \
  -t '4-run fixture 锁定时间公式' --reporter=verbose
```

**硬阈值**: 六 role 全部非空；25 条固定 fixture exact totals = active `25000` / wait `12500` / wall `37500`；所有 role/workstream sum 与 totals 对齐；每组 wall=active+wait；judge/reporter `derived=true`，负时间 fixture 三值全为 0。

---

### Step 3: lease 过期 orphan 会被 resume/recovery 链路认领或结构化终结
**来源**: `[FROM_PRD]` — PRD 核心场景第 3 步与第 20、29、61 行。

**可观测行为**: `starting` / `running` 的过期 orphan 不会永久悬挂；要么出现新的 `resume|recovery` attempt，要么旧 attempt 进入结构化终态。

**验证命令**:
```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts \
  -t '真调用 orphan 收口入口' --reporter=verbose
```

**硬阈值**: 测试显式真写 expired running fixture 并调用生产收口入口；`null` 与 `false` 回执均结构化失败；同 fixture 连扫两次 + 旧 callback 重放后只有一次终结；已有 live 新 owner 时旧 owner fenced，状态仍 running；产生新 attempt 时 `retry_of_attempt_id` 必须严格等于 orphan id。

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
  and (.raw_counts | type == "object")
  and (.totals.active_time_ms | type == "number")
  and (.totals.wall_time_ms | type == "number")
  and (.totals.wait_time_ms | type == "number")
  and (.totals.retry_count | type == "number")
  and (.totals.recovery_count | type == "number")
  and (.totals.invalid_count | type == "number")
  and (.role_metrics | type == "array")
  and (.role_metrics | length >= 6)
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
echo "$RESP" | jq -e 'keys == ["attempts","logical_cycle_count","raw_counts","role_metrics","run_count","task_id","totals"]' >/dev/null
echo "$RESP" | jq -e '
  . as $root
  | ([.role_metrics[].active_time_ms] | add) == $root.totals.active_time_ms
' >/dev/null
echo "$RESP" | jq -e 'has("attempt_count") | not' >/dev/null
echo "$RESP" | jq -e 'has("cycle_id") | not' >/dev/null
```

**硬阈值**: top-level keys 精确等于 `["attempts","logical_cycle_count","raw_counts","role_metrics","run_count","task_id","totals"]`；`logical_cycle_id` 必须 string；六类 role 都出现；role/workstream 合计逐字段等于 totals；禁用与敏感字段不得出现。

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
  and .raw_counts.planner == 4
  and .raw_counts.reviewer == 5
  and .raw_counts.generator == 9
  and .raw_counts.judge == 5
  and .totals.active_time_ms == 25000
  and .totals.wait_time_ms == 12500
  and .totals.wall_time_ms == 37500
  and .totals.retry_count == 2
  and .totals.recovery_count == 1
  and .totals.invalid_count == 1
  and ([.role_metrics[].role] | unique
       | sort == ["evaluator","generator","judge","planner","reporter","reviewer"])
  and ([.attempts[] | select(.role=="judge" or .role=="reporter")]
       | length > 0 and all(.[]; .derived == true))
' >/dev/null
```

**硬阈值**: fixture 中 `run_count=4`、`logical_cycle_count=2`，`planner/reviewer/generator/judge=4/5/9/5`，六计时 role 全集出现；agent 文本放入反向分类噪声仍只有结构化 `retry=2/recovery=1/invalid=1`；exact totals 为 `25000/12500/37500`。

---

### Step 6: 不改变既有 Kernel 路由决策和合同冻结语义
**来源**: `[FROM_PRD]` — PRD 背景与第 22、36、94 行。

**可观测行为**: 既有 kernel 决策回归和批准/冻结路径保持不退化。

**验证命令**:
```bash
CONTRACT_BASE_SHA="${CONTRACT_BASE_SHA:?}" npx vitest run \
  sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts \
  -t 'Kernel action 路由元数据|合同冻结|scope guard' --reporter=verbose
(cd packages/brain && ../../node_modules/.bin/vitest run \
  src/orchestrator/__tests__/derive.test.js \
  src/orchestrator/__tests__/contract-store.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js \
  src/orchestrator/__tests__/kernel-callback-flow.integration.test.js \
  --reporter=dot)
```

**硬阈值**: action→role/skill/readOnly/expectedOutput 快照逐字段等价；derive/contract-store/kernel callback 回归全绿；diff 不含 Commander/Memory/Directive/Actor Inbox/唤醒/第二流程账本，migration 不创建相关表。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 时间公式 + Kernel/合同冻结边界 | `sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts` | `GET /tasks/:task_id/attempt-telemetry 已注册到真实 harness router`、`GET telemetry 缺 x-tenant-id 时返回 400 + error string 而非通用 404`、`时间公式冻结为 wall = active + wait`、`Kernel action 路由元数据与 telemetry 改动前完全等价`、`合同冻结、Kernel 决策与 callback 路径既有回归继续通过`、`scope guard 禁止触碰 Commander/Memory/Directive/Actor Inbox/唤醒/第二流程账本`、`六类计时 role 常量冻结且 judge/reporter 必须有 derived oracle` | 当前缺 `attempt-telemetry.js`，对应 it() 以 `expect.fail` 产生断言 Red；既有冻结回归仍能独立启动，不接受 collection error |
| 真 PG migration + lineage + orphan + 聚合/租户 | `sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts` | `真实隔离 PG 执行 additive migration 两次且不改写 357 既有列`、`attempt-store 真写 lineage，新 attempt 严格绑定 retry_of_attempt_id`、`真调用 orphan 收口入口：新 owner fencing、多轮、重复 callback、null/false 只终结一次`、`4-run fixture 锁定时间公式、六 role、derived、结构化分类与 totals 对齐`、`双租户真实 PG fixture 不可交叉读取，文本噪声不改变 retry/recovery/invalid 分类` | 当前缺 migration 361/query module/生产收口 export；在显式 `_test` DB 的唯一隔离 schema 内执行，Red 为 expect 断言失败并在 afterEach DROP SCHEMA 清理 |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

: "${TEST_DATABASE_URL:?必须由 evaluator 显式注入 _test/_scratch，禁止生产 fallback}"
: "${CONTRACT_BASE_SHA:?必须锚定 generator 开始前合同 commit}"
DB_NAME=$(node -e 'const d=new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);if(!/(_test|_scratch)$/.test(d)||d==="cecelia")process.exit(1);process.stdout.write(d)')
export DB_NAME
export NODE_ENV=test

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

TEST_DATABASE_URL="$TEST_DATABASE_URL" CONTRACT_BASE_SHA="$CONTRACT_BASE_SHA" \
  npx vitest run \
    sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts \
    sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts \
    --reporter=verbose

(cd packages/brain && ../../node_modules/.bin/vitest run \
  src/__tests__/migration-357-harness-attempts.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/orchestrator/__tests__/derive.test.js \
  src/orchestrator/__tests__/contract-store.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js \
  src/orchestrator/__tests__/kernel-callback-flow.integration.test.js \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  --reporter=dot)

bash scripts/check-version-sync.sh
echo "✅ Kernel telemetry Golden Path 验证通过"
```
