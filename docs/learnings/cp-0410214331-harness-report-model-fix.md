# Learning: Fix harness_report model Haiku→Sonnet in FALLBACK_PROFILE

**分支**: cp-0410214331-61ee6935-278c-424c-a929-726f55
**日期**: 2026-04-11
**任务**: 61ee6935-278c-424c-a929-726f5537fae1

### 根本原因

`FALLBACK_PROFILE`（DB 不可用时的默认值）中 `harness_report.anthropic` 硬编码为 `claude-haiku-4-5-20251001`，导致 DB 降级场景下 harness_report 任务用 Haiku 跑，产出 0 字节。DB active profile 早已正确（`claude-sonnet-4-6`），但代码常量未同步。

### 下次预防

- [ ] 每次 DB profile 更新后，同步检查 FALLBACK_PROFILE 常量是否一致
- [ ] harness pipeline 任务（planner/propose/review/generate/fix/report）的模型分配：GAN 三件套 Opus，Generator/Report/Fix 用 Sonnet
- [ ] 新增 harness 类型任务时，FALLBACK_PROFILE 和 DB profile 必须同时写入
