---
branch: cp-04041538-harness-official
task_id: c962ad72-bdbe-4d1e-8fa7-41dc37b83f0a
created: 2026-04-04
---

# Learning: Harness v2.0 官方1:1复刻

### 根本原因

Harness v2.0 第一版（PR #1835~#1845）只实现了 Layer 3（代码对抗），并且用 /architect M2（读代码+拆Sprint）冒充 Layer 1（Planner）。这导致：

1. Planner 做了太多：读代码、写架构文档、预先规划所有Sprint并注册到Brain
2. 完全缺失 Sprint Contract 协商层（官方 Layer 2）
3. Sprint 数量预先固定，不是从对抗中自然涌现

官方 Anthropic Harness 的核心创新在于**两层对抗**：
- Layer 2：合同协商对抗（在写代码之前对齐标准）
- Layer 3：代码对抗（验证实现是否符合标准）

Layer 2 的存在是为了避免"Generator 自己写合同自己实现"——这等于去掉了外部标准，质量门禁形同虚设。

### 下次预防

- [ ] 实现任何对抗循环时，先确认"提议方"和"审查方"是否真的分离（不能是同一方既提议又执行）
- [ ] Planner 的职责边界：输入=需求，输出=PRD，没有其他职责
- [ ] Sprint 数量不能预先规划——流程本身决定何时结束（Generator 通过 more_sprints 字段声明）
- [ ] 新增 task type 时，同时更新：task-router.js / execution.js / executor.js / token-budget-planner.js / migration / skill
