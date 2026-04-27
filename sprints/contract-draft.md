# Sprint Contract Draft (Round 3)

**Initiative**: B1 基线产物建立
**Planner Branch**: `cp-04271301-ws-3bf39970`
**Source PRD**: `sprints/sprint-prd.md`

> 本 Initiative 是"流水线烟囱测试"性质：唯一交付物是一份结构合法的 `task-plan.json`（PRD 已在分支上就位）。
> 因此合同验收的"行为"是这份 JSON 文件被解析与校验时呈现出来的运行时性质——文件本身就是被测对象，没有额外业务代码。

---

## Round 3 修订说明（处理 Round 2 Reviewer 反馈）

| 反馈编号 | 反馈摘要 | 处理 | 落地位置 |
|---|---|---|---|
| **R2** | Generator 在产出 task-plan.json 同时需明确 vitest runner 入口（声明 devDep 或在合同里写死命令） | **接受** | 新增 `sprints/tests/package.json` 显式声明 vitest devDep；本合同 ## Test Contract 段写死 `pnpm --filter ./sprints/tests vitest run ws1` 为唯一合法 runner 入口；同时保留"复制至 engine tests/ 跑"作为无依赖回退路径。 |
| **R3** | SC-004 字数阈值锚点 = `sprint-prd.md` 自身行号，存在自指风险（PR 重排 PRD 行序时 grep 锚点会漂） | **接受** | 所有针对 PRD 的 ARTIFACT Test 字段全面切换到 `grep -cF "<literal>"`（fixed-string，稳定字符串锚点，不依赖行号）；并在本合同 ## Risks 段登记"PRD 重排序需同步本合同"作为级联失败对策。 |
| **补充建议** | 把 Feature 1 ARTIFACT 6 条直接粘出 bash one-liner 字符串（与 Round 2 修订说明 (2) 的承诺对齐，加 dod_machineability 边界分） | **接受** | 见下方 Feature 1 ARTIFACT 段——每条 ARTIFACT 已 inline 一行 shell 字符串，可直接 `bash -c '<line>'` 执行；与 `contract-dod-ws1.md` 中对应 Test 字段 1:1 对齐。 |

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

**ARTIFACT 覆盖**（落地到 `sprints/contract-dod-ws1.md`，每条直接给出可执行 bash one-liner）:

1. `sprints/task-plan.json` 文件存在
   ```bash
   test -f sprints/task-plan.json
   ```
2. `sprints/task-plan.json` 文件大小 > 100 字节（防 stub）
   ```bash
   test $(wc -c < sprints/task-plan.json) -gt 100
   ```
3. `sprints/task-plan.json` 形态合法（首字符 `{` + 末字符 `}`）
   ```bash
   node -e "const s=require('fs').readFileSync('sprints/task-plan.json','utf8').trim();process.exit(s[0]==='{'&&s.slice(-1)==='}'?0:1)"
   ```
4. `sprints/task-plan.json` 可被 `JSON.parse` 且顶层含数组字段 `tasks`
   ```bash
   node -e "const o=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(Array.isArray(o.tasks)?0:1)"
   ```
5. `sprints/sprint-prd.md` 文件存在
   ```bash
   test -f sprints/sprint-prd.md
   ```
6. `sprints/sprint-prd.md` 字数（去空白后）≥ 800
   ```bash
   node -e "process.exit(require('fs').readFileSync('sprints/sprint-prd.md','utf8').replace(/\s/g,'').length>=800?0:1)"
   ```
7. `sprints/sprint-prd.md` 显式声明 SC-004（稳定字符串锚点 `grep -cF`，防 PR 偷偷改阈值或删段）
   ```bash
   test $(grep -cF "SC-004" sprints/sprint-prd.md) -ge 1
   ```
8. `sprints/sprint-prd.md` 含关键大段标题（稳定字符串锚点，不依赖行号）
   ```bash
   test $(grep -cF "## 范围限定" sprints/sprint-prd.md) -ge 1 && \
   test $(grep -cF "## 假设" sprints/sprint-prd.md) -ge 1 && \
   test $(grep -cF "## 成功标准" sprints/sprint-prd.md) -ge 1
   ```

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
| WS1 | `sprints/tests/ws1/task-plan.test.ts` | parses without syntax error / 4 tasks / required fields / minutes ∈ [20,60] / files ≥1 / dod ≥1 / depends_on explicit / id unique / no self-dep / no dangling dep / DAG acyclic / [BEHAVIOR] DoD（共 12 条） | Round 3 本地实跑（vitest 3.2.4 via engine workspace）：12 个 it 全部 FAIL，原因均为 `task-plan.json not found`（根本 Red 锚点：实现产物不存在）。 |

### 合法 runner 入口（Round 3 修订 R2）

唯一合法的 vitest 运行命令（按优先级）：

**1. 推荐：通过 sprints/tests 自身的 workspace（本轮新增 `sprints/tests/package.json`）**
```bash
pnpm --filter ./sprints/tests install   # 一次性安装 vitest devDep
pnpm --filter ./sprints/tests vitest run ws1
```

**2. 回退：复制到 engine tests/ 借用已有 vitest（不新增依赖）**
```bash
cp sprints/tests/ws1/task-plan.test.ts packages/engine/tests/_temp-task-plan.test.ts && \
  (cd packages/engine && ./node_modules/.bin/vitest run tests/_temp-task-plan.test.ts) ; \
  rm -f packages/engine/tests/_temp-task-plan.test.ts
```

任一方式在 Red 阶段（`sprints/task-plan.json` 缺失）都应当 12 个 it 全部 FAIL；在 Green 阶段（Generator 落盘 task-plan.json 后）应当 12 个 it 全 PASS。**禁止**直接在仓库根 `vitest run`（仓库根 `node_modules` 中无 vitest，会报 command not found）。

---

## Risks（Round 3 修订 R3 登记）

| 风险 | 触发条件 | 级联失败对策 |
|---|---|---|
| **PRD 重排序使本合同 ARTIFACT 锚点失效** | 后续 PR 修改 `sprints/sprint-prd.md` 时删除/改写以下任一字面字符串：`SC-004` / `## 范围限定` / `## 假设` / `## 成功标准` | 本合同 ARTIFACT 全部使用 `grep -cF "<literal>"` 稳定字符串锚点。锚点字符串若被改写，对应 ARTIFACT Test 立即返回 0 行匹配 → exit 1 → CI fail，提示主理人/Reviewer 同步本合同。**不依赖行号**——重排序顺序但保留字符串本身时合同仍然 PASS。 |
| **PRD 字数 SC-004 阈值被悄悄改写** | 后续 PR 把 800 改成更小数字（如 200） | ARTIFACT 7 仍只校验"`SC-004` 字符串存在"——这是有意的最小握手；"800"硬编码在 ARTIFACT 6 的 node 表达式里，PR 想改阈值必须同时改 PRD SC-004 和合同 ARTIFACT 6，二者一致才能过审。 |
| **vitest runner 入口偏移** | 主理人/Reviewer 不知道唯一合法 runner，跑了仓库根 `vitest` 报 command not found，误判 test 写错 | 见 ## Test Contract 段写死的两条命令；同时本轮新增 `sprints/tests/package.json` 把 vitest devDep 显式化到该子目录，pnpm workspace 自动识别。 |

---

## 备注

本 Initiative 没有"业务代码"被测对象——`task-plan.json` 既是产物也是被测对象。所有 BEHAVIOR 测试都直接 `readFileSync('sprints/task-plan.json')` 后 `JSON.parse` 再断言其结构与运行时性质。Generator 阶段的"实现"动作就是产出这份 JSON 文件，让 Red 翻 Green。
