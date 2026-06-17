# Bug PrepPRD：harness watchdog 函数正确但 tick 周期从不调用它（P1）

## 症状
- 生产任务卡在 A_contract 阶段 ~50min、execution_attempts=0、三信号（心跳/run_events/updated_at）全静默 >20min，watchdog 始终没捞起。
- `docker logs cecelia-node-brain --since 40m | grep -ic watchdog` = 0，零输出。
- 但 brain 容器内手动 `node -e "import('./harness-watchdog.js').then(m=>m.resumeStalledHarnessDrivers({staleMinutesA:20}))"` 立刻正确捞起（resumed:[...], scanned:1）。
- 结论：watchdog 函数本身正确，但生产中从未被周期调用 → 「全自动总差最后一口气」。#3376 的 watchdog 形同虚设。

## 根因（已用代码路径 + grep 全量调用点实证）
- harness watchdog（`scanStuckHarness` + `resumeStalledHarnessDrivers`）唯一的生产调用点在 `tick-runner.js` 的 `executeTick()`（约 381 行）。
- 但 `executeTick()` 自 **Wave 2（2026-05-04）起已废弃**（文件头注释明确标注）。`tick-loop.js:46` `const doTick = tickFn || runScheduler;` —— 真实 5 秒循环跑的是 `runScheduler`（tick-scheduler.js），20 分钟循环跑 `consciousness-loop.js`。两条活路径都**不**调用 watchdog。
- `grep -rn "resumeStalledHarnessDrivers\|scanStuckHarness"` 全 brain src：除 harness-watchdog.js 自身与测试外，唯一调用点就是死掉的 executeTick。
- 这完美解释了「函数正确 + grep watchdog=0」：watchdog 块从未执行；「Tick completed」日志来自 runScheduler/runTickSafe，不是 executeTick。
- 次要：即便调用，原 watchdog 块只在 `flagged>0`/`resumed>0` 时 log，resumed=0 时静默 → 无「我在跑」可观测输出，grep=0 既不能证明跑了也不能证明没跑。

## 关联上下文
- 相关 Journey：Cecelia Harness Pipeline
- 关联：#3376（watchdog 函数 P1 扩面，覆盖 A 阶段，但调用从未接上）

## 修法
1. 新建 `packages/brain/src/harness-watchdog-loop.js`：独立 setInterval（仿 consciousness-loop 模式），由 `startTickLoop()` 启动。
   - 不依赖任何 tick body（runScheduler）跑完，不被 circuit_open / no_goals 早 return 或异常跳过。
   - scan / resume 各自独立 try-catch，互不影响。
   - 每次执行**无条件** log `[harness-watchdog] scanned=N flagged=F resumed=M`（即使 resumed=0）。
   - 不受 CONSCIOUSNESS_ENABLED 门控（纯恢复安全网，无 LLM）。
2. `tick-loop.js`：`startTickLoop()` 内 `startConsciousnessLoop()` 旁启动 `startHarnessWatchdogLoop()`；`stopTickLoop()` 同步停掉（start/stop 对称）。
3. 清理：从废弃 `executeTick` 删除 watchdog 死块 + 不再使用的 `HARNESS_WATCHDOG_INTERVAL_MS` 常量（独立循环在回滚场景仍覆盖，无双驱动风险）。

## Regression Test 计划
- test 1：`runHarnessWatchdogOnce` 在 resumed=0 时仍无条件输出 `[harness-watchdog] scanned=...` 可观测行。
- test 2：scan 抛错时 resume 仍执行且仍输出可观测行（独立 try-catch）；resume 抛错不抛出。
- test 3：`startHarnessWatchdogLoop` 的独立 setInterval 周期触发 scan+resume，完全不依赖 tick body。
- test 4：`startTickLoop` 调用 `startHarnessWatchdogLoop`、`stopTickLoop` 调用 `stopHarnessWatchdogLoop`（锁定「被接上」，防回归）。

## 成功标准
- 独立看门狗循环由 startTickLoop 启动，每 5 分钟周期执行，不被调度层早 return/异常跳过。
- 每次执行输出可观测日志行，运维 `grep watchdog` 能看到「我在跑」。
- failing tests 先 commit、修复后变绿、全套件全绿、CI 全绿。
