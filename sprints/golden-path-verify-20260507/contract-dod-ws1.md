---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 端到端真实运行 + DB 终态断言

**范围**: 编写探针脚本 + 真实跑 + 4 步硬阈值断言 + 结果归档
**大小**: M（约 150–250 行 shell + jq）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 探针脚本存在
  Test: `node -e "require('fs').accessSync('scripts/probe-harness-initiative-writeback.sh')"`

- [ ] [ARTIFACT] 探针脚本含 4 步硬阈值（INSERT、graph_node_update、终态、anti-requeue）
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');for(const k of ['INSERT INTO tasks','graph_node_update','completed_at','tick_decisions'])if(!c.includes(k))process.exit(1)"`

- [ ] [ARTIFACT] 探针脚本含 set -euo pipefail（防止中间步骤静默失败）
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');if(!/^\s*set\s+-euo\s+pipefail/m.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 探针脚本归档目录约定到 sprints/golden-path-verify-20260507/run-${TIMESTAMP}/result.json
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');if(!c.includes('sprints/golden-path-verify-20260507/run-')||!c.includes('result.json'))process.exit(1)"`

- [ ] [ARTIFACT] 测试文件存在并能被 vitest 识别
  Test: `node -e "require('fs').accessSync('sprints/golden-path-verify-20260507/tests/ws1/probe-status-writeback.test.ts')"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/probe-status-writeback.test.ts`，覆盖：
- 探针任务在 6min 内被 dispatcher 拉起（status 脱离 queued）
- graph 至少 emit 1 个 `graph_node_update` event 后停手（最近 5min 无新 event）
- 探针任务终态 ∈ `{completed, failed}` 且 `completed_at >= started_at`
- 终态后 10min 内无活跃 run_events、无 requeue/reschedule tick_decisions、status 不被回滚
