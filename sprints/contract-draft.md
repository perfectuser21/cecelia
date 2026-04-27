# Sprint Contract Draft (Round 1) — Initiative B2 Pre-flight 验证骨架

> **被测对象**: pre-flight 链路产出物（`sprints/sprint-prd.md` + `sprints/task-plan.json`）+ 配套验证器（`sprints/validators/*.mjs`）
> **验证目标**: Planner → Runner → Generator 的契约（PRD 模板、task-plan.json schema、DAG）在合成 Initiative 上端到端跑通；Generator commit-2 必须使 4 个 vitest 行为测试由红转绿
> **PRD 来源**: `sprints/sprint-prd.md`（Planner 已写入）

---

## Feature 1: Sprint PRD 落盘且非空

**行为描述**:
Pre-flight 路径要求 `sprints/sprint-prd.md` 在工作树中真实存在、内容非空、并被 git 追踪。任何下游消费者（Reviewer、Generator、Initiative Runner）只要按约定路径读取，都能拿到合规 PRD。本 Feature 通过 `sprints/validators/prd-presence.mjs` 暴露的 `checkSprintPrdPresence(path)` 把 "PRD 已落盘" 这件事变成可被测试断言的纯函数。

**硬阈值**:
- `sprints/sprint-prd.md` 字节大小 > 0
- `sprints/sprint-prd.md` 总行数 ≥ 50
- `checkSprintPrdPresence('sprints/sprint-prd.md')` 返回 `{ok: true, size: <数字>, lines: <数字>}`，其中 `size > 0` 且 `lines >= 50`
- `checkSprintPrdPresence('sprints/__nonexistent__.md')` 返回 `{ok: false, reason: 'missing'}`，不抛异常

**BEHAVIOR 覆盖**（写入 `tests/ws1/prd-presence.test.ts`）:
- `it('returns ok=true with size and lines for the real sprint PRD')`
- `it('returns ok=false with reason=missing when path does not exist, instead of throwing')`
- `it('returns ok=false with reason=empty when the file exists but is zero bytes')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws1.md`）:
- `sprints/sprint-prd.md` 文件存在
- `sprints/sprint-prd.md` 字节数 > 0
- `sprints/sprint-prd.md` 行数 ≥ 50
- `sprints/validators/prd-presence.mjs` 文件存在且 export `checkSprintPrdPresence`

---

## Feature 2: Sprint PRD 9 段结构合规

**行为描述**:
Sprint PRD 必须严格覆盖 9 个二级标题：`OKR 对齐` / `背景` / `目标` / `User Stories` / `验收场景` / `功能需求` / `成功标准` / `假设` / `边界情况`。每段下至少 1 行非空内容（不计空白行与代码 fence）。任何缺段或空段都会导致 Initiative Runner 把 PRD 判作占位骨架而拒绝入库。`sprints/validators/prd-structure.mjs` 暴露 `validatePrdStructure(content)` 把 9 段合规性变成可断言的纯函数。

**硬阈值**:
- 9 个二级标题全部出现，缺一不可
- 每个二级标题之后到下一个二级标题之前，存在 ≥ 1 行非空内容
- `validatePrdStructure(real_prd_content)` 返回 `{ok: true, sections: 9}`
- `validatePrdStructure('# 单独一级标题\n')` 返回 `{ok: false, missing: <长度=9 的数组>}`
- `validatePrdStructure(prd_with_one_section_empty)` 返回 `{ok: false, emptySections: ['<段名>']}`

**BEHAVIOR 覆盖**（写入 `tests/ws2/prd-structure.test.ts`）:
- `it('returns ok=true with sections=9 for the real Initiative B2 PRD')`
- `it('returns ok=false listing all 9 missing section names when given an empty document')`
- `it('returns ok=false with emptySections naming the offending heading when a section body is whitespace-only')`
- `it('treats sections separated only by code fences as empty')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws2.md`）:
- `sprints/sprint-prd.md` 含 9 个二级标题（精确字面量）
- `sprints/validators/prd-structure.mjs` 文件存在且 export `validatePrdStructure`

---

## Feature 3: task-plan.json schema 合规

**行为描述**:
`sprints/task-plan.json` 必须能被 Initiative Runner 的 `parseTaskPlan` 等价契约解析通过：合法 JSON、`tasks` 数组长度 ∈ {4,5}、每个 task 含 `task_id` / `title` / `scope` / `dod` / `files` / `depends_on` / `complexity` / `estimated_minutes` 八个必填字段、`complexity` ∈ {S,M,L}、`estimated_minutes` ∈ [20,60]、所有 `task_id` 唯一。`sprints/validators/taskplan-schema.mjs` 暴露 `validateTaskPlanSchema(plan)` 实现这一契约的等价检验。

**硬阈值**:
- `tasks.length ∈ {4, 5}`
- 每个 task 必填 8 字段非 null/undefined
- `complexity ∈ {S, M, L}` 严格匹配
- `estimated_minutes ≥ 20 && estimated_minutes ≤ 60`
- 所有 `estimated_minutes` 之和 ∈ [80, 300] 分钟
- `task_id` 全局唯一
- `validateTaskPlanSchema(real_plan)` 返回 `{ok: true, taskCount: 4}`（当前 plan 是 4 task）
- `validateTaskPlanSchema({tasks: []})` 返回 `{ok: false, errors: [...]}` 含 "tasks count" 错误
- `validateTaskPlanSchema(plan_with_complexity_X)` 返回 `{ok: false, errors: [...]}` 含 "complexity" 错误

**BEHAVIOR 覆盖**（写入 `tests/ws3/taskplan-schema.test.ts`）:
- `it('returns ok=true taskCount=4 with sum of estimated_minutes in [80,300] for the real plan')`
- `it('returns ok=false flagging tasks count out of range when plan has 3 tasks')`
- `it('returns ok=false flagging complexity field when a task has complexity=X')`
- `it('returns ok=false flagging estimated_minutes when value is 10 (below floor)')`
- `it('returns ok=false flagging estimated_minutes when value is 75 (above ceiling)')`
- `it('returns ok=false flagging duplicate task_id when two tasks share the same id')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws3.md`）:
- `sprints/task-plan.json` 是合法 JSON（`JSON.parse` 不抛）
- `sprints/task-plan.json` 顶层有 `tasks` 数组
- `sprints/validators/taskplan-schema.mjs` 文件存在且 export `validateTaskPlanSchema`

---

## Feature 4: task-plan.json DAG 拓扑无环且全连通

**行为描述**:
`task-plan.json` 中的 `depends_on` 必须形成合法 DAG：(1) 至少 1 个 task 的 `depends_on` 为空数组（图入口），(2) 不存在 task_id 出现在自身 `depends_on` 中（无自指），(3) `depends_on` 引用的所有 task_id 都在 plan 内（无悬空），(4) 不存在环。`sprints/validators/taskplan-dag.mjs` 暴露 `validateTaskPlanDag(plan)` 把这 4 条规则封装为单一返回值。

**硬阈值**:
- 入口 task 数量 ≥ 1
- 不存在自指
- 不存在悬空依赖
- 不存在环（拓扑排序成功）
- 从入口出发的拓扑遍历能覆盖 100% 的 task（连通性）
- `validateTaskPlanDag(real_plan)` 返回 `{ok: true, entryCount: 1, topoOrder: [<4 个 id>]}`
- `validateTaskPlanDag(plan_with_self_ref)` 返回 `{ok: false, errors: [{type: 'self-reference', task_id: '<id>'}]}`
- `validateTaskPlanDag(plan_with_cycle)` 返回 `{ok: false, errors: [{type: 'cycle', cycle: [...]}]}`
- `validateTaskPlanDag(plan_with_dangling)` 返回 `{ok: false, errors: [{type: 'dangling', task_id: '<from>', missing: '<to>'}]}`
- `validateTaskPlanDag(plan_no_entry)` 返回 `{ok: false, errors: [{type: 'no-entry'}]}`

**BEHAVIOR 覆盖**（写入 `tests/ws4/taskplan-dag.test.ts`）:
- `it('returns ok=true with entryCount=1 and full topoOrder for the real linear plan')`
- `it('detects self-reference when ws1.depends_on includes "ws1"')`
- `it('detects a cycle when ws1→ws2→ws1')`
- `it('detects a dangling reference when ws3.depends_on includes a non-existent id')`
- `it('returns ok=false with no-entry when every task has a non-empty depends_on')`
- `it('topoOrder length equals tasks length, proving the graph is connected from the entry')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws4.md`）:
- `sprints/validators/taskplan-dag.mjs` 文件存在且 export `validateTaskPlanDag`
- `sprints/task-plan.json` 至少有 1 个 task 的 `depends_on` 为 `[]`

---

## Workstreams

workstream_count: 4

### Workstream 1: PRD Presence Validator

**范围**: 在 `sprints/validators/prd-presence.mjs` 实现 `checkSprintPrdPresence(path)`，返回 `{ok, size?, lines?, reason?}` 形态值（不抛异常）。仅依赖 `node:fs`，不引入 npm 包。
**大小**: S（< 100 行实现）
**依赖**: 无（图入口）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/prd-presence.test.ts`

### Workstream 2: PRD Structure Validator

**范围**: 在 `sprints/validators/prd-structure.mjs` 实现 `validatePrdStructure(content)`，按 9 段标题字面量切片并检查每段非空。固定 9 段标题字面量：`OKR 对齐` / `背景` / `目标` / `User Stories` / `验收场景` / `功能需求` / `成功标准` / `假设` / `边界情况`。
**大小**: M（100-200 行实现）
**依赖**: WS1 完成（沿用 `prd-presence` 的相对路径约定）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/prd-structure.test.ts`

### Workstream 3: TaskPlan Schema Validator

**范围**: 在 `sprints/validators/taskplan-schema.mjs` 实现 `validateTaskPlanSchema(plan)`，逐字段校验 8 个必填字段、`complexity` 枚举、`estimated_minutes` 区间、`task_id` 唯一性。返回 `{ok, taskCount?, errors?}`。
**大小**: M（150-250 行实现）
**依赖**: WS2 完成

**BEHAVIOR 覆盖测试文件**: `tests/ws3/taskplan-schema.test.ts`

### Workstream 4: TaskPlan DAG Validator

**范围**: 在 `sprints/validators/taskplan-dag.mjs` 实现 `validateTaskPlanDag(plan)`，包含拓扑排序（Kahn 算法）、自指检测、悬空检测、入口检测、连通性检测。返回 `{ok, entryCount?, topoOrder?, errors?}`。
**大小**: M（200-300 行实现）
**依赖**: WS3 完成

**BEHAVIOR 覆盖测试文件**: `tests/ws4/taskplan-dag.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/prd-presence.test.ts` | ok=true / missing / empty | `npx vitest run sprints/tests/ws1/` → 3 failures（import 失败 → 全员红） |
| WS2 | `tests/ws2/prd-structure.test.ts` | 9 段 ok / 缺段 / 空段 / fence-only | `npx vitest run sprints/tests/ws2/` → 4 failures |
| WS3 | `tests/ws3/taskplan-schema.test.ts` | ok / 数量 / complexity / minutes×2 / 重复 id | `npx vitest run sprints/tests/ws3/` → 6 failures |
| WS4 | `tests/ws4/taskplan-dag.test.ts` | ok / 自指 / 环 / 悬空 / 无入口 / 连通性 | `npx vitest run sprints/tests/ws4/` → 6 failures |

**Red evidence 收集方式**: Proposer 在 commit 前本地执行 `npx vitest run sprints/tests/` 一次，确认 19 个 it 全部 FAIL（因 4 个 validator 模块尚未存在，import 解析失败）。

---

## Out-of-Scope（合同明确不覆盖）

- 真实业务功能实现（packages/brain / packages/engine / apps/* 一字不改）
- 数据库 migration / Brain schema 变更 / CI 配置变更
- Brain Runner 的 `parseTaskPlan` 真实联调（本 sprint 用 sprints/validators/* 等价契约替代）
- task-plan.json 内容修改（task-plan.json 由 Planner 产出，本 sprint 视为只读）
