---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 触发 + 等待 LangGraph pipeline 跑完

**范围**: 实现 trigger 脚本，注册 `harness_initiative` 并轮询至 `status='completed'`。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v14/scripts/trigger.sh` 文件存在且可执行
  Test: test -x sprints/w8-langgraph-v14/scripts/trigger.sh

- [ ] [ARTIFACT] trigger.sh 包含 POST /api/brain/tasks 调用，且 task_type 为 harness_initiative
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('/api/brain/tasks'))process.exit(1);if(!c.includes('harness_initiative'))process.exit(1)"

- [ ] [ARTIFACT] trigger.sh 把 INITIATIVE_TASK_ID 写入 /tmp/v14-initiative-task-id
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('/tmp/v14-initiative-task-id'))process.exit(1)"

- [ ] [ARTIFACT] trigger.sh 含轮询逻辑等待 status=completed（grep 关键字）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('completed'))process.exit(1);if(!/while|for/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 不修改 packages/brain / packages/engine / packages/workflows 任何文件（验证型 sprint 边界）
  Test: bash -c "git diff --name-only main...HEAD | grep -E '^(packages/brain|packages/engine|packages/workflows)/' && exit 1 || exit 0"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/trigger-and-wait.test.ts`，覆盖：
- 脚本可执行性
- 调用后返回合法 UUID 并落 /tmp/v14-initiative-task-id
- 轮询命中 status=completed 的最终态
