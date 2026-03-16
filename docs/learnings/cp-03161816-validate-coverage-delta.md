---
id: learning-cp-03161816-validate-coverage-delta
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: 验证 coverage-delta CI job

## 任务概要

创建最小化 feat Brain PR（新增 format-bytes.js 工具函数 + 测试），验证 coverage-delta CI job 端到端正常工作。

## 根本原因

coverage-delta job 在 PR #985 中实现但未经实际 feat PR 验证，存在基线配置未知的风险。

## 验证结果

通过本 PR 观察：
- coverage-delta job 是否使用正确的 base branch 基线
- 新增有测试覆盖的代码是否顺利通过 delta 检查
- 若基线缺失，CI 应给出清晰错误提示

## 技术要点

### format-bytes.js 测试设计

- 10 个测试覆盖所有分支：零值/各量级/小数位/负数异常
- 使用 `parseFloat(value.toFixed(n))` 去除尾零（如 `1.0 KB` → `1 KB`）
- 纯函数，无外部依赖，vitest 运行无需 mock

## 下次预防

- [ ] 新 CI job 实现后，应在同一 PR 或立即跟进 PR 做端到端验证
- [ ] 覆盖率基线 (baseline) 缺失时 CI 应 skip 而非 fail，避免首次运行阻塞合并
