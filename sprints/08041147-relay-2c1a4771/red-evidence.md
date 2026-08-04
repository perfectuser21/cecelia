# Red 证据（generator commit 1，relay 常态：合同测试已随 contract import 存在，不重复 checkout）

命令：`NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/ --reporter=verbose`
执行时间：2026-08-04（generator 本机，真 Postgres cecelia_test + 真 executor.js 模块 + 真 ps，零 mock）

## 结果：Tests 4 failed | 2 passed (6) — 与合同 Test Contract 表「Red 实测证据」逐条一致

| it() | 结果 | 失败原因（现状） |
|---|---|---|
| 从未启动任务…watchdog_kill.reason 为 never_started | × FAIL | 现返 `process_disappeared` 兜底 |
| 从未启动任务已有 error_message 与 payload.failure_class=missing_anchor 不被 watchdog 记账覆盖 | × FAIL | 联合分类断言（reason 现为 process_disappeared） |
| 回归：曾启动任务…仍判 process_disappeared | ✓ PASS | 回归护栏，现状即绿（防误改） |
| 从未启动任务的 failure learning 文本含真实根因标签 never_started 且不含 liveness_dead 假标签 | × FAIL | 现 title/content 取 requeue 通道参数：`…[liveness_dead] Watchdog killed task after 1 attempts. Reason: liveness_dead` |
| 边界：started_at=null 但存在进程日志…不判 never_started | ✓ PASS | 边界护栏，现状即绿（钉死判定面不扩大） |
| never_started 失败文本不落 transient 环境重试通道 | × FAIL | 现命中 TRANSIENT_PATTERNS `/\[watchdog\]/i` 误判 `transient` |

> 说明：2 条 passed 为合同显式声明的「回归/边界护栏」性质测试（Test Contract 表标注「现状绿（已实测）」），
> 非实现性断言；4 条实现性断言全红，符合 TDD Red 要求。

## 关键失败输出摘录

```
AssertionError: expected 'process_disappeared' to be 'never_started'
AssertionError: expected 'Task Failure: liveness-learning 保真 fi…' to contain 'never_started'
  + Received: Task Failure: liveness-learning 保真 fixture 1785819576434 [liveness_dead] Watchdog killed task after 1 attempts. Reason: liveness_dead
AssertionError: expected 'transient' not to be 'transient'
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```
