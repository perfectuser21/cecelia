# Contract DoD — Workstream 4: TaskPlan DAG Validator

**范围**: 在 `sprints/validators/taskplan-dag.mjs` 实现 `validateTaskPlanDag(plan)`：拓扑排序（Kahn 算法）+ 自指检测 + 悬空检测 + 入口检测 + 连通性检测。
**大小**: M（200-300 行实现）
**依赖**: WS3

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/task-plan.json` 至少 1 个 task 的 `depends_on` 为空数组（图入口存在）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const e=p.tasks.filter(t=>Array.isArray(t.depends_on)&&t.depends_on.length===0);if(e.length<1)throw new Error('FAIL:no entry task');console.log('PASS:entryCount='+e.length)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 不存在 task_id 出现在自身 depends_on 中
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));for(const t of p.tasks){if((t.depends_on||[]).includes(t.task_id))throw new Error('FAIL:self-ref '+t.task_id)}console.log('PASS:no self-ref')"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 depends_on 引用的 task_id 都在 tasks 列表中存在
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const ids=new Set(p.tasks.map(t=>t.task_id));for(const t of p.tasks){for(const d of(t.depends_on||[])){if(!ids.has(d))throw new Error('FAIL:dangling '+t.task_id+'->'+d)}}console.log('PASS:no dangling')"

- [ ] [ARTIFACT] `sprints/validators/taskplan-dag.mjs` 文件存在
  Test: node -e "require('fs').accessSync('sprints/validators/taskplan-dag.mjs');console.log('PASS:exists')"

- [ ] [ARTIFACT] `sprints/validators/taskplan-dag.mjs` export 名为 `validateTaskPlanDag` 的 function
  Test: node -e "const c=require('fs').readFileSync('sprints/validators/taskplan-dag.mjs','utf8');if(!/export\s+(async\s+)?function\s+validateTaskPlanDag\b/.test(c)&&!/export\s*\{\s*[^}]*\bvalidateTaskPlanDag\b[^}]*\}/.test(c))throw new Error('FAIL:no export validateTaskPlanDag');console.log('PASS:export found')"

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/taskplan-dag.test.ts`，覆盖：
- returns ok=true with entryCount=1 and full topoOrder for the real linear plan
- detects self-reference when ws1.depends_on includes "ws1"
- detects a cycle when ws1→ws2→ws1
- detects a dangling reference when ws3.depends_on includes a non-existent id
- returns ok=false with no-entry when every task has a non-empty depends_on
- topoOrder length equals tasks length, proving the graph is connected from the entry
