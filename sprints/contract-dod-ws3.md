# Contract DoD — Workstream 3: TaskPlan Schema Validator

**范围**: 在 `sprints/validators/taskplan-schema.mjs` 实现 `validateTaskPlanSchema(plan)`，逐字段校验必填字段、`complexity` 枚举、`estimated_minutes` 区间、`task_id` 唯一性。
**大小**: M（150-250 行实现）
**依赖**: WS2

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/task-plan.json` 是合法 JSON
  Test: node -e "const c=require('fs').readFileSync('sprints/task-plan.json','utf8');JSON.parse(c);console.log('PASS:valid JSON')"

- [ ] [ARTIFACT] `sprints/task-plan.json` 顶层有 `tasks` 数组
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));if(!Array.isArray(p.tasks))throw new Error('FAIL:tasks not array');console.log('PASS:tasks=array')"

- [ ] [ARTIFACT] `sprints/task-plan.json` tasks 数组长度 ∈ {4,5}
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const n=p.tasks.length;if(n!==4&&n!==5)throw new Error('FAIL:tasks.length='+n);console.log('PASS:tasks.length='+n)"

- [ ] [ARTIFACT] `sprints/task-plan.json` 每个 task 含 8 个必填字段（task_id/title/scope/dod/files/depends_on/complexity/estimated_minutes）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const F=['task_id','title','scope','dod','files','depends_on','complexity','estimated_minutes'];for(const t of p.tasks){for(const f of F){if(t[f]===undefined||t[f]===null)throw new Error('FAIL:'+(t.task_id||'?')+' missing '+f)}}console.log('PASS:all fields present')"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 task 的 complexity ∈ {S,M,L}
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));for(const t of p.tasks){if(!['S','M','L'].includes(t.complexity))throw new Error('FAIL:'+t.task_id+' complexity='+t.complexity)}console.log('PASS:all complexity in {S,M,L}')"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 task 的 estimated_minutes ∈ [20,60]
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));for(const t of p.tasks){const m=t.estimated_minutes;if(typeof m!=='number'||m<20||m>60)throw new Error('FAIL:'+t.task_id+' minutes='+m)}console.log('PASS:all minutes in [20,60]')"

- [ ] [ARTIFACT] `sprints/task-plan.json` 所有 estimated_minutes 之和 ∈ [80,300]
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const s=p.tasks.reduce((a,t)=>a+t.estimated_minutes,0);if(s<80||s>300)throw new Error('FAIL:sum='+s);console.log('PASS:sum='+s)"

- [ ] [ARTIFACT] `sprints/task-plan.json` task_id 全局唯一
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/task-plan.json','utf8'));const ids=p.tasks.map(t=>t.task_id);const u=new Set(ids);if(u.size!==ids.length)throw new Error('FAIL:duplicate task_id');console.log('PASS:unique='+u.size)"

- [ ] [ARTIFACT] `sprints/validators/taskplan-schema.mjs` 文件存在
  Test: node -e "require('fs').accessSync('sprints/validators/taskplan-schema.mjs');console.log('PASS:exists')"

- [ ] [ARTIFACT] `sprints/validators/taskplan-schema.mjs` export 名为 `validateTaskPlanSchema` 的 function
  Test: node -e "const c=require('fs').readFileSync('sprints/validators/taskplan-schema.mjs','utf8');if(!/export\s+(async\s+)?function\s+validateTaskPlanSchema\b/.test(c)&&!/export\s*\{\s*[^}]*\bvalidateTaskPlanSchema\b[^}]*\}/.test(c))throw new Error('FAIL:no export validateTaskPlanSchema');console.log('PASS:export found')"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/taskplan-schema.test.ts`，覆盖：
- returns ok=true taskCount=4 with sum of estimated_minutes in [80,300] for the real plan
- returns ok=false flagging tasks count out of range when plan has 3 tasks
- returns ok=false flagging complexity field when a task has complexity=X
- returns ok=false flagging estimated_minutes when value is 10 (below floor)
- returns ok=false flagging estimated_minutes when value is 75 (above ceiling)
- returns ok=false flagging duplicate task_id when two tasks share the same id
