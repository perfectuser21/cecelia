# Learning: 内容生成引擎 v1 — 禁用开关与 KR 对齐

**Branch**: cp-04080735-dd0b1f0f-7d88-4c30-9377-f20c93
**Date**: 2026-04-08

### 根本原因

PR #2042 以"质量差"为由将 topic-selection-scheduler 的 `DISABLED` 设为 `true`，同时
将 `MAX_DAILY_TOPICS` 保留在 10（是 KR 目标 5 的 2 倍）。但实际验证显示：

1. 内容流水线 6 阶段端到端均正常（2026-04-08 当日产出 20+ 条内容）
2. Abstract 选题（如"老板时间回收力"）也能产出高质量长文（6554 字节，结构完整）
3. Solo-company-case notebook_id（`1d928181-...`）已修复，NotebookLM 正常调研
4. 禁用导致 KR「AI每天产出≥5条」无法自动达成

### 下次预防

- [ ] 禁用/限制 Brain 核心自动化功能前，先用生产数据验证"质量差"的具体指标
- [ ] `MAX_DAILY_TOPICS` 应始终与 KR 目标值（5 条/天）对齐，不要使用 10 的默认值
- [ ] 「禁用 + 修复」类 PR 应在标题注明预期影响（如 `[DISABLE]`），便于后续追踪
- [ ] 每次修改选题调度器后，检查 `topic_selection_log` 实际产出数量是否符合预期
