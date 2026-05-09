---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: trigger + 60s fail-fast + GENERATOR 30min stall + wait pipeline

**范围**: 实现 trigger 脚本，注册 `harness_initiative`、60s 内 fail-fast 校验 `harness_initiatives` 派生行（R1）、并轮询至 `status='completed'`，轮询过程中若 GENERATOR 节点停留 > 30min 即 exit 3（R5）。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v14/scripts/trigger.sh` 文件存在且可执行
  Test: test -x sprints/w8-langgraph-v14/scripts/trigger.sh

- [ ] [ARTIFACT] trigger.sh 包含 POST /api/brain/tasks 调用，且 task_type 为 harness_initiative
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('/api/brain/tasks'))process.exit(1);if(!c.includes('harness_initiative'))process.exit(1)"

- [ ] [ARTIFACT] trigger.sh 把 INITIATIVE_TASK_ID 写入 /tmp/v14-initiative-task-id
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('/tmp/v14-initiative-task-id'))process.exit(1)"

- [ ] [ARTIFACT] trigger.sh 含 60s consciousness loop fail-fast 校验（查 harness_initiatives 表 — R1）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('harness_initiatives'))process.exit(1);if(!/60|fail.?fast|consciousness/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] trigger.sh 含 GENERATOR 节点停留 > 30min fail-fast 检测段（R5 mitigation）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('harness_state_transitions'))process.exit(1);if(!/GENERATOR/.test(c))process.exit(1);if(!/30/.test(c))process.exit(1);if(!/exit\s+3/.test(c))process.exit(1)"

- [ ] [ARTIFACT] trigger.sh 含轮询逻辑等待 status=completed
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/trigger.sh','utf8');if(!c.includes('completed'))process.exit(1);if(!/while|for/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 不修改 packages/brain / packages/engine / packages/workflows 任何文件（验证型 sprint 边界）
  Test: bash -c "git diff --name-only main...HEAD | grep -E '^(packages/brain|packages/engine|packages/workflows)/' && exit 1 || exit 0"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/trigger-and-wait.test.ts`，覆盖：
- 脚本可执行性
- 调用后返回合法 UUID 并落 /tmp/v14-initiative-task-id
- 60s 内 harness_initiatives 派生行存在（fail-fast 真生效 — R1）
- 轮询命中 status=completed 的最终态
- GENERATOR 节点停留 > 30min 即 exit 3（R5 mitigation 关键字与逻辑实证）
