---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 派发 walking_skeleton + 验证 dispatcher 起 graph

**范围**: 写 `acceptance-task-payload.json`（schema 合法的 walking_skeleton payload），POST 到 Brain 拿 task_id，把 task_id 落到 `/tmp/w8v9-task-id` 供下游 ws 引用。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v9/acceptance-task-payload.json` 文件存在且为合法 JSON
  Test: node -e "JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v9/acceptance-task-payload.json','utf8'))"

- [ ] [ARTIFACT] payload 含 `.task_type == "harness_initiative"`
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v9/acceptance-task-payload.json','utf8')); if(p.task_type!=='harness_initiative')process.exit(1)"

- [ ] [ARTIFACT] payload 含非空 `.payload.walking_skeleton.thin_feature` 字符串
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v9/acceptance-task-payload.json','utf8')); const v=p?.payload?.walking_skeleton?.thin_feature; if(typeof v!=='string'||!v.length)process.exit(1)"

- [ ] [ARTIFACT] payload 含非空 `.payload.walking_skeleton.e2e_acceptance.command` 字符串
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v9/acceptance-task-payload.json','utf8')); const v=p?.payload?.walking_skeleton?.e2e_acceptance?.command; if(typeof v!=='string'||!v.length)process.exit(1)"

- [ ] [ARTIFACT] payload 含 `.payload.walking_skeleton.e2e_acceptance.timeout_sec` 数字 ≤ 600
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v9/acceptance-task-payload.json','utf8')); const v=p?.payload?.walking_skeleton?.e2e_acceptance?.timeout_sec; if(typeof v!=='number'||v>600||v<=0)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/，Status: NEW，Runner: vitest）

见 `tests/ws1/payload-and-dispatch.test.ts`（5 个 it() 块），覆盖：
- **Brain `/api/brain/health` 返回 healthy/ok（前置条件）**
- payload schema 4 项必填字段全通过
- POST `/api/brain/tasks` 后返回 task_id（非空、非 "null"），并写入 `/tmp/w8v9-task-id`
- 90s 内 task status 从 queued 转为 in_progress（dispatcher tick 拉到）
- 5min 时间窗内 task_events 至少 1 条 `graph_node_update`（证明 LangGraph 启动）
