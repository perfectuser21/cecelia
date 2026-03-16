---
version: 1.0.0
created: 2026-03-16
---

# Learning: CI M2 — 新 Brain API Endpoint 必须有 RCI 回归契约

## 背景

CTO 诊断发现 regression-contract.yaml 为空，新增 API 路由时无任何机制要求补充契约。

## 做了什么

新增 `scripts/devgate/check-new-api-endpoints.mjs`，在 L2 brain-l2 job 中自动检测 PR diff 中的新路由，并验证 regression-contract.yaml 是否有对应覆盖。

## 关键设计决策

- **仅检查 diff 中的新增行**（不对现有 264 个路由追溯），降低迁移成本
- **支持前缀匹配**：契约中 `/api/brain/tasks` 可覆盖 `/api/brain/tasks/:id`
- **无新路由 = 直接通过**：不影响非 Brain 改动的 PR

### 根本原因

CI 迭代过程中专注流程门禁，忽略了"新代码 + 对应契约"的配对要求，导致 API 覆盖率静默恶化。

### 下次预防

- [ ] 新 Brain API 端点 PR 必须同时更新 regression-contract.yaml（L2 强制）
- [ ] `check-new-api-endpoints.mjs` 使用 git diff 而非全量扫描，性能好
- [ ] 脚本提供自动生成的契约模板，降低补充成本
