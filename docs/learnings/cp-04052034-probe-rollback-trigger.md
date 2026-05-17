# Learning: cp-04052034-probe-rollback-trigger

日期: 2026-04-05

## 任务摘要

在 `capability-probe.js` 中实现监控闭环：当探针连续失败达到阈值（3次）时，自动执行 `brain-rollback.sh` 并通过飞书 P0 告警通知结果。

## 设计决策

1. **DB 级别持久化而非内存计数**：连续失败计数通过查询 `cecelia_events` 表历史记录实现，Brain 重启后不丢失状态，比内存变量更可靠。

2. **保守阈值（3次）**：1小时间隔的探针，3次连续失败 = 至少3小时持续异常，排除了瞬时抖动。单次失败只告警，不回滚。

3. **同批次只触发一次回滚**：`break` 确保同一批次多个探针达到阈值时只执行一次回滚，避免重复。

4. **spawnSync 同步执行**：防止 Brain 进程在回滚过程中继续调度其他任务，确保回滚过程的原子性。

5. **脚本不存在时降级**：`existsSync` 检查后再执行，不崩溃只记录错误，适应不同部署环境。

## 根本原因（测试层面）

ESM 静态绑定导致 `vi.spyOn(module, 'runProbes')` 无法拦截 `runProbeCycle` 内部对 `runProbes` 的直接调用。

### 解决方案
集成测试改为直接调用 `checkConsecutiveFailures` + `executeRollback` + `raise` 的联动逻辑，复现 `runProbeCycle` 的回滚触发路径，绕过 ESM 绑定限制。

## 下次预防

- [ ] ESM 模块内部函数调用无法被 `vi.spyOn` 拦截 — 如需测试内部逻辑联动，直接测试导出函数的组合，不要试图 mock 内部调用
- [ ] 新增 Brain 自愈机制时，在代码注释中说明"此处不能 spy 内部调用"，方便下次写测试
- [ ] `raise('P0', ...)` 的 eventType 要在测试中精确匹配（包含 'trigger'/'result' 关键字），方便区分两条告警
