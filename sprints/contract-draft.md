# Sprint Contract Draft (Round 1)

**Initiative**: B1 基线产物建立
**Planner Branch**: `cp-04271301-ws-3bf39970`
**Source PRD**: `sprints/sprint-prd.md`

> 本 Initiative 是"流水线烟囱测试"性质：唯一交付物是一份结构合法的 `task-plan.json`（PRD 已在分支上就位）。
> 因此合同验收的"行为"是这份 JSON 文件被解析与校验时呈现出来的运行时性质——文件本身就是被测对象，没有额外业务代码。

---

## Feature 1: task-plan.json 基线产物落盘

**行为描述**:
Initiative B1 完成后，仓库 `sprints/task-plan.json` 应当存在，能被任何 JSON 解析器一次解析成功，并满足 Brain Initiative Runner `parseTaskPlan` 期望的最小数据契约——`tasks` 为 4 元素数组，每个元素含 `id / scope / files / dod / depends_on / complexity / estimated_minutes` 全字段，`depends_on` 显式存在（即便为空数组）。

**硬阈值**:
- 顶层有 `tasks` 字段，类型为数组
- `tasks.length === 4`
- 每个 task 的 `id` 为非空字符串且全局唯一
- 每个 task 的 `estimated_minutes` 为整数，∈ [20, 60]
- 每个 task 的 `files` 为字符串数组，长度 ≥ 1
- 每个 task 的 `dod` 为字符串数组，长度 ≥ 1
- 每个 task 的 `scope` 为非空字符串
- 每个 task 的 `complexity` ∈ {"S", "M", "L"}
- 每个 task 的 `depends_on` 字段显式存在，类型为数组（可空）

**BEHAVIOR 覆盖**（落地到 `tests/ws1/task-plan.test.ts`）:
- `it('parses sprints/task-plan.json without JSON syntax error')`
- `it('contains exactly 4 tasks at top-level tasks array')`
- `it('every task has all required fields: id, scope, files, dod, depends_on, complexity, estimated_minutes')`
- `it('every task estimated_minutes is integer between 20 and 60 inclusive')`
- `it('every task files array has at least one entry')`
- `it('every task dod array has at least one entry')`
- `it('every task has explicit depends_on array even when empty')`
- `it('every task id is unique across the plan')`

**ARTIFACT 覆盖**（落地到 `contract-dod-ws1.md`）:
- `sprints/task-plan.json` 文件存在
- 文件大小 > 100 字节（防 stub）
- 文件首字符为 `{`、末字符为 `}`（最小 JSON 形态）
- `sprints/sprint-prd.md` 文件存在
- `sprints/sprint-prd.md` 字数 ≥ 800（满足 PRD pre-flight）

---

## Feature 2: task-plan.json DAG 合法性

**行为描述**:
`task-plan.json` 中的 `tasks[].depends_on` 整体构成一个 DAG。下游 Generator 会拓扑遍历该 DAG，因此 DAG 必须无环、无自指、无悬挂引用——`depends_on` 中的每一个 id 都必须能在 `tasks[].id` 集合中找到。

**硬阈值**:
- 不存在任何 task 满足 `task.depends_on.includes(task.id)`（无自指）
- 对所有 task，`depends_on` 中出现的 id 均在 `tasks[].id` 集合内（无悬挂引用）
- 整个图能完成 Kahn 拓扑排序，排序结果长度 === 4（无环）

**BEHAVIOR 覆盖**（落地到 `tests/ws1/task-plan.test.ts`）:
- `it('no task depends on itself')`
- `it('every depends_on id refers to a known task id')`
- `it('DAG is acyclic via Kahn topological sort')`

**ARTIFACT 覆盖**:
（无独立 artifact，DAG 性质是运行时行为，全部走 BEHAVIOR）

---

## Feature 3: task-plan.json DoD 含可机械校验的行为条目

**行为描述**:
为下游 Evaluator 提供"机械跑命令判断 PASS/FAIL"的入口，每个 task 的 `dod` 数组中至少有 1 条以 `[BEHAVIOR]` 前缀开头的条目。Evaluator 扫描该前缀作为入口锚点。

**硬阈值**:
- 对每个 task，`dod.some(d => d.trim().startsWith('[BEHAVIOR]')) === true`

**BEHAVIOR 覆盖**（落地到 `tests/ws1/task-plan.test.ts`）:
- `it('every task has at least one DoD entry prefixed with [BEHAVIOR]')`

**ARTIFACT 覆盖**:
（无独立 artifact）

---

## Workstreams

workstream_count: 1

### Workstream 1: 落盘 task-plan.json 基线 DAG

**范围**:
在 `sprints/` 目录新建 `task-plan.json`，包含 4 个 Task 的 DAG，覆盖 PRD 中 FR-001 ~ FR-005 全部要求；本 workstream 不动 `sprints/sprint-prd.md`（PRD 已就位），仅校验其字数阈值满足。

**大小**: S（仅一份 JSON 文件，<100 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/task-plan.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 it 数 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/task-plan.test.ts` | parses without syntax error / 4 tasks / required fields / minutes ∈ [20,60] / files ≥1 / dod ≥1 / depends_on explicit / id unique / no self-dep / no dangling dep / DAG acyclic / [BEHAVIOR] DoD（共 12 条） | `cd packages/engine && npx vitest run ../../sprints/tests/ws1/` → 12 failures（task-plan.json 文件不存在导致 readFileSync 抛 ENOENT，每条 it 均 fail） |

---

## 备注

本 Initiative 没有"业务代码"被测对象——`task-plan.json` 既是产物也是被测对象。所有 BEHAVIOR 测试都直接 `readFileSync('sprints/task-plan.json')` 后 `JSON.parse` 再断言其结构与运行时性质。Generator 阶段的"实现"动作就是产出这份 JSON 文件，让 Red 翻 Green。
