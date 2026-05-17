# Learning — fix(brain): executor.js verdict 传递修复（W20 Bug 3）

**日期**: 2026-05-10
**分支**: cp-0510204528-brain-executor-final-evaluate-verdict-fix
**类型**: fix（Brain runtime 单点 bug）

## 背景

W20 实证 harness initiative task `b56c4e82`：
- final_evaluate event payload `{"final_e2e_verdict": "FAIL", "final_e2e_failed_scenarios": [...]}`
- 但 tasks.status = "completed"（错，应当 failed）

3 层 audit 后定位到 executor.js:2894。本 PR 修这一个根因，不动其他。

### 根本原因

`packages/brain/src/executor.js:2894` `runHarnessInitiativeRouter()` 返回 `ok: !final?.error`：
- 只看 `final.error` 是否存在
- 没看 `final.final_e2e_verdict`

而 `harness-initiative.graph.js` 的 finalEvaluateDispatchNode 在 verdict='FAIL' 时（line 1370-1379, 1422-1427 三个分支）**不设 error 字段**，只返 `verdictDelta`：
- final.error → undefined
- → !final?.error → true
- → ok = true
- → executor.js:2989 `if (result.ok) await updateTaskStatus(task.id, 'completed')` → 误标 completed

这是**协议不一致**的 bug：graph 节点用 verdict 字段表达"E2E 失败但不是异常"，executor 判定 ok 用 error 字段，两者不挂钩。

### 下次预防

- [x] 引入 `computeHarnessInitiativeOk(final)` 纯函数 — single source of truth 判定 ok：!error AND verdict !== 'FAIL'
- [x] 引入 `computeHarnessInitiativeError(final)` 纯函数 — 自动从 verdict=FAIL 拼装 meaningful error_message
- [x] reportNode 在 verdict=FAIL 时打 console.error 防御日志，task_events 留痕便于回归排查
- [x] 18 个 unit test 覆盖所有 verdict/error 组合 + null/undefined 防御 + 500-char 截断
- [x] 相邻 52 个 executor test 不破坏（regression check）

## 对比 Anthropic 推荐

Anthropic 官方 [Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps) 没直接讨论 verdict 传递，但隐含原则是"graph 节点 + orchestrator 必须共享同一 verdict 协议"。本 PR 把"verdict='FAIL' = task 失败"显式 codify 进 executor，符合该原则。

## 与 PR A 的关系

PR A（[CONFIG] harness skills 4 处对齐 Anthropic）修 generator schema drift 链条根因（Bug 1/2/4）。
PR B（本 PR）修 verdict 传递 bug（Bug 3）。
两 PR 互不依赖，并行合入。合完后派 W21 严 schema /multiply 重测验真 E2E 通过。

## 验收锚点

PR 合并后派 W21：
- 期望：generator 仍漂移 → reviewer/evaluator 抓住（PR A 修复路径）→ final_evaluate FAIL → executor.js 用 computeHarnessInitiativeOk 判 ok=false → task.status='failed'（本 PR 修复路径）
- 反例：之前 final FAIL 但 task=completed → 本 PR 修后不再发生
