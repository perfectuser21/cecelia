# Red 证据（commit 1，修复前）

毕业测试 packages/brain/src/__tests__/integration/liveness-queued-never-spawned.integration.test.js 修复前运行：

```
 ✓ src/__tests__/integration/liveness-queued-never-spawned.integration.test.js > queued 未 spawn 任务 liveness 假杀修复 [BEHAVIOR] > 护栏：带派发失败回执（error_message）的从未启动任务仍分类 never_started
 ✓ src/__tests__/integration/liveness-queued-never-spawned.integration.test.js > queued 未 spawn 任务 liveness 假杀修复 [BEHAVIOR] > 护栏：曾启动任务（started_at 非空 + 进程日志存在）进程消失仍判 process_disappeared
 ✓ src/__tests__/integration/liveness-queued-never-spawned.integration.test.js > queued 未 spawn 任务 liveness 假杀修复 [BEHAVIOR] > 护栏：曾启动任务（started_at 非空 + 进程日志存在）进程消失仍判 process_disappeared 497ms
 FAIL  src/__tests__/integration/liveness-queued-never-spawned.integration.test.js > queued 未 spawn 任务 liveness 假杀修复 [BEHAVIOR] > headed_manual=true 零留痕未 spawn 任务双确认探测后不被打 watchdog_kill 且不置 failed
 FAIL  src/__tests__/integration/liveness-queued-never-spawned.integration.test.js > queued 未 spawn 任务 liveness 假杀修复 [BEHAVIOR] > 非 headed 未 spawn 任务被 watchdog 处置后 task_events 表有留痕行
      Tests  2 failed | 2 passed (4)
```

合同预期 Red：2 条核心 it 失败（headed_manual 假杀 + task_events 零留痕），2 条护栏 it 现状 Green（never_started 带回执分类 + process_disappeared 捕获）。实际：2 failed | 2 passed，与合同 Test Contract 预期红证据完全一致。
