# Sprint Contract Draft (Round 2)

**Initiative**: B1 基线产物建立
**Planner Branch**: `cp-04271301-ws-3bf39970`
**Source PRD**: `sprints/sprint-prd.md`

> 本 Initiative 是"流水线烟囱测试"性质：唯一交付物是一份结构合法的 `task-plan.json`（PRD 已在分支上就位）。
> 因此合同验收的"行为"是这份 JSON 文件被解析与校验时呈现出来的运行时性质——文件本身就是被测对象，没有额外业务代码。

---

## Round 2 修订说明（处理上轮 Reviewer 反馈）

| 反馈 | 处理 | 说明 |
|---|---|---|
| (1) ARTIFACT 改读 `packages/brain/src/preflight.js` 的 `MIN_PRD_CHARS` 动态比较 | **拒绝并替换方案** | Reviewer 假设的事实不成立：(a) 实际文件名为 `pre-flight-check.js` 而非 `preflight.js`；(b) 该文件**未导出 `MIN_PRD_CHARS` 常量**——其描述长度门槛是硬编码 `< 20`（见 `pre-flight-check.js:63`）；(c) 任务类型 `harness_initiative` 属于 `SYSTEM_TASK_TYPES`（`pre-flight-check.js:32-41`），pre-flight 直接跳过描述长度校验。因此 800 字阈值并非由 brain pre-flight 强制，而是由 **PRD 自身的 SC-004**（`sprint-prd.md:57`）锚定。修订方案：保留硬编码 800，但在 ARTIFACT 条目里**显式标注阈值来源 = `sprint-prd.md` SC-004**，并把 SC-004 行号作为 grep 锚点写进 Test 字段——这样阈值若被 PRD 改写，只需同步 SC-004 那一行，合同不会"过期"。 |
| (2) ARTIFACT Test 段每条改写为可直接 `bash -c` 执行的 one-liner | **接受** | 全部条目改为单行 shell 命令；合并冗余条目（首字符 `{`/末字符 `}` 合并为一条形态校验）；新增"形态二段校验"（`JSON.parse` 不抛 + 顶层有 `tasks` 字段）让 ARTIFACT 段不只看文件存在，还看最小语法合法性。 |
| (3) Feature 1/2/3 段统一测试文件路径为含 `sprints/` 前缀的形态 | **接受** | Round 1 中 Feature 1/2/3 的"BEHAVIOR 覆盖（落地到 `tests/ws1/...`）"行漏了 `sprints/` 前缀，本轮统一为 `sprints/tests/ws1/task-plan.test.ts`，与 `## Workstreams` 段、`## Test Contract` 表、Generator 实跑命令一致。 |

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

**BEHAVIOR 覆盖**（落地到 `sprints/tests/ws1/task-plan.test.ts`）:
- `it('parses sprints/task-plan.json without JSON syntax error')`
- `it('contains exactly 4 tasks at top-level tasks array')`
- `it('every task has all required fields: id, scope, files, dod, depends_on, complexity, estimated_minutes')`
- `it('every task estimated_minutes is integer between 20 and 60 inclusive')`
- `it('every task files array has at least one entry')`
- `it('every task dod array has at least one entry')`
- `it('every task has explicit depends_on array even when empty')`
- `it('every task id is unique across the plan')`

**ARTIFACT 覆盖**（落地到 `sprints/contract-dod-ws1.md`）:
- `sprints/task-plan.json` 文件存在
- `sprints/task-plan.json` 文件大小 > 100 字节（防 stub）
- `sprints/task-plan.json` 形态合法（首字符 `{` + 末字符 `}` + `JSON.parse` 不抛 + 顶层含 `tasks` 字段）
- `sprints/sprint-prd.md` 文件存在
- `sprints/sprint-prd.md` 字数 ≥ 800（阈值锚点 = `sprint-prd.md` SC-004 行）
- `sprints/sprint-prd.md` 含 9 大段中的关键标题（## 范围限定 / ## 假设 / ## 成功标准）

---

## Feature 2: task-plan.json DAG 合法性

**行为描述**:
`task-plan.json` 中的 `tasks[].depends_on` 整体构成一个 DAG。下游 Generator 会拓扑遍历该 DAG，因此 DAG 必须无环、无自指、无悬挂引用——`depends_on` 中的每一个 id 都必须能在 `tasks[].id` 集合中找到。

**硬阈值**:
- 不存在任何 task 满足 `task.depends_on.includes(task.id)`（无自指）
- 对所有 task，`depends_on` 中出现的 id 均在 `tasks[].id` 集合内（无悬挂引用）
- 整个图能完成 Kahn 拓扑排序，排序结果长度 === 4（无环）

**BEHAVIOR 覆盖**（落地到 `sprints/tests/ws1/task-plan.test.ts`）:
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

**BEHAVIOR 覆盖**（落地到 `sprints/tests/ws1/task-plan.test.ts`）:
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
| WS1 | `sprints/tests/ws1/task-plan.test.ts` | parses without syntax error / 4 tasks / required fields / minutes ∈ [20,60] / files ≥1 / dod ≥1 / depends_on explicit / id unique / no self-dep / no dangling dep / DAG acyclic / [BEHAVIOR] DoD（共 12 条） | Round 2 本地实跑（vitest 3.2.4，复制至 `packages/engine/tests/_temp-task-plan.test.ts` 跑通）：12 个 it 全部 FAIL，原因均为 `task-plan.json not found`（根本 Red 锚点：实现产物不存在）。Generator 实跑命令：`cp sprints/tests/ws1/task-plan.test.ts packages/engine/tests/_temp-task-plan.test.ts && (cd packages/engine && ./node_modules/.bin/vitest run tests/_temp-task-plan.test.ts)` |

> **测试 root 注**：`sprints/tests/vitest.config.ts` 配的是从仓库根 root 跑，但仓库根 `node_modules` 中无 `vitest`；vitest 实际可执行入口在 `packages/engine/node_modules/.bin/vitest`，且其 `vitest.config.ts` 的 include 列表写死。本轮跑红证据采用"临时复制到 engine tests/ 跑"的方案——`task-plan.test.ts` 内 `TASK_PLAN_PATH` 用 `import.meta.url + '../../task-plan.json'` 解析路径，从 `sprints/tests/ws1/` 解析得 `sprints/task-plan.json`（合同期望路径）；从 `packages/engine/tests/` 解析则得 `packages/task-plan.json`（不存在，仍然 fail，红证据有效）。Generator 阶段会按合同把测试文件留在原位 `sprints/tests/ws1/`，并在该相对路径下产出 `sprints/task-plan.json` 翻 Green。

---

## 备注

本 Initiative 没有"业务代码"被测对象——`task-plan.json` 既是产物也是被测对象。所有 BEHAVIOR 测试都直接 `readFileSync('sprints/task-plan.json')` 后 `JSON.parse` 再断言其结构与运行时性质。Generator 阶段的"实现"动作就是产出这份 JSON 文件，让 Red 翻 Green。
