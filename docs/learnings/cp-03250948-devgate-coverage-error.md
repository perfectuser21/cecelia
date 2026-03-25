# Learning: Devgate 覆盖率检查 warning→error 升级

**Branch**: cp-03250948-devgate-coverage-error
**Date**: 2026-03-25
**Task**: ae088bc4-3fc9-4d43-9746-edf84bd75199

## 根本原因

`check-coverage-completeness.mjs` 的 devgate 脚本覆盖率检查使用统一 warning 级别，导致高风险脚本（如 `check-dod-mapping`）即使缺少测试也不会阻断 CI。

## 解决方案

采用白名单机制（`HIGH_RISK_DEVGATE_SCRIPTS`）：
- 高风险脚本缺测试 → error（exit 1，CI 阻断）
- 低风险脚本缺测试 → warning（非阻断，渐进改善）

## 下次预防

- [ ] 添加新的 devgate 高风险脚本时，同步更新 `HIGH_RISK_DEVGATE_SCRIPTS` 白名单
- [ ] `check-dod-mapping.cjs` 等关键脚本的测试使用 `writeDodInsideRepo()` 在 git repo 内创建临时文件，而非系统 tmpdir（避免 projectRoot 解析失败）
- [ ] Task Card 文件名应为 `.task-{GITHUB_HEAD_REF}.md`（单层，不要双重前缀）

## 关键发现

1. `check-dod-mapping.cjs` 用 DoD 文件路径向上找 `.git` 确定 `projectRoot`，所以测试必须在 git repo 内创建临时目录
2. `tests/` 格式路径解析相对于 git 仓库根目录，不是 engine 目录，因此需要用 `packages/engine/tests/devgate/xxx.test.ts` 完整路径（或改用 `manual:` 格式）
3. CI 查找 DoD 文件的规则：`.task-{GITHUB_HEAD_REF}.md` → `.dod-{GITHUB_HEAD_REF}.md` → `.dod.md`
