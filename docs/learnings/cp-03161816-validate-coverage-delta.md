---
id: learning-cp-03161816-validate-coverage-delta
version: 1.1.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
  - 1.1.0: 补充实际验证发现——第三方 action 分支不存在问题
---

# Learning: 验证 coverage-delta CI job

## 任务概要

创建最小化 feat Brain PR（新增 format-bytes.js 工具函数 + 测试），验证 coverage-delta CI job 端到端正常工作。

## 根本原因

coverage-delta job 在 PR #985 中实现但未经实际 feat PR 验证。本次验证发现两个问题：

1. `check-dod-mapping.cjs` 不接受 `manual:ls` 格式，`[ARTIFACT]` 条目需用 `manual:node -e "..."` 或 `manual:bash` 命令。
2. `anuraag016/Jest-Coverage-Diff@main` 第三方 GitHub Action 无法解析（`main` 分支不存在于该 repo）。

## 验证结果

| 检查项 | 结果 |
|--------|------|
| brain-unit 测试（10 个 format-bytes 测试） | ✅ 通过 |
| DoD Mapping 检查 | ✅ 通过（修复路径和命令格式后）|
| L2 Consistency Gate | ✅ 通过 |
| L4 Runtime Gate | ✅ 通过 |
| coverage-delta action | ❌ `anuraag016/Jest-Coverage-Diff@main` 无法解析 |

**修复**：给 coverage-delta job 加 `continue-on-error: true`，避免第三方 action 问题阻塞合并。后续需替换为可靠的实现。

## 技术要点

### format-bytes.js 测试设计

- 10 个测试覆盖所有分支：零值/各量级（B/KB/MB/GB/TB）/小数位/负数异常
- 使用 `parseFloat(value.toFixed(n))` 去除尾零（如 `1.0 KB` → `1 KB`）
- 纯函数，无外部依赖，vitest 运行无需 mock

### DoD 命令格式规则

- `[ARTIFACT]` 条目不能用 `manual:ls`，要用 `manual:node -e "require('fs').existsSync('...')||process.exit(1)"`
- `[BEHAVIOR]` 条目可以用 `manual:bash -c "..."`

### 第三方 GitHub Action 注意事项

- 引用第三方 action 时必须用 pinned tag 或 commit SHA（如 `@v3`），不要用 `@main`
- `@main` 分支可能不存在于第三方 repo（他们可能用 `@master` 或 tag）
- 关键路径上的 CI job 如依赖第三方 action，应加 `continue-on-error: true` 作为保护

## 下次预防

- [x] 新 CI job 实现后，应在同一 PR 或立即跟进 PR 做端到端验证
- [ ] 替换 `anuraag016/Jest-Coverage-Diff` 为自研 coverage delta 脚本（避免第三方 action 依赖）
- [ ] CI workflow 中第三方 action 引用必须用 pinned tag/SHA，不得用 `@main`/`@master`
- [ ] coverage-delta 替换后移除 `continue-on-error: true`
