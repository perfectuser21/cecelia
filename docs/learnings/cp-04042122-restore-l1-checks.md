---
branch: cp-04042122-restore-l1-checks
date: 2026-04-04
---

# Learning: 恢复 L1 质量检查

### 根本原因

PR #1802 以"精简 CI"为目的删除了 12,299 行代码，其中包含三个有价值的 L1 质量检查（分支命名/DoD格式/feature-registry同步）。这些检查是轻量的门禁规则，不依赖外部服务，不应被一起删除。

### 下次预防

- [ ] 大规模删除 CI 配置时，区分"过于复杂/有问题的检查"和"轻量门禁规则"，后者应保留
- [ ] feature-registry 同步检查、分支命名检查是零依赖的 bash 检查，维护成本极低，不应删除
- [ ] DoD 格式检查需设计为"可选"（无 task-card.md 时跳过），不强制每个 PR 都有 DoD 文件

### 技术决策

1. `branch-naming` job 独立存在（不并入 pr-size-check），保持单一职责
2. DoD 格式检查放在 `engine-tests` job 末尾（engine 变更时才运行），因为 DoD 主要约束 engine 开发流程
3. feature-registry 同步检查也放在 `engine-tests` job（只对 engine/skills 变更触发）
4. `check-dod-mapping.cjs` 在 engine/scripts/devgate/ 目录下不存在，改用内联 bash 脚本实现
5. `main`/`develop` 等基础分支跳过命名检查，避免 main 直推时 CI 误报
