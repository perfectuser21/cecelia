# Sprint Contract Draft (Round 1)

> Initiative B1 — Harness 预检基线
> Planner branch: `cp-04271309-ws-8b85012d`
> Sprint: `sprints/run-20260427-1311-b1-preflight`

---

## Feature 1: Initiative 预检结果存储

**行为描述**:
Initiative 预检的结构化结果（passed / rejected、原因列表、检查时间戳、关联 initiative_id）能被持久化并回读。同一个 Initiative 多次预检会保留多条历史，但"最新一次"可被确定性地查到。

**硬阈值**:
- 一条预检记录至少包含 4 个字段：`initiative_id`（非空 UUID/字符串）、`status` ∈ `{passed, rejected}`、`reasons`（JSON 数组，passed 时可为空数组）、`checked_at`（时间戳，非空）。
- 同一 initiative_id 写入两次后，按 `checked_at` 倒序读最新那条 → 返回最新的 status 与 reasons。
- 在已经创建过该表的库上重复执行迁移 → 不抛异常（idempotent）。

**BEHAVIOR 覆盖**（落在 `tests/ws1/`）:
- `it('migration applies cleanly to empty schema and creates initiative_preflight_results table with required columns')`
- `it('migration is idempotent — applying twice does not throw')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- migration 文件 `packages/brain/migrations/247_initiative_preflight_results.sql` 存在
- migration SQL 含 `CREATE TABLE IF NOT EXISTS initiative_preflight_results`（idempotent guard）
- migration SQL 声明 `initiative_id`、`status`、`reasons`、`checked_at` 四列

---

## Feature 2: 预检规则模块（纯函数）

**行为描述**:
给定 Initiative 的描述、PRD 文本、task-plan 对象，模块输出 `{ status, reasons }`。覆盖：描述长度、PRD 必填章节、task-plan schema、Task 数量上限、单 Task 字段、DAG 无环。模块不读 DB，便于单元测试。

**硬阈值**:
- 合规输入 → `status === 'passed'` 且 `reasons.length === 0`。
- DAG 含环（`A→B→A` 或更长）→ `status === 'rejected'` 且 `reasons` 包含字符串前缀 `dag_has_cycle`。
- PRD 缺少"成功标准"章节（无 `## 成功标准` 或 `## Success Criteria`）→ `reasons` 包含 `prd_missing_section: success_criteria`。
- Task 数量 `> 8` → `reasons` 包含 `task_count_exceeded`。
- 描述长度 `< 50 字符` → `reasons` 包含 `description_too_short`。
- 任一 Task 缺 `estimated_minutes` → `reasons` 包含 `task_missing_field: estimated_minutes`。

**BEHAVIOR 覆盖**（落在 `tests/ws2/`）:
- `it('returns passed with empty reasons for a fully compliant initiative')`
- `it('returns rejected with dag_has_cycle reason when task-plan contains a 2-task cycle')`
- `it('returns rejected with prd_missing_section: success_criteria when PRD lacks the section')`
- `it('returns rejected with task_count_exceeded when task-plan has more than 8 tasks')`
- `it('returns rejected with description_too_short when description is below 50 characters')`
- `it('returns rejected with task_missing_field reason when a task lacks estimated_minutes')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws2.md`）:
- 文件 `packages/brain/src/preflight-rules.js` 存在
- 模块导出名 `runPreflight`（grep 命中 `export.*runPreflight`）

---

## Feature 3: 预检 HTTP 接口与持久化

**行为描述**:
Brain 暴露两个端点：`POST /api/brain/initiatives/:id/preflight` 触发预检，`GET /api/brain/initiatives/:id/preflight` 查询最近一次结果。POST 内部读取 Initiative 数据 → 调用规则模块 → 把结果写入 ws1 的存储。

**硬阈值**:
- 合规 Initiative POST → HTTP 200，响应体 `status === 'passed'`，DB 留下 1 条记录。
- 不合规 Initiative POST → HTTP 200，响应体 `status === 'rejected'`，`reasons` 数组 `length > 0`。
- 同一 Initiative 连续 POST 两次后，GET → 返回最新一条（按 `checked_at` 比较）。
- 不存在的 `initiative_id` → POST 返回 HTTP 404。

**BEHAVIOR 覆盖**（落在 `tests/ws3/`）:
- `it('POST on a compliant initiative returns 200 with status=passed and persists one row')`
- `it('GET after two POSTs returns the latest record by checked_at')`
- `it('POST on a non-compliant initiative returns 200 with status=rejected and non-empty reasons')`
- `it('POST with unknown initiative_id returns HTTP 404')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws3.md`）:
- 文件 `packages/brain/src/routes/preflight.js` 存在
- `packages/brain/server.js` 含 `import preflightRoutes from './src/routes/preflight.js'`（grep 命中）

---

## Feature 4: Runner 集成与 fail-close 拦截

**行为描述**:
Initiative Runner 在派发 Generator 之前调用预检接口；rejected 时阻止 Generator，并把失败原因回写到原始任务的 result。预检接口异常（超时/500）默认 fail-close（不放行）。

**硬阈值**:
- preflight 返回 `passed` → Generator 被调用 1 次。
- preflight 返回 `rejected` → Generator 调用次数 `=== 0`；`writeResult` 收到包含 `reasons` 数组的对象。
- preflight 抛异常 → Generator 调用次数 `=== 0`（fail-close）。
- preflight 抛异常 → 日志 sink 收到至少 1 条 level=error 的记录。

**BEHAVIOR 覆盖**（落在 `tests/ws4/`）:
- `it('does not invoke Generator when preflight returns rejected')`
- `it('invokes Generator exactly once when preflight returns passed')`
- `it('does not invoke Generator when preflight throws (fail-close default)')`
- `it('writes reasons array into task result when preflight rejects')`
- `it('logs an error when preflight throws')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws4.md`）:
- 文件 `packages/brain/src/initiative-runner.js` 存在
- 模块导出名 `runInitiative`（grep 命中 `export.*runInitiative`）

---

## Workstreams

workstream_count: 4

### Workstream 1: 预检结果存储 schema

**范围**: 仅新增 migration 文件 `packages/brain/migrations/247_initiative_preflight_results.sql`。不改 `initiatives` / `tasks` 表的核心列。
**大小**: S（单个 SQL 文件 ~30 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/migration.test.ts`

### Workstream 2: 预检规则模块（纯函数）

**范围**: 仅新增 `packages/brain/src/preflight-rules.js`，导出 `runPreflight({ description, prd, taskPlan })`。不读 DB、不调用 HTTP。
**大小**: M（~200 行业务 + 单测）
**依赖**: ws1 完成（schema 已就绪后规则才有去处，但运行期不直接耦合）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/preflight-rules.test.ts`

### Workstream 3: 预检 HTTP 接口与持久化

**范围**: 新增 `packages/brain/src/routes/preflight.js`，挂到 `server.js`。POST 触发预检并写入 ws1 表，GET 查最新一条。
**大小**: M（~150 行）
**依赖**: ws2 完成（要调用规则模块）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/preflight-api.test.ts`

### Workstream 4: Runner 集成与 fail-close 拦截

**范围**: 新增 `packages/brain/src/initiative-runner.js`，导出 `runInitiative({ initiativeId, deps })`。在派发 Generator 前 await 预检调用，rejected/throw 都 fail-close。
**大小**: M（~120 行）
**依赖**: ws3 完成（要调用预检 HTTP 接口或其内部函数）

**BEHAVIOR 覆盖测试文件**: `tests/ws4/runner-integration.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/migration.test.ts` | migration applies cleanly / idempotent | `npx vitest run sprints/run-20260427-1311-b1-preflight/tests/ws1/` → 2 failures（ENOENT：migration 文件不存在） |
| WS2 | `tests/ws2/preflight-rules.test.ts` | passed / dag_has_cycle / prd_missing_section / task_count_exceeded / description_too_short / task_missing_field | `npx vitest run sprints/run-20260427-1311-b1-preflight/tests/ws2/` → 6 failures（模块 `preflight-rules.js` 不存在） |
| WS3 | `tests/ws3/preflight-api.test.ts` | passed+persist / get latest / rejected+reasons / 404 unknown id | `npx vitest run sprints/run-20260427-1311-b1-preflight/tests/ws3/` → 4 failures（路由 `routes/preflight.js` 不存在） |
| WS4 | `tests/ws4/runner-integration.test.ts` | rejected→no generator / passed→generator / fail-close on throw / reasons in result / error log | `npx vitest run sprints/run-20260427-1311-b1-preflight/tests/ws4/` → 5 failures（`initiative-runner.js` 不存在） |
