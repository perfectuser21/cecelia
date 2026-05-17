# Harness Working Skeleton — Feature-Driven 孤岛问题解法（2026-05-06）

## 根本原因

feature-driven 开发模式下，每个 Task 独立测试互不依赖，最终没有一条链路端到端跑通。
具体症状：大量功能点完成但无法演示任何完整 User Journey。

## 解法

三层叠加强制 Skeleton First：
1. **Skill 层**：harness-planner v7 强制 `tasks[0]` 为 skeleton task（依据 journey_type 模板），harness-contract-proposer v6 输出 E2E 测试，harness-generator v6 允许 stub 但需注释
2. **Brain 层**：migration 265 将 journey_type 持久化到 `initiative_runs`，避免 Proposer/Generator 靠记忆推断
3. **CI 层**：skeleton-shape-check.cjs 机械校验测试文件 pattern 与 journey_type 匹配

## 下次预防

- [ ] 新 Initiative 产出 task-plan.json 时，确认 `tasks[0].is_skeleton === true` 且 `depends_on: []`
- [ ] 新增 journey_type 类型时，同步更新 skeleton-shape-check.cjs 的 PATTERNS 对象
- [ ] CI `continue-on-error: true` 观察期 1 周后检查，确认无误报后删除该行切硬门禁
- [ ] migration 文件编号在创建前先 `ls migrations/ | sort | tail -3` 确认无冲突
