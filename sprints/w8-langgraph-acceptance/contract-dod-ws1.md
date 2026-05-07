---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: health endpoint 实现

**范围**: 在 `packages/brain/src/routes/harness.js` 追加 `GET /health` handler，返回 `{ langgraph_version, last_attempt_at, nodes }`。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `router.get('/health'` 注册
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/router\.get\(\s*['\"]\/health['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] handler 引用 `@langchain/langgraph` package.json 取 version
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('@langchain/langgraph/package.json'))process.exit(1)"`

- [ ] [ARTIFACT] handler 含 14 节点固定数组（含 prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task / run_sub_task / evaluate / advance / retry / terminal_fail / final_evaluate / report）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const need=['prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report'];for(const n of need){if(!c.includes(\"'\"+n+\"'\")&&!c.includes('\"'+n+'\"'))process.exit(1)}"`

- [ ] [ARTIFACT] handler 通过 SQL 读取 `initiative_runs` 的 MAX(updated_at) 作为 `last_attempt_at`
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/MAX\s*\(\s*updated_at\s*\)[\s\S]{0,80}initiative_runs/i.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/harness-health-endpoint.test.ts`，覆盖：
- handler 返回 `langgraph_version` 是非空字符串
- handler 在 `initiative_runs` 无任何行时 `last_attempt_at=null` 且不抛
- handler 返回 `nodes` 数组长度 = 14 且含全部 14 节点名
