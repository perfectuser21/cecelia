# Learning：修了函数没接调用 = 形同虚设；周期任务必须有「我在跑」的可观测输出

- 分支：cp-06131425-tick-watchdog-call
- 日期：2026-06-13
- 类型：P1 Bug Fix（harness pipeline 自愈失效）

## 教训

**修了函数没接调用 = 形同虚设；周期任务必须有「我在跑」的可观测输出。**

`resumeStalledHarnessDrivers` / `scanStuckHarness` 函数本身完全正确（手动 invoke 立刻捞起卡死任务），#3376 还专门给它扩了 A 阶段覆盖面。但它唯一的生产调用点接在了 **Wave-2 已废弃的 `executeTick()`** 上，而真实 tick 循环早在 2026-05-04 改调 `runScheduler`——于是 watchdog 在生产中**从未执行**，GAN/planner 卡死无人自救，「全自动总差最后一口气」。修函数花的所有功夫都打了水漂。

第二层教训：原 watchdog 块只在 `flagged>0`/`resumed>0` 时打日志，resumed=0 时完全静默。导致 `grep watchdog=0` 这条证据**既不能证明它跑了、也不能证明它没跑**，排查时差点据此误判「执行到了但没命中」。周期性后台任务必须每轮无条件打一行「我在跑」（scanned=N resumed=M），否则可观测性为零。

## 根本原因

1. **调用点接在死代码上**：harness watchdog 只在 `tick-runner.js::executeTick()` 内被调用，但 `tick-loop.js:46` 自 Wave 2 起 `const doTick = tickFn || runScheduler`——执行的是 `runScheduler`（tick-scheduler.js）与 `consciousness-loop.js`，两条活路径都不含 watchdog 调用。`executeTick` 仅保留供紧急回滚，从不被调用。
2. **可观测性缺失**：watchdog 块只在有正向结果时 log，resumed=0 静默，无法从日志判断它是否在周期运行。
3. **测试只覆盖函数、不覆盖接线**：既有测试只直接调 `scanStuckHarness`/`resumeStalledHarnessDrivers`，没有任何测试断言「tick 循环真的会周期调用 watchdog」，于是死接线长期无人发现。

## 修复

- 新建 `harness-watchdog-loop.js`：独立 setInterval（仿 consciousness-loop 模式），由 `startTickLoop()` 启动，不依赖 tick body、不被 runScheduler 早 return/异常跳过；scan/resume 各自独立 try-catch；每轮无条件 log `[harness-watchdog] scanned=N flagged=F resumed=M`。
- `tick-loop.js`：start/stop 对称接入 + 停止。
- 删除 `executeTick` 内死 watchdog 块与不再使用的常量（回滚场景由独立循环覆盖，无双驱动）。
- 加测试锁定「被接上」+「周期触发」+「无条件 log」+「独立 try-catch」。

## 下次预防

- [ ] 任何「修了某个周期/后台函数」的任务，最后必须 grep 它的**实际调用点**，确认接在**当前活路径**上（不是被废弃/回滚保留的死代码）。
- [ ] 周期性后台任务（watchdog/patrol/sweep）每轮必须无条件打一行可观测日志，禁止「只在命中时才 log」。
- [ ] 接线类修复必须配一个断言「调度入口真的会调用它」的回归测试，而不只测被调函数本身。
- [ ] 发现某模块被标「废弃保留供回滚」时，警惕仍有功能逻辑挂在它上面——废弃即应迁出所有活逻辑。
