# Learning: CI Gate — 新增 hook/devgate 文件必须有 RCI 条目

**Branch**: cp-03231600-new-files-need-rci
**Date**: 2026-03-23
**PR**: #TBD

## 背景

新增 `packages/engine/hooks/` 或 `packages/engine/scripts/devgate/` 文件时，没有任何门禁检查这些文件是否已在 `regression-contract.yaml` 中注册 RCI 条目。新能力可以无 RCI 覆盖悄悄滑入生产。

## 解决方案

新增 `check-new-files-need-rci.cjs` + CI L2 `new-files-need-rci-check` job，在 PR 阶段强制检查。

### 根本原因

系统缺少"能力注册完整性"的自动门禁——新文件的 RCI 登记完全依赖人工自觉，没有任何机制在忘记时告警。

### 下次预防

- [ ] 任何新增 hook 或 devgate 脚本，必须在 `regression-contract.yaml` 中新增对应 `file:` 条目
- [ ] `check-new-files-need-rci.cjs` 自身已在 `regression-contract.yaml` 中注册（`DEVGATE-NEW-FILES-RCI-001`），确保门禁本身受 RCI 保护
- [ ] CI L2 三重降级保护：无新增文件 / 无目标路径文件 / 脚本缺失 → 均降级 exit 0，不因自身问题阻断 CI

## 关键设计决策

1. **文件匹配方式**：`scanMissingRci` 接受 repo 根目录相对路径，内部转换为 `packages/engine/` 相对路径与 contract 的 `file:` 字段匹配
2. **三重降级**：无新增文件 → skip；无目标路径 → skip；脚本缺失 → skip（宽容失败，不阻断其他 PR）
3. **测试模式**：`module.exports + if (require.main === module)` 与 `createRequire(import.meta.url)` 组合，与 whitelist check 保持一致

## 覆盖率

- 测试文件：`packages/engine/tests/scripts/check-new-files-need-rci.test.ts`
- 测试数量：20 个
- 覆盖场景：TARGET_DIRS 定义、toRelativePath、extractRciFiles、scanMissingRci 通过/拦截/格式验证
