---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 观察脚本（scripts/v15-watch.mjs）

**范围**：Node.js 脚本，每 5s 轮询 `initiative_runs.phase` + `tasks.status`，
追加写 `.v15/timeline.log`（每行 `ISO_TIMESTAMP\tPHASE`）。退出条件：
- phase ∈ {done, failed} → exit 0
- R1 dispatcher_pickup 死锁（首 60s queued + 无 initiative_runs 行） → 写 STUCK_QUEUED → exit 1
- R2 cascade 静默死锁（同 phase 持续 ≥ 10min） → 写 STALL@<phase> → exit 1
- 30min 兜底超时 → 写 TIMEOUT → exit 1
- 参数/连接错误 → exit 2

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

- [ ] [ARTIFACT] 脚本导出 isTerminalPhase / formatTimelineEntry / detectStuckQueued / detectStall 四个纯函数（便于单测）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');for(const n of ['isTerminalPhase','formatTimelineEntry','detectStuckQueued','detectStall']){if(!new RegExp('export\\\\s+(function|const)\\\\s+'+n).test(c)){console.error('missing export:',n);process.exit(1)}}"

- [ ] [ARTIFACT] 脚本含 TIMEOUT / STUCK_QUEUED / STALL 三个 sentinel 字面量（保证落盘可被 grep 到）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');for(const s of ['TIMEOUT','STUCK_QUEUED','STALL']){if(!c.includes(s)){console.error('missing sentinel:',s);process.exit(1)}}"

- [ ] [ARTIFACT] 脚本含 R1 60s grace 阈值常量（60_000 / 60000 / 60 * 1000）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');if(!/60[_]?000/.test(c) && !/60\\s*\\*\\s*1000/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] 脚本含 R2 10min stall 阈值常量（600_000 / 600000 / 10 * 60 * 1000）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-watch.mjs','utf8');if(!/600[_]?000/.test(c) && !/10\\s*\\*\\s*60\\s*\\*\\s*1000/.test(c)) process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/watch.test.ts`，覆盖：
- isTerminalPhase('done') === true
- isTerminalPhase('failed') === true
- isTerminalPhase('A_contract' | 'B_task_loop' | 'C_final_e2e') === false
- formatTimelineEntry(ts, phase) 返回 `${ISO}\t${phase}\n` 格式（含 sentinel）
- detectStuckQueued —— R1 dispatcher_pickup 探测：queued+无run+>60s → true；30s 内 → false；有 run → false；in_progress → false
- detectStall —— R2 cascade 静默死锁探测：>=10min → true；<10min → false
