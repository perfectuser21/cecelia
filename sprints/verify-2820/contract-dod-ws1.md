---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 端到端验证 task-plan.json 经由 inferTaskPlanNode 闭环

**范围**: sprint-prd.md（Planner 已产出）+ task-plan.json（Proposer 本轮产出）+ tests/ws1/ 测试用例
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] sprint-prd.md 落盘且含 journey_type 标注行
  Test: `node -e "const c=require('fs').readFileSync('sprints/verify-2820/sprint-prd.md','utf8');if(!/^## journey_type:\s*(autonomous|user_facing|dev_pipeline|agent_remote)\s*$/m.test(c))process.exit(1)"`

- [ ] [ARTIFACT] task-plan.json 文件存在
  Test: `node -e "if(!require('fs').existsSync('sprints/verify-2820/task-plan.json'))process.exit(1)"`

- [ ] [ARTIFACT] task-plan.json 顶层是 JSON 对象且含 tasks 数组（非空）
  Test: `node -e "const p=JSON.parse(require('fs').readFileSync('sprints/verify-2820/task-plan.json','utf8'));if(!Array.isArray(p.tasks)||p.tasks.length<1)process.exit(1)"`

- [ ] [ARTIFACT] task-plan.json 每个 task 含必填字段 task_id/title/scope/dod[]/files[]/depends_on[]/complexity/estimated_minutes
  Test: `node -e "const p=JSON.parse(require('fs').readFileSync('sprints/verify-2820/task-plan.json','utf8'));for(const t of p.tasks){for(const f of ['task_id','title','scope']){if(typeof t[f]!=='string'||!t[f].trim())process.exit(1)}for(const f of ['dod','files','depends_on']){if(!Array.isArray(t[f]))process.exit(1)}if(!['S','M','L'].includes(t.complexity))process.exit(1);if(typeof t.estimated_minutes!=='number'||t.estimated_minutes<20||t.estimated_minutes>60)process.exit(1)}"`

- [ ] [ARTIFACT] tests/ws1/infer-task-plan-e2e.test.ts 文件存在且含至少 2 个 it() 块
  Test: `node -e "const c=require('fs').readFileSync('sprints/verify-2820/tests/ws1/infer-task-plan-e2e.test.ts','utf8');const m=c.match(/\bit\s*\(/g)||[];if(m.length<2)process.exit(1)"`

- [ ] [ARTIFACT] scripts/harness/verify-task-plan.mjs 验证脚本存在且导出 --mode=schema/--mode=infer 两种模式
  Test: `node -e "const c=require('fs').readFileSync('scripts/harness/verify-task-plan.mjs','utf8');if(!c.includes(\"mode === 'schema'\")||!c.includes(\"mode === 'infer'\")||!c.includes('parseTaskPlan')||!c.includes('inferTaskPlanNode'))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/infer-task-plan-e2e.test.ts`，覆盖：
- inferTaskPlanNode 在 propose 分支含合法 task-plan.json 时返回 `{ taskPlan }`、不含 `error` 字段
- inferTaskPlanNode 在 propose 分支不存在 task-plan.json 时返回 `{ error }` 且 error 字符串含 `task-plan.json failed` 子串
