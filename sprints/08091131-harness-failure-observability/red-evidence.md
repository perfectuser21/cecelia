# Red Evidence — commit 1 (TDD Red)

合同测试随 contract import 已落盘 sprints 目录，实现尚未编写，跑测试全红：

```
failedTests=3 passed=1 total=4 failedSuites=1 totalSuites=5
- harness-failure-class.test.js: import ../lib/harness-failure-class.js 失败（模块未实现）→ suite error
- failure-stats-route.test.js: GET /failure-stats 未注册 → 404 → 2 fail
- failure-class-gate.test.js: gate 脚本不存在 → node exit1；clean fixture 期望 exit0 → fail
- harness-terminal-write.integration.test.js: markHarnessTerminal 未实现（真 PG，evaluator 阶段跑）
```
