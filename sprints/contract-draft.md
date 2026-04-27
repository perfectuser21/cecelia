# Sprint Contract Draft (Round 2)

**Initiative**: B2 — Pre-flight Validation
**Task ID**: 2b491db2-9f7e-4207-ba1d-2a668bb3a549
**Planner Branch**: cp-04271304-ws-2b491db2
**Round 1 → Round 2 变更摘要**: 仅在末尾新增 `## Risks & Mitigations` 栏（9 条具名风险 + 缓解策略），回应 Reviewer "risk_registered = 2 → 目标 ≥ 7" 反馈。Features / Workstreams / Test Contract 内容、DoD 文件、测试文件保持 Round 1 不变（Reviewer 未提出实质 spec 漏洞）。

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

---

## Risks & Mitigations

下列 9 条具名风险覆盖 contract → DoD → 测试 → 实现 → 落地的全链路，回应上轮 Reviewer "risk_registered ≥ 7" 阈值要求。每条均给出具体可执行的缓解动作。

### R1（cascade — WS 间接口契约漂移）
**描述**: WS3 (`runPreflightGate`) 测试用 `vi.mock` 桩掉 `validatePreflight` 与 `recordPreflightResult`。若 WS1 后续把 `validatePreflight(initiativeDir: string)` 改成 `validatePreflight({ dir, sprintName })` 之类的对象签名，WS3 mock 仍会"成功"返回，但 Generator 实跑时形参不匹配，gate 静默通过假 pass。
**Mitigation**:
- WS1 测试新增一条契约锚点：`it('validatePreflight signature stays (initiativeDir: string) → Promise<{verdict, failures[]}>')`，用 `validatePreflight.length === 1` 与 `typeof (await validatePreflight(tmpDir)).verdict === 'string'` 锁形状。
- WS3 测试在 mock 实现里显式 `expect(args[0]).toEqual(expect.any(String))`，签名变了立即红。

### R2（schema drift — migration 编号撞号）
**描述**: 合同定义 `247_preflight_results.sql`，但 main 分支若另有并发 PR 也用 247，merge 后两个 migration 同号，PG 会按文件名字典序执行，可能导致依赖错乱或部分环境跳过。
**Mitigation**:
- 合并前 CI 跑 `ls packages/brain/migrations/ | grep -E '^[0-9]{3}_' | sort -n | tail -1`，校验 247 仍是当前最大编号 +1；不是则 rebase 重命名为下一个空闲号。
- DoD 已限定文件路径为 `247_preflight_results.sql`，Generator 阶段如发现 246 已是最大值则 OK；如发现 248+ 已存在则在 PR 描述里声明改号。

### R3（perf 漂移 — CI 慢机器抖动）
**描述**: SC-003 要求单次校验 < 200ms，但 CI runner（GH Actions free tier、共享 Mac mini）IO 抖动可能让单次跑出 300-500ms，触发假红。
**Mitigation**:
- WS1 perf 测试主断言保持 `expect(elapsed).toBeLessThan(200)`，但加 CI 放宽分支：`const limit = process.env.CI ? 400 : 200; expect(elapsed).toBeLessThan(limit)`。
- 进一步保险：跑 5 次取 P95，避免单次抖动直接打挂；若 P95 > 200ms 才红。

### R4（failure code 命名稳定性 — 下游消费方耦合）
**描述**: 合同枚举的 9 个 failure code（`prd_empty` / `missing_section:<段名>` / `dag_cycle_detected` 等）会被 Initiative Runner、Brain Dashboard、未来的 Planner 自动重写器消费。任意改名即破坏所有下游。
**Mitigation**:
- WS1 把 9 个 code 提为 `export const FAILURE_CODES = Object.freeze({ PRD_EMPTY: 'prd_empty', ... })`，并在测试里加 snapshot 锁：`expect(FAILURE_CODES).toMatchInlineSnapshot()`。改名直接红。
- 已在 Feature 1 硬阈值列出 9 个 code，DoD ws1 可加一条 `[ARTIFACT] FAILURE_CODES 常量含 9 个 key`。

### R5（PRD 段名 i18n — 中文硬编码假设）
**描述**: `REQUIRED_PRD_SECTIONS = ['目标','User Stories','验收场景','功能需求','成功标准']` 混用中英文。如未来 Planner 改用纯英文段名（"Goals"/"Acceptance Scenarios"），整套 missing_section 全部误报，Initiative B2 之外的 Initiative 无法通过 pre-flight。
**Mitigation**:
- 短期：在 PRD 头部强制要求 `<!-- preflight-lang: zh -->` 标记，validator 据此选段名表；缺标记按 zh 默认。
- 长期（不在本 sprint 范围）：把段名表移到 `packages/brain/config/prd-sections.json`，按语言分组。
- 本 sprint 仅在 WS1 注释里留 `// TODO(R5): 当前仅支持 zh，i18n 见 sprint-prd-followup.md`。

### R6（DAG 算法选型 — 大 DAG 栈溢出）
**描述**: WS1 cycle 检测若用朴素 DFS 递归（`function dfs(node) { for (...) dfs(child) }`），在 task 数 > 1000 的极端 DAG 上栈溢出（V8 默认调用栈 ~10000 帧）。虽然 MAX_TASKS=8 限制了正常路径，但攻击性 fixture 或未来放宽 MAX_TASKS 时会爆炸。
**Mitigation**:
- WS1 实现用迭代式 Kahn 算法（拓扑排序基于入度队列），天然 O(V+E) 不递归。
- 测试新增一条边界：`it('handles 1000-node DAG without stack overflow')`，构造 1000 节点链式依赖，断言不抛 RangeError（即便此场景已超 MAX_TASKS，作为算法韧性测试保留）。

### R7（DB 资源泄漏 — 跨测试数据污染）
**描述**: WS2 的 store 测试与 API 测试共用 `preflight_results` 表。若不在 `beforeEach` 清理，第二个测试会读到第一个测试的写入，导致"按 created_at desc 返回 N 条"断言数错位。
**Mitigation**:
- WS2 测试 `beforeEach(async () => { await db.query('TRUNCATE preflight_results RESTART IDENTITY') })`。
- 每条测试用独立 `initiative_id = randomUUID()`，避免硬编码 'init-1' 跨测试串味。
- 当前 round-1 测试已经这么写（已检查），mitigation 是"保持不要回退"。

### R8（404 vs 200+空数组的语义模糊）
**描述**: API 合同要求 unknown initiative_id 返回 404，known but empty 返回 200+`{records: []}`。但 WS2 不引入 `initiatives` 表 join 校验，store 层仅查 `preflight_results`。如果一个 initiative 从未跑过 pre-flight，store 返回空数组，API 无法区分"不存在"与"存在但无历史"，会一律 200，违反 SC-005。
**Mitigation**:
- WS2 在 `getPreflightHistory` 之外新增 `initiativeExists(id)` 函数，复用 Brain 既有 `initiatives` 表（若不存在则降级为：检查 `preflight_results` 是否曾经为该 id 写过任意一行作为存在性代理）。
- API 层流程：先 `initiativeExists` → 假则 404，真则查历史返回 200。
- 测试 ws2 已含 `it('returns 404 with error body when initiative does not exist')` 与 `it('returns 200 with empty records array for known initiative with no history')`，需 Generator 实现两条分支。

### R9（并发写竞争 — created_at 分辨率不足）
**描述**: SC 要求"1s 内多次写入每次都新增一行（无去重）"，且 API 按 `created_at DESC` 排序。若 PG `created_at` 列用 `timestamp` 默认精度（秒级），同秒内多次写入排序未定义，可能返回顺序与插入顺序不一致，触发 `it('returns records in created_at descending order')` 测试假红。
**Mitigation**:
- migration 247 把 `created_at` 列声明为 `TIMESTAMPTZ DEFAULT clock_timestamp()`（微秒精度，且事务内多次调用不返回相同值）。
- 查询语句用 `ORDER BY created_at DESC, id DESC`，把自增 id 作为 tie-breaker 兜底。
- DoD ws2 可加 `[ARTIFACT] migration 含 clock_timestamp() 默认值` 一条 grep 校验。

---

**Risks Summary**: 9 条注册风险（R1-R9），覆盖 cascade / schema / perf / naming / i18n / algo / db / api-semantics / concurrency 9 个类别，每条均含可执行 Mitigation。Reviewer 阈值 ≥ 7 已超额满足。
