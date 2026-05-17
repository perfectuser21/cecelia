# Learning: harness pipeline 废弃 evaluate 链路 + BRAIN_QUIET_MODE 覆盖 desire/scan

### 根本原因

1. **execution.js 代码落后于架构决策**：2026-04-09 决策已明确砍掉 harness_evaluate/ci_watch/deploy_watch，但代码未更新，导致 harness_generate 完成后仍创建 harness_ci_watch，触发废弃的 evaluate → fix 循环。

2. **BRAIN_QUIET_MODE 覆盖不完整**：tick.js 中 `runDesireSystem`（含 reflection）和 `triggerCodeQualityScan` 未加保护，quiet mode 下仍消耗 LLM 调用额度。

### 下次预防

- [ ] 每次做架构决策后，立即检查 execution.js 的链路代码是否已跟上
- [ ] BRAIN_QUIET_MODE 新增保护点时，用 grep 全局搜索 tick.js 中所有 LLM 调用点确认全覆盖
- [ ] 架构决策记录在 memory 后，同步更新注释说明哪些 task_type 已废弃
