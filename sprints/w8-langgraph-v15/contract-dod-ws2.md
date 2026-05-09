---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 观察脚本（scripts/v15-watch.mjs）

**范围**：Node.js 脚本，每 5s 轮询 `initiative_runs.phase` + `tasks.status`，
追加写 `.v15/timeline.log`（每行 `ISO_TIMESTAMP\tPHASE`）。直到 phase ∈ {done, failed} 或 30min 超时退出。
退出码 0=终态正常、1=超时、2=连接/参数错误。

**大小**：M

**依赖**：WS1（消费 INITIATIVE_ID）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/v15-watch.mjs` 文件存在
  Test: node -e "require('fs').accessSync('scripts/v15-watch.mjs')"

- [ ] [ARTIFACT] 脚本含 30 分钟超时常量（30*60*1000 或 1800000）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');if(!/30\\s*\\*\\s*60\\s*\\*\\s*1000/.test(c) && !/1800000/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] 脚本写入路径 `.v15/timeline.log`
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');if(!c.includes('.v15/timeline.log')) process.exit(1)"

- [ ] [ARTIFACT] 脚本查询 initiative_runs 表
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');if(!c.includes('initiative_runs')) process.exit(1)"

- [ ] [ARTIFACT] 脚本导出 isTerminalPhase 函数（便于单测）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');if(!/export\\s+(function|const)\\s+isTerminalPhase/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] 脚本含 TIMEOUT 字面量（保证超时落盘）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');if(!c.includes('TIMEOUT')) process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/watch.test.ts`，覆盖：
- isTerminalPhase('done') === true
- isTerminalPhase('failed') === true
- isTerminalPhase('B_task_loop') === false
- isTerminalPhase('A_contract') === false
- formatTimelineEntry(ts, phase) 返回 `${ISO}\t${phase}\n` 格式
