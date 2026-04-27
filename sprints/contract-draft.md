# Sprint Contract Draft (Round 1)

**Initiative**: B2 — Pre-flight Validation
**Task ID**: 2b491db2-9f7e-4207-ba1d-2a668bb3a549
**Planner Branch**: cp-04271304-ws-2b491db2

---

## Feature 1: Pre-flight 校验器（PRD + task-plan + DAG）

**行为描述**:
给定一个 Initiative 目录路径，校验器返回结构化判定 `{verdict: "pass"|"fail", failures: string[]}`。
判定覆盖 PRD 段缺失、task-plan.json 缺失/schema 不符、DAG 自指/环路/悬挂依赖、tasks 数量越界、estimated_minutes 越界、空 dod。

**硬阈值**:
- `verdict` 字段值 ∈ {"pass", "fail"}，不能为 null/undefined
- 校验器对 9 类已知违规的 fixture 集合命中率 = 100%（每类至少 1 条对应 failure code）
- 对合规 fixture，`verdict === "pass"` 且 `failures.length === 0`
- 单次校验返回时间 < 200ms（不含网络）
- failure code 命名稳定（不允许任意改名）：`prd_empty` / `missing_section:<段名>` / `task_plan_missing` / `dag_cycle_detected` / `dangling_dependency:<id>` / `task_count_out_of_range` / `estimated_minutes_out_of_range:<task_id>` / `empty_dod:<task_id>` / `self_dependency:<id>`

**BEHAVIOR 覆盖**（`tests/ws1/preflight-validator.test.ts`）:
- `it('returns pass with empty failures for fully compliant initiative')`
- `it('returns fail with prd_empty when sprint-prd.md is empty')`
- `it('returns fail with missing_section code listing the absent section')`
- `it('returns fail with task_plan_missing when task-plan.json absent')`
- `it('returns fail with dag_cycle_detected and lists cycle node ids')`
- `it('returns fail with self_dependency when a task depends on itself')`
- `it('returns fail with dangling_dependency naming the missing task_id')`
- `it('returns fail with task_count_out_of_range when tasks > 8 or < 1')`
- `it('returns fail with estimated_minutes_out_of_range for any task outside [20,60]')`
- `it('returns fail with empty_dod when any task has zero dod entries')`
- `it('completes validation in under 200 ms for a typical initiative')`

**ARTIFACT 覆盖**:
- `packages/brain/src/preflight.js` 文件存在，导出 `validatePreflight` 函数
- 必填段名常量定义在 `preflight.js`：包含「目标」「User Stories」「验收场景」「功能需求」「成功标准」5 个
- `MAX_TASKS = 8` 与 `MIN_TASKS = 1` 常量定义
- `MIN_ESTIMATED_MINUTES = 20` 与 `MAX_ESTIMATED_MINUTES = 60` 常量定义

---

## Feature 2: 校验结果持久化 + 历史查询 API

**行为描述**:
每次校验完成后，调用方（Runner 或测试）把判定写入 `preflight_results` 表；查询 API `GET /api/brain/initiatives/:id/preflight` 按时间倒序返回该 Initiative 最近 N 条记录（默认 N=20）。

**硬阈值**:
- `preflight_results` 表至少含字段：`id`（PK）、`initiative_id`（NOT NULL）、`verdict`（NOT NULL，文本，pass/fail）、`failures`（jsonb，默认 `'[]'::jsonb`）、`created_at`（NOT NULL，默认 now()）
- 同一 Initiative 在 1 秒内多次写入，每次都新增一行（无去重）
- API 对存在的 initiative_id 返回 200 + `{records: [...]}`，按 `created_at DESC`
- API 对不存在的 initiative_id 返回 HTTP 404 + `{error: <string>}`，绝不抛 500
- 响应数组长度受 `?limit=` 控制，未传时默认 20，最大 100

**BEHAVIOR 覆盖**（`tests/ws2/preflight-store.test.ts` + `tests/ws2/preflight-api.test.ts`）:
- `it('inserts a row with verdict, failures, initiative_id and created_at')`
- `it('persists distinct rows for two writes within same second')`
- `it('returns records in created_at descending order')`
- `it('respects limit query parameter')`
- `it('caps limit at 100 even if larger value requested')`
- `it('returns 404 with error body when initiative does not exist')`
- `it('returns 200 with empty records array for known initiative with no history')`

**ARTIFACT 覆盖**:
- `packages/brain/migrations/247_preflight_results.sql` 文件存在
- migration 文件内含 `CREATE TABLE` `preflight_results` 与 `initiative_id` 列
- migration 文件内含 `CREATE INDEX` 覆盖 `(initiative_id, created_at DESC)`
- `packages/brain/src/preflight-store.js` 文件存在，导出 `recordPreflightResult` 与 `getPreflightHistory` 函数
- `packages/brain/src/routes/initiatives.js` 注册 `router.get('/:id/preflight', ...)` 路由

---

## Feature 3: Initiative Runner 在 Planner→Generator 切换点的 Pre-flight Gate

**行为描述**:
Runner 在 Planner 阶段产出后调用 Pre-flight Gate；通过则把 Initiative 状态推进到 `ready_for_generator` 并落库一条 pass；不通过则保持 `awaiting_plan` 并落库一条 fail。任意一次校验都必须落库（无论结果）。

**硬阈值**:
- pass 时：返回值 `{advanced: true, newStatus: 'ready_for_generator'}`，且 `recordPreflightResult` 被调用 1 次（verdict='pass'）
- fail 时：返回值 `{advanced: false, newStatus: 'awaiting_plan', failures: [...]}`，且 `recordPreflightResult` 被调用 1 次（verdict='fail'，failures 非空）
- Gate 函数对未传 `initiativeId` 抛错（不允许静默通过）

**BEHAVIOR 覆盖**（`tests/ws3/preflight-gate.test.ts`）:
- `it('advances state to ready_for_generator when preflight passes')`
- `it('keeps state at awaiting_plan when preflight fails')`
- `it('records exactly one preflight_results row per gate invocation regardless of verdict')`
- `it('records failures array verbatim from validator into the store on fail')`
- `it('throws when initiativeId is missing or empty')`

**ARTIFACT 覆盖**:
- `packages/brain/src/initiative-runner.js` 文件存在，导出 `runPreflightGate` 函数
- `runPreflightGate` 在文件中 import `validatePreflight` 与 `recordPreflightResult`

---

## Workstreams

workstream_count: 3

### Workstream 1: Pre-flight 校验器核心

**范围**: 实现 `packages/brain/src/preflight.js` 的 `validatePreflight(initiativeDir)` 纯函数，覆盖 PRD 段校验 / task-plan.json schema 校验 / DAG 拓扑校验。不涉及 DB 或 HTTP。
**大小**: M（150-250 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/preflight-validator.test.ts`

### Workstream 2: 持久化 + 历史查询 API

**范围**: 新增 migration `247_preflight_results.sql`、新建 `packages/brain/src/preflight-store.js`（recordPreflightResult / getPreflightHistory）、扩展 `packages/brain/src/routes/initiatives.js` 添加 `GET /:id/preflight`。
**大小**: M（150-250 行）
**依赖**: 无（不依赖 WS1 实现，只依赖共同的 verdict/failures 数据结构）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/preflight-store.test.ts`、`tests/ws2/preflight-api.test.ts`

### Workstream 3: Initiative Runner Pre-flight Gate 集成

**范围**: 在 `packages/brain/src/initiative-runner.js` 添加 `runPreflightGate(initiativeId)`，编排 validator + store + 状态机。
**大小**: S（80-150 行）
**依赖**: WS1（validator）、WS2（store）实现完成后才能跑绿；测试阶段通过 mock 解耦

**BEHAVIOR 覆盖测试文件**: `tests/ws3/preflight-gate.test.ts`

---

## Test Contract

跑测：`cd sprints && npx vitest run tests/ws{N}/ --reporter=verbose`（依赖 `sprints/vitest.config.js`）

| Workstream | Test File | BEHAVIOR 覆盖 | 实测红证据（Round 1，本地）|
|---|---|---|---|
| WS1 | `tests/ws1/preflight-validator.test.ts` | pass / prd_empty / missing_section / task_plan_missing / dag_cycle / self_dep / dangling / count / minutes / empty_dod / perf | 11 failed / 11 total（preflight.js 不存在，beforeAll 捕获后每个 it 抛 import error）|
| WS2 | `tests/ws2/preflight-store.test.ts` + `tests/ws2/preflight-api.test.ts` | insert / no-dedup / desc / limit / cap100 / 404 / 200-empty | 7 failed / 7 total（store 5 个 import error + api 2 个 route 未注册返回默认 404）|
| WS3 | `tests/ws3/preflight-gate.test.ts` | advance-on-pass / keep-on-fail / one-row-per-gate / failures-verbatim / throws-on-missing-id | 5 failed / 5 total（initiative-runner.js 不存在 + 错误消息正则约束防止假阳性）|

合计 **23 failed / 23 total**（4 个测试文件全红），见 `/tmp/all-red.log` 摘要。
