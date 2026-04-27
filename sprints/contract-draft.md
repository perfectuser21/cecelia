# Sprint Contract Draft (Round 4) — Initiative B2 Pre-flight 验证骨架

> **被测对象**: pre-flight 链路产出物（`sprints/sprint-prd.md` + `sprints/task-plan.json`）+ 配套验证器（`sprints/validators/*.mjs`）
> **验证目标**: Planner → Runner → Generator 的契约（PRD 模板、task-plan.json schema、DAG）在合成 Initiative 上端到端跑通；Generator commit-2 必须使 19 个 vitest 行为测试由红转绿
> **PRD 来源**: `sprints/sprint-prd.md`（Planner 已写入）
> **执行平台**: linux (GNU coreutils only) — 所有 ARTIFACT shell 命令默认 `bash` + GNU `grep/wc/test/find`，不依赖 BSD/macOS coreutils 行为差异
> **路径锚点（唯一来源，全文引用以此为准）**:
> - 测试落点：`sprints/tests/ws{N}/*.test.ts`
> - validator 落点：`sprints/validators/*.mjs`
> - PRD / task-plan：`sprints/sprint-prd.md` / `sprints/task-plan.json`

## Round 4 修订摘要（响应 Reviewer Round 3 反馈）

1. **Risks 段统一登记 + Mitigation Test 机检化**：将 Reviewer 在 ws3 ARTIFACT 反馈的 R1（task-plan.json 回写）、R2（平台 coreutils 差异）、R3（vitest harness 加载失败 cascade）、R4（validator 文件存在但 export 错名）以及合同已隐式覆盖的 4 条额外风险（共 8 条）统一升格到本合同的 `## Risks` 段，每条 risk 都带 `Mitigation Test:` 一行可粘贴 shell 命令，使 Risks 段本身即可被 CI 机检（`risk_registered ≥ 8`）。
2. **R2 mitigation 显式化**：在 `contract-dod-ws1.md` 新增 ARTIFACT 条目 `bash -c '[ "$(uname -s)" = "Linux" ]'`，把"linux GNU coreutils only"假设从合同顶部的人写声明升级为 CI 可机检的 ARTIFACT，BSD/macOS 上跑直接红。
3. **R3 mitigation 升格**：原 ws1 已含"vitest 不报 ParseError"加载性 ARTIFACT，本轮再补一条 `grep -qE "Test Files .* failed"`（强校验"必须出现 failed 计数"），与"加载性"那条互补：前者拒绝任何 parse 错，后者拒绝"全员未注册"假红。两条同时存在于 `contract-dod-ws1.md`。
4. **R4 mitigation 复述**：合同 dod-ws{1..4} 的 export 校验全部已用 `dynamic import + typeof === 'function'`（Round 2 已落），本轮把这一事实在 Risks 段显式标注 `已 mitigated by ARTIFACT-ws{1..4}-export`。

## Round 3 修订摘要（响应 Reviewer Round 2 反馈）

1. **R4 mitigation — task-plan.json 只读保护**：除 Out-of-Scope 已声明「task-plan.json 视为只读」，新增 ARTIFACT 条目（见 `contract-dod-ws3.md`）：`bash -c 'git diff --quiet HEAD -- sprints/task-plan.json'`，commit-2 后若工作树相对 HEAD 有任何 task-plan.json 修改则非 0 退出，CI 直接红，防止 Generator 实现路径意外回写。

2. **平台说明显式化**：在合同顶部 `执行平台` 元数据声明 `linux (GNU coreutils only)`，所有 ARTIFACT 命令（`grep -cE` / `wc -l` / `test -f` / `bash -c`）按 GNU 语义书写；macOS BSD coreutils 不在支持矩阵内（避免 `wc -l` 输出对齐空格、`grep -E` 转义差异等隐性 bug）。

3. **internal_consistency 6 → ≥ 7（路径统一 + stable ID）**：
   - **路径统一**：原 4 处 `tests/ws{N}/...`（Workstream 描述 4 处 + Test Contract 表「Test File」列 4 处）全部 replace_all 为 `sprints/tests/ws{N}/...`，与 Round 2 vitest 命令、Red evidence 命令、`sprints/tests/` 目录实物一致。
   - **路径锚点**：在 Out-of-Scope 上方加「路径锚点」元数据（已在文件顶部声明，全文引用此处），后续合同修订只改锚点不改散落引用。
   - **stable ID**：19 个 it() 名都加 `[ws{N}.t{K}]` 前缀（ws1.t1~t3 / ws2.t1~t4 / ws3.t1~t6 / ws4.t1~t6），Test Contract 表「BEHAVIOR 覆盖」列改为 ID 列表，避免 it 文案漂移导致表格与代码脱钩。

## Round 2 修订摘要（保留作为审计链）

1. **dod_machineability 6 → ≥ 7**：所有 ARTIFACT DoD 的 Test 字段统一改写为可粘贴执行的 shell 单行，**非 0 退出即红，CI 可 `set -e` 串起来一把跑**：
   - 文件存在 → `test -f <path>`
   - 文件非空 → `test -s <path>`
   - 行数阈值 → `bash -c '[ "$(wc -l < <path>)" -ge N ]'`
   - 合法 JSON → `node -e "JSON.parse(require('fs').readFileSync('<path>','utf8'))"`
   - 数组结构 → `node -e "...;process.exit(Array.isArray(p.tasks)?0:1)"`
   - export 验证（运行时强校验，替代 round 1 的 regex 文本匹配）→ `node -e "import('./<path>.mjs').then(m=>process.exit(typeof m.<name>==='function'?0:1)).catch(()=>process.exit(2))"`
   - 二级标题命中 → `grep -cE '^##[[:space:]]+<title>'`（exit 1 当无匹配，exit 0 当 ≥1 匹配）

2. **新增 vitest harness 加载性 ARTIFACT**（见 `contract-dod-ws1.md`）：`bash -c 'npx vitest run sprints/tests/ --reporter=basic > /tmp/vitest-load.log 2>&1 || true; ! grep -qE "SyntaxError|ParseError|Unexpected token|Transform failed" /tmp/vitest-load.log && grep -qE "Test Files|Tests" /tmp/vitest-load.log'`。允许 ERR_MODULE_NOT_FOUND（validators 尚不存在），但拒绝任何 ts/parse 解析错。

3. **export 验证强度提升**：round 1 用 `readFileSync + 正则` 匹配 `export function xxx`，round 2 改为 `dynamic import()` 实际加载 .mjs 并校验 `typeof === 'function'`，能抓出 round 1 抓不到的"文件文本对了但运行时模块解析失败"假实现。

---

## Feature 1: Sprint PRD 落盘且非空

**行为描述**:
Pre-flight 路径要求 `sprints/sprint-prd.md` 在工作树中真实存在、内容非空、并被 git 追踪。任何下游消费者（Reviewer、Generator、Initiative Runner）只要按约定路径读取，都能拿到合规 PRD。本 Feature 通过 `sprints/validators/prd-presence.mjs` 暴露的 `checkSprintPrdPresence(path)` 把 "PRD 已落盘" 这件事变成可被测试断言的纯函数。

**硬阈值**:
- `sprints/sprint-prd.md` 字节大小 > 0
- `sprints/sprint-prd.md` 总行数 ≥ 50
- `checkSprintPrdPresence('sprints/sprint-prd.md')` 返回 `{ok: true, size: <数字>, lines: <数字>}`，其中 `size > 0` 且 `lines >= 50`
- `checkSprintPrdPresence('sprints/__nonexistent__.md')` 返回 `{ok: false, reason: 'missing'}`，不抛异常

**BEHAVIOR 覆盖**（写入 `sprints/tests/ws1/prd-presence.test.ts`）:
- `ws1.t1` `it('[ws1.t1] returns ok=true with size and lines for the real sprint PRD')`
- `ws1.t2` `it('[ws1.t2] returns ok=false with reason=missing when path does not exist, instead of throwing')`
- `ws1.t3` `it('[ws1.t3] returns ok=false with reason=empty when the file exists but is zero bytes')`

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

**BEHAVIOR 覆盖**（写入 `sprints/tests/ws2/prd-structure.test.ts`）:
- `ws2.t1` `it('[ws2.t1] returns ok=true with sections=9 for the real Initiative B2 PRD')`
- `ws2.t2` `it('[ws2.t2] returns ok=false listing all 9 missing section names when given an empty document')`
- `ws2.t3` `it('[ws2.t3] returns ok=false with emptySections naming the offending heading when a section body is whitespace-only')`
- `ws2.t4` `it('[ws2.t4] treats sections separated only by code fences as empty')`

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

**BEHAVIOR 覆盖**（写入 `sprints/tests/ws3/taskplan-schema.test.ts`）:
- `ws3.t1` `it('[ws3.t1] returns ok=true taskCount=4 with sum of estimated_minutes in [80,300] for the real plan')`
- `ws3.t2` `it('[ws3.t2] returns ok=false flagging tasks count out of range when plan has 3 tasks')`
- `ws3.t3` `it('[ws3.t3] returns ok=false flagging complexity field when a task has complexity=X')`
- `ws3.t4` `it('[ws3.t4] returns ok=false flagging estimated_minutes when value is 10 (below floor)')`
- `ws3.t5` `it('[ws3.t5] returns ok=false flagging estimated_minutes when value is 75 (above ceiling)')`
- `ws3.t6` `it('[ws3.t6] returns ok=false flagging duplicate task_id when two tasks share the same id')`

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

**BEHAVIOR 覆盖**（写入 `sprints/tests/ws4/taskplan-dag.test.ts`）:
- `ws4.t1` `it('[ws4.t1] returns ok=true with entryCount=1 and full topoOrder for the real linear plan')`
- `ws4.t2` `it('[ws4.t2] detects self-reference when ws1.depends_on includes "ws1"')`
- `ws4.t3` `it('[ws4.t3] detects a cycle when ws1->ws2->ws1')`
- `ws4.t4` `it('[ws4.t4] detects a dangling reference when ws3.depends_on includes a non-existent id')`
- `ws4.t5` `it('[ws4.t5] returns ok=false with no-entry when every task has a non-empty depends_on')`
- `ws4.t6` `it('[ws4.t6] topoOrder length equals tasks length, proving the graph is connected from the entry')`

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

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/prd-presence.test.ts`

### Workstream 2: PRD Structure Validator

**范围**: 在 `sprints/validators/prd-structure.mjs` 实现 `validatePrdStructure(content)`，按 9 段标题字面量切片并检查每段非空。固定 9 段标题字面量：`OKR 对齐` / `背景` / `目标` / `User Stories` / `验收场景` / `功能需求` / `成功标准` / `假设` / `边界情况`。
**大小**: M（100-200 行实现）
**依赖**: WS1 完成（沿用 `prd-presence` 的相对路径约定）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/prd-structure.test.ts`

### Workstream 3: TaskPlan Schema Validator

**范围**: 在 `sprints/validators/taskplan-schema.mjs` 实现 `validateTaskPlanSchema(plan)`，逐字段校验 8 个必填字段、`complexity` 枚举、`estimated_minutes` 区间、`task_id` 唯一性。返回 `{ok, taskCount?, errors?}`。
**大小**: M（150-250 行实现）
**依赖**: WS2 完成

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws3/taskplan-schema.test.ts`

### Workstream 4: TaskPlan DAG Validator

**范围**: 在 `sprints/validators/taskplan-dag.mjs` 实现 `validateTaskPlanDag(plan)`，包含拓扑排序（Kahn 算法）、自指检测、悬空检测、入口检测、连通性检测。返回 `{ok, entryCount?, topoOrder?, errors?}`。
**大小**: M（200-300 行实现）
**依赖**: WS3 完成

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws4/taskplan-dag.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it ID 列表） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/prd-presence.test.ts` | `ws1.t1`, `ws1.t2`, `ws1.t3` | `npx vitest run sprints/tests/ws1/` → 3 failures（import 失败 → 全员红） |
| WS2 | `sprints/tests/ws2/prd-structure.test.ts` | `ws2.t1`, `ws2.t2`, `ws2.t3`, `ws2.t4` | `npx vitest run sprints/tests/ws2/` → 4 failures |
| WS3 | `sprints/tests/ws3/taskplan-schema.test.ts` | `ws3.t1`, `ws3.t2`, `ws3.t3`, `ws3.t4`, `ws3.t5`, `ws3.t6` | `npx vitest run sprints/tests/ws3/` → 6 failures |
| WS4 | `sprints/tests/ws4/taskplan-dag.test.ts` | `ws4.t1`, `ws4.t2`, `ws4.t3`, `ws4.t4`, `ws4.t5`, `ws4.t6` | `npx vitest run sprints/tests/ws4/` → 6 failures |

**Red evidence 收集方式**: Proposer 在 commit 前本地执行 `npx vitest run sprints/tests/` 一次，确认 19 个 it 全部 FAIL（因 4 个 validator 模块尚未存在，import 解析失败）。

---

## 路径锚点（Out-of-Scope 之上的最终复述）

- **测试落点**：`sprints/tests/ws{N}/*.test.ts` —— 所有 19 个 it 唯一住址
- **validator 落点**：`sprints/validators/*.mjs` —— 4 个 ESM 模块唯一住址
- **PRD / task-plan**：`sprints/sprint-prd.md` / `sprints/task-plan.json` —— Planner 输出，commit-2 不得修改（见 ws3 的 git-diff ARTIFACT）

后续合同任何引用都以本节为唯一来源；散落在 Feature / Workstream / Test Contract 段中的路径必须与此一致。

## Risks（统一登记，机检化）

> **机检约定**：每条 risk 的 `Mitigation Test:` 行均为可粘贴 shell 单行，非 0 退出 = 该 mitigation 失效。Reviewer / CI 直接逐条粘贴执行即可。

- **R1 task-plan.json 在 commit-2 被 Generator 误回写**
  触发：Generator 实现路径写到 `validateTaskPlanSchema` 时顺手"补字段"修改 task-plan.json，使 schema 测试假绿。
  Mitigation：Out-of-Scope 已声明 task-plan.json 只读；ws3 已落 ARTIFACT `git diff --quiet HEAD -- sprints/task-plan.json`（已 mitigated by ARTIFACT-ws3-readonly）。
  Mitigation Test: bash -c 'git diff --quiet HEAD -- sprints/task-plan.json'

- **R2 平台 coreutils 差异（macOS/BSD vs GNU）**
  触发：macOS BSD `wc -l` 输出含前导空格、`grep -E` 转义不同导致 ARTIFACT 命令在非 Linux 平台上行为偏离。
  Mitigation：合同顶部已声明 linux GNU only；CI runner 锁 ubuntu-latest；ws1 新增 ARTIFACT `[ "$(uname -s)" = "Linux" ]` 把假设升级为机检（已 mitigated by ARTIFACT-ws1-uname）。
  Mitigation Test: bash -c '[ "$(uname -s)" = "Linux" ]'

- **R3 vitest harness 加载失败 cascade（"全员未注册"伪装"全员红"）**
  触发：任一 .test.ts 文件含 SyntaxError / 引用错路径 / TS transform 失败，导致 19 个 it() 全员未注册而非"全员红"，Red evidence 被伪造。
  Mitigation：ws1 同时落两条 ARTIFACT：(a) 拒绝 ParseError / SyntaxError / Unexpected token / Transform failed；(b) 必须出现 `Test Files .* failed` 计数（已 mitigated by ARTIFACT-ws1-vitest-load + ARTIFACT-ws1-vitest-failed）。
  Mitigation Test: bash -c 'npx vitest run sprints/tests/ --reporter=basic 2>&1 | grep -qE "Test Files .* failed"'

- **R4 validator 文件存在但 export 错名（`export default` vs named export）**
  触发：Generator 用 `export default function checkSprintPrdPresence(){...}` 替代 named export，文本 grep 能过但 `import { checkSprintPrdPresence }` 运行时为 undefined。
  Mitigation：ws1/ws2/ws3/ws4 全部用 `dynamic import + typeof === 'function'` 实运行时校验，已不靠正则文本匹配（已 mitigated by ARTIFACT-ws1-export / ARTIFACT-ws2-export / ARTIFACT-ws3-export / ARTIFACT-ws4-export）。
  Mitigation Test: node -e "import('./sprints/validators/prd-presence.mjs').then(m=>process.exit(typeof m.checkSprintPrdPresence==='function'?0:1)).catch(()=>process.exit(2))"

- **R5 sprint-prd.md 在 commit-2 被 Generator 误覆盖**
  触发：Generator 把 PRD 当作"占位文档"覆写或截断，使 ws1/ws2 的"行数 ≥ 50 + 9 段标题"等 ARTIFACT 失真但仍假绿。
  Mitigation：ws1 ARTIFACT `[ "$(wc -l < sprints/sprint-prd.md)" -ge 50 ]` + ws2 9 段标题精确字面量 `grep -cE`；任一段被覆写都会非 0 退出（已 mitigated by ARTIFACT-ws1-lines + ARTIFACT-ws2-headings × 9）。
  Mitigation Test: bash -c '[ "$(wc -l < sprints/sprint-prd.md)" -ge 50 ] && grep -cE "^##[[:space:]]+OKR 对齐[[:space:]]*$" sprints/sprint-prd.md'

- **R6 测试文件被 commit-1 → commit-2 之间偷偷修改（弱化断言）**
  触发：Generator 为了让红转绿，把 `expect(x).toBe(3)` 改成 `expect(x).toBeTruthy()` 或注释掉 it 块。
  Mitigation：Generator skill 已在 CONTRACT IS LAW 约束下"测试文件原样复制 commit-1 后不得修改"，CI 强校验 `git diff commit1..commit2 -- sprints/tests/` 为空。本合同的 19 个 stable ID（ws{N}.t{K}）也使 reviewer 能逐 ID 比对（已 mitigated by Generator skill 的 commit-1 immutability + stable ID 表）。
  Mitigation Test: bash -c '[ "$(grep -hcE "\[ws[1-4]\.t[1-9]+\]" sprints/tests/ws*/*.test.ts | awk "{s+=\$1} END {print s+0}")" -ge 19 ]'

- **R7 task-plan schema 字段名漂移（snake_case ↔ camelCase）**
  触发：Generator 在 validator 里期望 `estimatedMinutes` 但 task-plan.json 里是 `estimated_minutes`，导致 schema 校验跑空表（绕过断言）。
  Mitigation：ws3 ARTIFACT 直接读 `task-plan.json` 用字面量 `estimated_minutes` 校验数值区间，validator 必须以同名字段为准（已 mitigated by ARTIFACT-ws3-fields × 2 + ARTIFACT-ws3-em-range）。
  Mitigation Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(p.tasks.every(t=>typeof t.estimated_minutes==='number'&&t.estimated_minutes>=20&&t.estimated_minutes<=60)?0:1)"

- **R8 task-plan DAG 拓扑被环或悬空污染（pre-flight 假绿）**
  触发：手写 task-plan.json 时 `depends_on` 引用了拼错的 task_id 或形成环，但 validator 容错放过。
  Mitigation：ws4 落 4 条 ARTIFACT（入口存在 / 无自指 / 无悬空 / 拓扑成功）+ Kahn 拓扑 inline 实现，绕开 validator 自身的 bug（已 mitigated by ARTIFACT-ws4-entry + ARTIFACT-ws4-self + ARTIFACT-ws4-dangling + ARTIFACT-ws4-topo）。
  Mitigation Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const indeg=new Map();const g=new Map();for(const t of p.tasks){indeg.set(t.task_id,0);g.set(t.task_id,[])}for(const t of p.tasks){for(const d of(t.depends_on||[])){g.get(d).push(t.task_id);indeg.set(t.task_id,indeg.get(t.task_id)+1)}}const q=[...indeg].filter(([,n])=>n===0).map(([k])=>k);let v=0;while(q.length){const u=q.shift();v++;for(const w of g.get(u)){indeg.set(w,indeg.get(w)-1);if(indeg.get(w)===0)q.push(w)}}process.exit(v===p.tasks.length?0:1)"

**risk_registered = 8**（R1..R8，均带可机检 Mitigation Test 单行）

---

## Out-of-Scope（合同明确不覆盖）

- 真实业务功能实现（packages/brain / packages/engine / apps/* 一字不改）
- 数据库 migration / Brain schema 变更 / CI 配置变更
- Brain Runner 的 `parseTaskPlan` 真实联调（本 sprint 用 sprints/validators/* 等价契约替代）
- **task-plan.json 内容修改**（task-plan.json 由 Planner 产出，本 sprint 视为**只读**；commit-2 后由 `git diff --quiet HEAD -- sprints/task-plan.json` 守门，详见 `contract-dod-ws3.md` 的对应 ARTIFACT）
