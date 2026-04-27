# Contract DoD — Workstream 1: 落盘 task-plan.json 基线 DAG

**范围**: 在 `sprints/` 目录新建 `task-plan.json`，覆盖 PRD 中 FR-001 ~ FR-005，DAG 满足 SC-001 ~ SC-004。本 workstream 不动 `sprint-prd.md`，仅校验其字数阈值。
**大小**: S
**依赖**: 无

> **机械可执行约定**：本段所有 Test 字段都是单行 shell 命令，可直接被包进 `bash -c '...'` 执行；exit 0 = PASS，非 0 = FAIL。Evaluator/CI 不需要解读语义。

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

- [ ] [ARTIFACT] sprints/sprint-prd.md 字数（去除空白后字符数）≥ 800（阈值锚点 = sprint-prd.md SC-004 行）
  Test: node -e "process.exit(require('fs').readFileSync('sprints/sprint-prd.md','utf8').replace(/\s/g,'').length>=800?0:1)"

- [ ] [ARTIFACT] sprints/sprint-prd.md 显式声明 SC-004 字数阈值（防 PRD 偷偷改阈值导致合同与 PRD 错位）
  Test: grep -c "SC-004" sprints/sprint-prd.md

- [ ] [ARTIFACT] sprints/sprint-prd.md 含关键大段标题：## 范围限定
  Test: grep -c "^## 范围限定" sprints/sprint-prd.md

- [ ] [ARTIFACT] sprints/sprint-prd.md 含关键大段标题：## 假设
  Test: grep -c "^## 假设" sprints/sprint-prd.md

- [ ] [ARTIFACT] sprints/sprint-prd.md 含关键大段标题：## 成功标准
  Test: grep -c "^## 成功标准" sprints/sprint-prd.md

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
