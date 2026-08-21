# Red 证据 — publisher 进 INFRA_RETRY_ACTION_BY_ROLE

冻结测试首跑（实现未加 publisher 条目前）：3 failed / 4 passed。
失败的 3 条正是 publisher 的 runner_failure / infrastructure_blocked / account_exhausted 落 *_route_unknown。

```

 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
   Start at  22:36:36
   Duration  471ms (transform 98ms, setup 0ms, collect 106ms, tests 15ms, environment 0ms, prepare 125ms)

```
