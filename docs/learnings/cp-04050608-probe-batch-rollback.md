---
branch: cp-04050608-890c8ba8-ae5c-4b69-ada0-2979ef
task: 监控闭环：capability-probe 批次失败 ≥5 自动触发 brain-rollback.sh
date: 2026-04-05
---

# Learning: capability-probe 批次失败阈值回滚

### 根本原因

PR #1898 只实现了"同一探针连续失败3次触发回滚"，但 PRD 还要求"同一批次总失败数 ≥ 5 立即触发回滚"这一更激进的批次级保护。两个机制互补：
- 连续失败（3次）= 探测持续性单点故障
- 批次失败（≥5）= 探测瞬时大面积崩溃

### 下次预防

- [ ] 实现多条件触发时，先检查批次级（更激进）再检查连续级（更保守）
- [ ] 批次回滚触发后应跳过连续失败检测（`return results` 提前退出）
- [ ] 导出内部阈值常量（ROLLBACK_BATCH_THRESHOLD）以便单元测试直接断言，避免通过读文件 hack 验证
- [ ] `vi.mock('fs', ...)` 全局 mock 时若只 mock 了 `existsSync`，`readFileSync` 会不可用 — 测试中需要用模块导入常量代替文件读取

### 修改清单

- `packages/brain/src/capability-probe.js`
  - 新增 `ROLLBACK_BATCH_THRESHOLD = 5`
  - `runProbeCycle` 中批次检查优先（先于连续失败检测）
  - 触发时发 P0 告警附带 `batch_failures` 字段
  - 导出 `ROLLBACK_BATCH_THRESHOLD` 和 `ROLLBACK_CONSECUTIVE_THRESHOLD`
- `packages/brain/src/__tests__/capability-probe-rollback.test.js`
  - 新增批次失败阈值测试套件（3 个测试）
