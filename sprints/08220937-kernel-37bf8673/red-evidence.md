# RED 证据 — publisher runner_failure 有界重派（改前）

命令: npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js --no-cache --reporter=basic

```
     → expected { phase: 'review', …(2) } to match object { phase: 'publish', …(2) }
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js > F1 step3 r45 — publisher runner_failure 有界重派，不再 route_unknown > publisher runner_failure（首次 priorRunnerFailures=0）→ 重派 publish，返回 callback_runner_failure_retry
AssertionError: expected { phase: 'review', …(2) } to match object { phase: 'publish', …(2) }
-   "action": "publish:approved_ref",
+   "action": "wait:human_review",
+   "reason": "callback_runner_failure_route_unknown",
     52|       action: 'publish:approved_ref',
      Tests  1 failed | 3 passed (4)
```

结论: 首个用例（publisher 首次 runner_failure）RED 失败 — derive 返回 reason=callback_runner_failure_route_unknown（bug 症状），符合预期。补 publisher 路由条目后转 GREEN。
