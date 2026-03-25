# Learning: CI scope 补全 — routing-map 路径扩展 + Brain-API 集成测试

**Branch**: cp-03251106-ci-scope-fix
**Date**: 2026-03-25

### 根本原因

CI routing-map.yml 的 `ci-helpers` 和 `ci-configuration` 使用具体文件列表而非 glob 模式，导致新增 `scripts/` 或 `ci/` 文件时不受路由保护（不触发相应 CI 检查）。同时 Brain-API proxy 层（parseIntent/parseAndCreate）缺少集成测试覆盖，proxy 配置错误无法被 CI 捕获。

这些缺口来自 PR #1533（落后 27 commit 后关闭），本次提取其中最有价值的两个改动重新实现。

### 修复方案

1. `ci-helpers.paths` 改为 `scripts/**`（全量），`ci-configuration.paths` 改为 `ci/**`（全量）——新增文件自动覆盖，无需逐一添加
2. 新增 `brain-api-integration.test.ts`（6 cases）覆盖 parseIntent/parseAndCreate 的 200/500/503/网络错误场景，mock fetch 无需真实 Brain 服务

### 下次预防

- [ ] routing-map 路径优先使用 glob（`dir/**`），而非枚举具体文件——避免遗漏新增文件
- [ ] 新增 proxy 函数时同步新增集成测试（mock fetch），验证错误处理路径
- [ ] 废弃 PR 关闭前先提取有价值改动，用新 PR 补回，避免工作丢失
