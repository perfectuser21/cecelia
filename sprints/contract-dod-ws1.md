# Contract DoD — Workstream 1: 落盘 task-plan.json 基线 DAG

**范围**: 在 `sprints/` 目录新建 `task-plan.json`，覆盖 PRD 中 FR-001 ~ FR-005，DAG 满足 SC-001 ~ SC-004。本 workstream 不动 `sprint-prd.md`，仅校验其字数阈值。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] sprints/task-plan.json 文件存在
  Test: node -e "require('fs').accessSync('sprints/task-plan.json')"

- [ ] [ARTIFACT] sprints/task-plan.json 文件大小大于 100 字节（防 stub）
  Test: node -e "const s=require('fs').statSync('sprints/task-plan.json');if(s.size<=100)process.exit(1)"

- [ ] [ARTIFACT] sprints/task-plan.json 首字符为 '{'（最小 JSON 形态）
  Test: node -e "const c=require('fs').readFileSync('sprints/task-plan.json','utf8').trim();if(c[0]!=='{')process.exit(1)"

- [ ] [ARTIFACT] sprints/task-plan.json 末字符为 '}'（最小 JSON 形态）
  Test: node -e "const c=require('fs').readFileSync('sprints/task-plan.json','utf8').trim();if(c[c.length-1]!=='}')process.exit(1)"

- [ ] [ARTIFACT] sprints/sprint-prd.md 文件存在
  Test: node -e "require('fs').accessSync('sprints/sprint-prd.md')"

- [ ] [ARTIFACT] sprints/sprint-prd.md 字数（去除空白后字符数）≥ 800
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8').replace(/\s+/g,'');if(c.length<800)process.exit(1)"

- [ ] [ARTIFACT] sprints/sprint-prd.md 包含 9 大段标题之一：'## 范围限定'
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!c.includes('## 范围限定'))process.exit(1)"

- [ ] [ARTIFACT] sprints/sprint-prd.md 包含 9 大段标题之一：'## 假设'
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!c.includes('## 假设'))process.exit(1)"

- [ ] [ARTIFACT] sprints/sprint-prd.md 包含 9 大段标题之一：'## 成功标准'
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!c.includes('## 成功标准'))process.exit(1)"

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
