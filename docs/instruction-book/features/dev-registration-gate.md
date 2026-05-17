---
id: instruction-dev-registration-gate
version: 1.0.0
created: 2026-03-28
updated: 2026-03-28
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本，封堵孤岛 Day3-4
---

# Dev Registration Gate — 新功能强制注册门禁

## What it is

CI 自动检查机制。确保 `feat:` 类型的 PR 不会产生"孤岛"——即已部署但没有文档和集成测试的新功能。

两道门禁：
1. **L1 Instruction Book Gate**：`feat:` PR 必须更新 `docs/instruction-book/`
2. **L3 Integration Test Gate**：Brain `feat:` PR 必须包含集成测试

## Trigger

每个 `feat:` 类型的 PR 提交到 GitHub 时自动触发。

- L1 门禁：在 CI L1 Process Gate 中检查
- L3 门禁：在 CI L3 Code Gate 中检查

## How to use

### 满足门禁要求

**L1 说明书要求**：
在 `docs/instruction-book/features/` 或 `docs/instruction-book/skills/` 下创建或更新说明文件。

```markdown
# My New Feature — 功能名

## What it is
（一句话描述）

## Trigger
（什么时候触发）

## How to use
（具体用法）

## Output
（产出什么）

## Added in
PR #xxx
```

**L3 集成测试要求**（仅 Brain feat PR）：
在 `packages/brain/src/__tests__/integration/` 下创建或更新集成测试文件（`*.integration.test.js`）。

### 跳过门禁

如果是内部/基础设施功能，无需用户文档：

```
feat(brain): 优化内部调度算法 [SKIP-DOCS]
```

`[CONFIG]` 标签同样豁免两道门禁（CI/Engine 配置类 PR）。

## Output

- PR CI 通过：✅ L1 和 L3 门禁均 passed
- 缺少说明书：❌ L1 Instruction Book Gate FAILED — 请在 `docs/instruction-book/` 补充说明
- 缺少集成测试：❌ L3 Integration Test Gate FAILED — 请在 `packages/brain/src/__tests__/integration/` 补充集成测试

## Added in

PR #1644（封堵孤岛 Day3-4）
