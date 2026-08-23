# Red 证据 — listFailedExecutionTargets 时效窗口豁免

冻结合同测试已随 `chore(harness): import contract` 预置于分支，Red 阶段直接对当前（无时效窗口）实现执行：

```
$ vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts
total 5  passed 1  failed 4
```

- 4 failed：默认 2h 窗口 / env 覆盖 / 非法回退 / `>=` 内含语义——当前实现 SQL 无 created_at make_interval 谓词、params 只有两参，全红（符合预期）。
- 1 passed：`窗口内失败记录仍映射为执行目标保持记仇语义不变`（B-05 负向不变量守卫，RED/GREEN 均绿）。

符合合同 Test Contract 预期红证据「5 tests → 4 failed | 1 passed」。
