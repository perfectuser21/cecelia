# Contract DoD — Workstream 1: 落盘 task-plan.json 基线 DAG

**范围**: 在 `sprints/` 目录新建 `task-plan.json`，覆盖 PRD 中 FR-001 ~ FR-005，DAG 满足 SC-001 ~ SC-004。本 workstream 不动 `sprint-prd.md`，仅校验其字数阈值。
**大小**: S
**依赖**: 无

> **机械可执行约定**：本段所有 Test 字段都是单行 shell 命令，可直接被包进 `bash -c '...'` 执行；exit 0 = PASS，非 0 = FAIL。Evaluator/CI 不需要解读语义。
> **锚点稳定性约定（Round 3 修订 R3）**：所有针对 `sprints/sprint-prd.md` 的内容校验**只用稳定字符串锚点**（`grep -cF "<literal>"`），不依赖行号、不依赖正则元字符。这样后续 PR 即便重排 PRD 段落顺序，本合同的 Test 字段也无需同步修改。重排导致字符串本身被删/改写时，CI 会立刻 fail（这是期望行为，作为级联失败保险——见 `contract-draft.md` ## Risks）。

## ARTIFACT 条目

- [ ] [ARTIFACT] sprints/task-plan.json 文件存在
  Test: test -f sprints/task-plan.json

- [ ] [ARTIFACT] sprints/task-plan.json 文件大小大于 100 字节（防 stub）
  Test: test $(wc -c < sprints/task-plan.json) -gt 100

- [ ] [ARTIFACT] sprints/task-plan.json 形态合法（首字符 '{' + 末字符 '}'）
  Test: node -e "const s=require('fs').readFileSync('sprints/task-plan.json','utf8').trim();process.exit(s[0]==='{'&&s.slice(-1)==='}'?0:1)"

- [ ] [ARTIFACT] sprints/task-plan.json 可被 JSON.parse 且顶层有数组字段 `tasks`
  Test: node -e "const o=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(Array.isArray(o.tasks)?0:1)"

- [ ] [ARTIFACT] sprints/sprint-prd.md 文件存在
  Test: test -f sprints/sprint-prd.md

- [ ] [ARTIFACT] sprints/sprint-prd.md 字数（去除空白后字符数）≥ 800（阈值由 PRD 自身 SC-004 锚定，本 Test 不依赖行号）
  Test: node -e "process.exit(require('fs').readFileSync('sprints/sprint-prd.md','utf8').replace(/\s/g,'').length>=800?0:1)"

- [ ] [ARTIFACT] sprints/sprint-prd.md 显式声明 SC-004 字数阈值（稳定字符串锚点 `SC-004`，防 PRD 偷偷改阈值或删除该 SC 导致合同与 PRD 错位）
  Test: test $(grep -cF "SC-004" sprints/sprint-prd.md) -ge 1

- [ ] [ARTIFACT] sprints/sprint-prd.md 含关键大段标题：## 范围限定（稳定字符串锚点，不依赖行号）
  Test: test $(grep -cF "## 范围限定" sprints/sprint-prd.md) -ge 1

- [ ] [ARTIFACT] sprints/sprint-prd.md 含关键大段标题：## 假设（稳定字符串锚点，不依赖行号）
  Test: test $(grep -cF "## 假设" sprints/sprint-prd.md) -ge 1

- [ ] [ARTIFACT] sprints/sprint-prd.md 含关键大段标题：## 成功标准（稳定字符串锚点，不依赖行号）
  Test: test $(grep -cF "## 成功标准" sprints/sprint-prd.md) -ge 1

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/task-plan.test.ts`，覆盖以下运行时行为：
- parses sprints/task-plan.json without JSON syntax error
- contains exactly 4 tasks at top-level tasks array
- every task has all required fields: id, scope, files, dod, depends_on, complexity, estimated_minutes
- every task estimated_minutes is integer between 20 and 60 inclusive
- every task files array has at least one entry
- every task dod array has at least one entry
- every task has explicit depends_on array even when empty
- every task id is unique across the plan
- no task depends on itself
- every depends_on id refers to a known task id
- DAG is acyclic via Kahn topological sort
- every task has at least one DoD entry prefixed with [BEHAVIOR]

**合法 runner 入口（Round 3 修订 R2）**：本目录测试由 `sprints/tests/package.json` 声明 vitest devDependency，唯一合法运行命令为：
```
pnpm --filter ./sprints/tests vitest run ws1
```
或使用 engine 工作区已有的 vitest（无需额外安装）：
```
cp sprints/tests/ws1/task-plan.test.ts packages/engine/tests/_temp-task-plan.test.ts && (cd packages/engine && ./node_modules/.bin/vitest run tests/_temp-task-plan.test.ts)
```
两条命令在 Red 阶段都应当呈现"全部 fail，原因 task-plan.json not found"。
