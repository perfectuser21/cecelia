# Learning: CI 质量门禁补齐 v14.3.2

**PR**: cp-04041707-ci-quality-gates  
**Date**: 2026-04-04

## 变更摘要

- 新增 `ci/scripts/check-contract-refs.sh` — CI 自动验证 regression-contract.yaml 测试引用
- 新增 `skills/dev/scripts/check-cleanup.sh` — /dev Stage 4 完工清理检查
- `ci.yml` engine-tests job 增加 Contract Refs Check 步骤
- `04-ship.md` 增加 4.0 完工检查步骤
- 清理 regression-contract.yaml 剩余 34 行幽灵引用（15 个不存在的测试文件）

### 根本原因

V13→V14 重设计（PR #1802）删掉了全部 devgate 体系（-12,299 行），包括 L1/L2/L3/L4 四层 CI。新 CI 只有基础 vitest + typecheck，没有引用完整性检查。此后每次 /dev PR 都可能带入幽灵引用，只能靠人工 audit sprint 发现和清理。

### 下次预防

- [ ] 每次改 engine 前先运行 `bash packages/engine/skills/dev/scripts/check-cleanup.sh`
- [ ] regression-contract.yaml 新增引用时，确认对应测试文件已存在再写入
- [ ] CI Contract Refs Check 失败时，优先删引用而非补测试文件（除非测试真的有价值）
