# Contract DoD — Workstream 4: TaskPlan DAG Validator

**范围**: 在 `sprints/validators/taskplan-dag.mjs` 实现 `validateTaskPlanDag(plan)`：拓扑排序（Kahn 算法）+ 自指检测 + 悬空检测 + 入口检测 + 连通性检测。
**大小**: M（200-300 行实现）
**依赖**: WS3

> **DoD 机检约定**: 所有 Test 命令均为 shell 单行，非 0 退出 = 红。CI 可 `set -e` 串起来跑。

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/task-plan.json` 至少 1 个 task 的 `depends_on` 为空数组（图入口存在）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(p.tasks.some(t=>Array.isArray(t.depends_on)&&t.depends_on.length===0)?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 不存在 task_id 出现在自身 depends_on 中（无自指）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));process.exit(p.tasks.every(t=>!(t.depends_on||[]).includes(t.task_id))?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 depends_on 引用的 task_id 都在 tasks 列表中存在（无悬空）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const ids=new Set(p.tasks.map(t=>t.task_id));process.exit(p.tasks.every(t=>(t.depends_on||[]).every(d=>ids.has(d)))?0:1)"

- [ ] [ARTIFACT] `sprints/task-plan.json` depends_on 图无环（拓扑排序成功）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const indeg=new Map();const g=new Map();for(const t of p.tasks){indeg.set(t.task_id,0);g.set(t.task_id,[])}for(const t of p.tasks){for(const d of(t.depends_on||[])){g.get(d).push(t.task_id);indeg.set(t.task_id,indeg.get(t.task_id)+1)}}const q=[...indeg].filter(([,n])=>n===0).map(([k])=>k);let visited=0;while(q.length){const u=q.shift();visited++;for(const v of g.get(u)){indeg.set(v,indeg.get(v)-1);if(indeg.get(v)===0)q.push(v)}}process.exit(visited===p.tasks.length?0:1)"

- [ ] [ARTIFACT] `sprints/validators/taskplan-dag.mjs` 文件存在
  Test: test -f sprints/validators/taskplan-dag.mjs

- [ ] [ARTIFACT] `sprints/validators/taskplan-dag.mjs` 运行时 export 名为 `validateTaskPlanDag` 的 function
  Test: node -e "import('./sprints/validators/taskplan-dag.mjs').then(m=>process.exit(typeof m.validateTaskPlanDag==='function'?0:1)).catch(()=>process.exit(2))"

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/taskplan-dag.test.ts`，覆盖：
- returns ok=true with entryCount=1 and full topoOrder for the real linear plan
- detects self-reference when ws1.depends_on includes "ws1"
- detects a cycle when ws1->ws2->ws1
- detects a dangling reference when ws3.depends_on includes a non-existent id
- returns ok=false with no-entry when every task has a non-empty depends_on
- topoOrder length equals tasks length, proving the graph is connected from the entry
