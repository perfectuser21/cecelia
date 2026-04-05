# Learning: capability-probe 连续失败自动触发 brain-rollback.sh

## 背景
为监控闭环实现保守回滚门控：同一探针连续 3 次失败，或单批次 ≥5 探针失败，自动执行 brain-rollback.sh。

### 根本原因
之前 capability-probe 没有跨探测周期的状态记忆，每次探测独立告警，无法识别持续性故障，导致系统在连续劣化时缺乏自动恢复手段。

### 实现决策

1. **保守阈值**：consecutive=3、batch_total=5，单次失败只走 P2 告警不回滚。
2. **回滚限流**：30 分钟内至多触发一次，避免 Brain 重启后陷入滚动回滚死循环。
3. **状态隔离**：`_consecutiveFailures` 是纯内存 Map，Brain 重启后清零，不写 DB。这是有意设计——重启本身会中断连续失败链。
4. **execFile 异步非阻塞**：回滚脚本最长 90s，用 Promise 包装但不阻塞主 tick 循环——runProbeCycle 等待 rollback 完成后才继续，确保告警含真实状态。

### 下次预防

- [ ] 若回滚后连续失败依然累积（新版本也坏了），需要人工介入。考虑在 N 次失败后停止自动回滚并发 P0 escalation。
- [ ] `batch_total ≥ 5` 的条件要求 `failures.length > 1`（已加）避免单次失败误触批量阈值。
