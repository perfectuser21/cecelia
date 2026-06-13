# DoD：harness watchdog 周期调用修复（cp-06131425-tick-watchdog-call）

PRD: sprints/06131425-tick-watchdog-call/prep-prd.md

根因一句话：harness watchdog 只接在 Wave-2 废弃的 executeTick()，真实 tick 循环走 runScheduler/consciousness-loop，两者都不调用它 → 函数正确但生产中从未执行。

## 验收项

- [x] [ARTIFACT] 新建独立看门狗循环模块 harness-watchdog-loop.js（runHarnessWatchdogOnce / start / stop）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watchdog-loop.js','utf8'); if(!c.includes('startHarnessWatchdogLoop')||!c.includes('runHarnessWatchdogOnce')) process.exit(1)"

- [x] [BEHAVIOR] watchdog 已接入 startTickLoop 的独立循环（不再只在废弃 executeTick）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-loop.js','utf8'); if(!c.includes('startHarnessWatchdogLoop')) { console.error('watchdog 未接入 startTickLoop'); process.exit(1) }"

- [x] [BEHAVIOR] 废弃 executeTick 不再调用 watchdog（死块已删，杜绝回滚双驱动）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8'); if(c.includes('resumeStalledHarnessDrivers')||c.includes('scanStuckHarness')) { console.error('executeTick 仍残留 watchdog 调用'); process.exit(1) }"

- [x] [BEHAVIOR] 独立看门狗模块定义无条件可观测日志行 [harness-watchdog] scanned=...
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watchdog-loop.js','utf8'); if(!c.includes('[harness-watchdog] scanned=')) process.exit(1)"

- [x] [BEHAVIOR] 看门狗循环行为回归（无条件 log / 独立 try-catch / 独立 setInterval 周期触发）
  Test: tests/integration/harness-watchdog-loop.test.js

- [x] [BEHAVIOR] startTickLoop 启动 / stopTickLoop 停止看门狗循环（被接上 + start/stop 对称回归）
  Test: tests/integration/harness-watchdog-loop.test.js
