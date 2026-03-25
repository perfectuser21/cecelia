# Learning: CI scope 补全 — routing-map 路径扩展 + Brain-API 集成测试

**Branch**: cp-03251106-ci-scope-fix
**Date**: 2026-03-25

### 根本原因

CI routing-map.yml 的 `ci-helpers` 和 `ci-configuration` 使用具体文件列表而非 glob 模式，新增 `scripts/` 或 `ci/` 文件时不受路由保护，CI 不会对其触发检查。
这是一种"枚举式维护"陷阱——每次加新文件都需要手动更新路由表，容易遗漏。
同时 Brain-API proxy 层（parseIntent/parseAndCreate）缺少集成测试，proxy 配置错误（URL 错误、错误处理缺失）无法被 CI 捕获。
以上缺口源于 PR #1533 因落后 27 commit 被关闭，有效改动未能合入 main。

### 修复方案

1. `ci-helpers.paths` 改为 `scripts/**`（全量），`ci-configuration.paths` 改为 `ci/**`（全量）——新增文件自动覆盖，无需逐一添加
2. 新增 `brain-api-integration.test.ts`（6 cases）覆盖 parseIntent/parseAndCreate 的 200/500/503/网络错误场景，mock fetch 无需真实 Brain 服务

### 下次预防

- [ ] routing-map 路径优先使用 glob（`dir/**`），而非枚举具体文件——避免遗漏新增文件
- [ ] 新增 proxy 函数时同步新增集成测试（mock fetch），验证错误处理路径
- [ ] 废弃 PR 关闭前先提取有价值改动，用新 PR 补回，避免工作丢失
