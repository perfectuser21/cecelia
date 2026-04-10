---
id: harness-evaluator-skill
description: |
  [DEPRECATED] harness-evaluator 已被 CI 替代。
  架构决策（2026-04-09）：CI 本身就是机械执行器，独立 evaluator agent 是多余的。
  此 SKILL.md 保留仅作历史记录，harness_evaluate task_type 已从 execution.js 移除。
version: 4.2.0
created: 2026-04-08
updated: 2026-04-10
changelog:
  - 4.2.0: [DEPRECATED] CI 替代 harness_evaluate，此 skill 不再使用
  - 4.1.0: 机械执行器（读合同命令执行）
  - 4.0.0: 错误版本 — 改为读 PR diff 静态验证
---

# ⛔ DEPRECATED — 此 Skill 已废弃

**替代方案**：CI（GitHub Actions）

**原因**：harness_evaluate 作为独立 agent 有根本性问题：
- 在 PR merge 前运行，但测试依赖 live Brain（merge 后才有新代码）
- 导致第一次 evaluate 必然 FAIL，陷入死循环

**架构决策（2026-04-09）**：
CI 本身就是机械执行器。Generator 的 /dev Stage 3 等待 CI，Stage 4 merge。
`harness_evaluate` task_type 已从 `packages/brain/src/routes/execution.js` 移除。

如需重新引入 post-merge evaluation，请新建 SKILL.md 而非复活此文件。
