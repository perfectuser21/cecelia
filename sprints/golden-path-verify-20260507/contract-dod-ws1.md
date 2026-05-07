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

- [ ] [ARTIFACT] 探针脚本导出 4 个 step 函数（E2E 脚本 source 后调用，shell 唯一落点）
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');for(const k of ['step1_inject_probe','step2_wait_graph_quiesce','step3_assert_terminal','step4_assert_no_requeue'])if(!c.includes(k))process.exit(1)"`

- [ ] [ARTIFACT] 探针脚本含 4 步硬阈值关键词（INSERT、graph_node_update、completed_at、tick_decisions）
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');for(const k of ['INSERT INTO tasks','graph_node_update','completed_at','tick_decisions'])if(!c.includes(k))process.exit(1)"`

- [ ] [ARTIFACT] 探针脚本含 set -euo pipefail（防止中间步骤静默失败）
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');if(!/^\s*set\s+-euo\s+pipefail/m.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 探针脚本归档目录约定到 sprints/golden-path-verify-20260507/run-${TIMESTAMP}/result.json
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');if(!c.includes('sprints/golden-path-verify-20260507/run-')||!c.includes('result.json'))process.exit(1)"`

- [ ] [ARTIFACT] 测试文件存在并能被 vitest 识别
  Test: `node -e "require('fs').accessSync('sprints/golden-path-verify-20260507/tests/ws1/probe-status-writeback.test.ts')"`

- [ ] [ARTIFACT] 测试文件含 4 个固定 it() 名（合同 Test Contract 行 WS1）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws1/probe-status-writeback.test.ts','utf8');for(const k of ['Step 1: 脚本注入 fresh harness_initiative','Step 2: 脚本检查 graph_node_update','Step 3: 终态断言用 SQL 比时间戳','Step 4: anti-requeue 观察窗'])if(!c.includes(k))process.exit(1)"`

- [ ] [ARTIFACT] commit 1 红日志归档（TDD Red 证据：exit ≠ 0 且 4 项断言全 fail）
  Test: `node -e "const fs=require('fs');const p='sprints/golden-path-verify-20260507/run-baseline-red/ws1-baseline-red.log';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');const m=c.match(/× .*(Step 1|Step 2|Step 3|Step 4)/g)||[];if(m.length<4)process.exit(1)"`

- [ ] [ARTIFACT] graph 入口写法统一（不出现 compiled.invoke 残留）
  Test: `node -e "const c=require('fs').readFileSync('scripts/probe-harness-initiative-writeback.sh','utf8');if(/compiled\.invoke\b/.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/probe-status-writeback.test.ts`，4 个固定 `it()`：
- `Step 1: 脚本注入 fresh harness_initiative 任务（不复用 84075973-... 防自指）`
- `Step 2: 脚本检查 graph_node_update event 至少 1 条 + 静默 5min（防死循环假绿）`
- `Step 3: 终态断言用 SQL 比时间戳，不用 shell 字符串`
- `Step 4: anti-requeue 观察窗 ≥ 10min 且检查 tick_decisions / run_events 双源`

## TDD 纪律提示

WS1 必须两次 commit：
1. **commit 1（Red）**：仅 `tests/ws1/probe-status-writeback.test.ts` + 红日志 `run-baseline-red/ws1-baseline-red.log`（exit ≠ 0，4 项 ✗）；
2. **commit 2（Green）**：补 `scripts/probe-harness-initiative-writeback.sh` + 真实运行，4 项断言全转绿。

CI / Evaluator 通过 `run-baseline-red/ws1-baseline-red.log` 取证"先红再绿"。
