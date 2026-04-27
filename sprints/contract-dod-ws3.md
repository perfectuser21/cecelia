# Contract DoD — Workstream 3: TaskPlan Schema Validator

**范围**: 在 `sprints/validators/taskplan-schema.mjs` 实现 `validateTaskPlanSchema(plan)`，逐字段校验必填字段、`complexity` 枚举、`estimated_minutes` 区间、`task_id` 唯一性。
**大小**: M（150-250 行实现）
**依赖**: WS2

> **DoD 机检约定**: 所有 Test 命令均为 shell 单行，非 0 退出 = 红。CI 可 `set -e` 串起来跑。
> **平台**: linux (GNU coreutils only) — `bash` / GNU `grep -cE` / GNU `wc -l` / `test -f` / `node` / `git`。BSD/macOS 行为差异不在支持矩阵内。

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/task-plan.json` 文件存在
  Test: test -f sprints/task-plan.json

- [ ] [ARTIFACT] `sprints/task-plan.json` 是合法 JSON
  Test: node -e "JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'))"

- [ ] [ARTIFACT] `sprints/task-plan.json` 顶层有 `tasks` 数组
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(Array.isArray(p.tasks)?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` tasks 数组长度 ∈ {4,5}
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(p.tasks.length===4||p.tasks.length===5?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 每个 task 含 8 个必填字段（task_id/title/scope/dod/files/depends_on/complexity/estimated_minutes）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const F=['task_id','title','scope','dod','files','depends_on','complexity','estimated_minutes'];process.exit(p.tasks.every(t=>F.every(f=>t[f]!==undefined&&t[f]!==null))?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 task 的 complexity ∈ {S,M,L}
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(p.tasks.every(t=>['S','M','L'].includes(t.complexity))?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 task 的 estimated_minutes ∈ [20,60]
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(p.tasks.every(t=>typeof t.estimated_minutes==='number'&&t.estimated_minutes>=20&&t.estimated_minutes<=60)?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 estimated_minutes 之和 ∈ [80,300]
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const s=p.tasks.reduce((a,t)=>a+t.estimated_minutes,0);process.exit(s>=80&&s<=300?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` task_id 全局唯一
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const ids=p.tasks.map(t=>t.task_id);process.exit(new Set(ids).size===ids.length?0:1)"

- [ ] [ARTIFACT] `sprints/validators/taskplan-schema.mjs` 文件存在
  Test: test -f sprints/validators/taskplan-schema.mjs

- [ ] [ARTIFACT] `sprints/validators/taskplan-schema.mjs` 运行时 export 名为 `validateTaskPlanSchema` 的 function
  Test: node -e "import('./sprints/validators/taskplan-schema.mjs').then(m=>process.exit(typeof m.validateTaskPlanSchema==='function'?0:1)).catch(()=>process.exit(2))"

- [ ] [ARTIFACT] `sprints/task-plan.json` commit-2 后相对 HEAD 无任何修改（只读保护，R4 mitigation）
  Test: bash -c 'git diff --quiet HEAD -- sprints/task-plan.json'

## BEHAVIOR 索引（实际测试在 sprints/tests/ws3/）

见 `sprints/tests/ws3/taskplan-schema.test.ts`，覆盖：
- `ws3.t1` returns ok=true taskCount=4 with sum of estimated_minutes in [80,300] for the real plan
- `ws3.t2` returns ok=false flagging tasks count out of range when plan has 3 tasks
- `ws3.t3` returns ok=false flagging complexity field when a task has complexity=X
- `ws3.t4` returns ok=false flagging estimated_minutes when value is 10 (below floor)
- `ws3.t5` returns ok=false flagging estimated_minutes when value is 75 (above ceiling)
- `ws3.t6` returns ok=false flagging duplicate task_id when two tasks share the same id
