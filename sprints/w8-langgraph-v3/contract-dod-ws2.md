---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 14 节点 graph_node_update 事件轮询与报告

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/02-verify-14-nodes.sh` + `sprints/harness-acceptance-v3/lib/14-nodes-report.mjs`，轮询 task_events 表直到 14 个 distinct node_name 全部出现，落 JSON 报告。
**大小**: M
**依赖**: Workstream 1（读 `.acceptance-task-id`）

## ARTIFACT 条目

- [ ] [ARTIFACT] 验证脚本存在且可执行
  Test: test -x sprints/harness-acceptance-v3/scripts/02-verify-14-nodes.sh

- [ ] [ARTIFACT] 报告生成器存在且导出 `pollAndReport` / `renderNodeReport`
  Test: node -e "const m=require('./sprints/harness-acceptance-v3/lib/14-nodes-report.mjs');for(const k of ['pollAndReport','renderNodeReport']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] 14 节点白名单写入代码（不允许通配）
  Test: grep -E "prep.*planner.*parsePrd.*ganLoop.*inferTaskPlan.*dbUpsert.*pick_sub_task.*run_sub_task.*evaluate.*advance.*retry.*terminal_fail.*final_evaluate.*report" sprints/harness-acceptance-v3/lib/14-nodes-report.mjs

- [ ] [ARTIFACT] 脚本头含 `set -euo pipefail`
  Test: head -5 sprints/harness-acceptance-v3/scripts/02-verify-14-nodes.sh | grep -q 'set -euo pipefail'

- [ ] [ARTIFACT] 脚本含轮询超时上限（≤ 60 分钟），且超时 exit 非 0
  Test: grep -E 'TIMEOUT_SEC=(36|[34][0-9])00|max.?wait.*3600' sprints/harness-acceptance-v3/scripts/02-verify-14-nodes.sh

- [ ] [ARTIFACT] 脚本读取 `.acceptance-task-id` 而非 hardcode task id
  Test: grep -F '.acceptance-task-id' sprints/harness-acceptance-v3/scripts/02-verify-14-nodes.sh

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `sprints/w8-langgraph-v3/tests/ws2/verify-14-nodes.test.ts`，覆盖：
- `renderNodeReport(events)` 输入 14 节点齐全的 events 时，输出对象 `nodes` 字段恰好 14 个 key
- `renderNodeReport(events)` 输入缺失节点时，对应缺失 key 标 `count: 0`
- `pollAndReport({taskId, deadline})` 在 deadline 之前返回 fulfilled，超过 deadline 返回 timeout error（用 mock clock）
