---
id: learning-fix-ci-tools-version
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03141458-fix-ci-tools-version
---

# Learning: ci-tools/VERSION 必须随 Engine 版本 bump 同步（2026-03-14）

## Engine 版本 bump 第 7 个文件遗漏（2026-03-14）

### 根本原因

`install-hooks.sh` 从 `package.json` 读取版本写入 `.ci-tools-version`，
`tests/hooks/install-hooks.test.ts` 同时读取 `.ci-tools-version` 和 `ci-tools/VERSION` 进行对比验证。
每次 Engine 版本 bump 时，`ci-tools/VERSION` 未同步，导致两者不一致，测试失败。

### 下次预防

- [ ] **Engine 版本 bump 标准清单（7 个文件，缺一不可）**：
  1. `packages/engine/package.json`
  2. `packages/engine/package-lock.json`（两处：root + packages[""]）
  3. 根目录 `package-lock.json`（packages/engine 条目）
  4. `packages/engine/VERSION`
  5. `packages/engine/ci-tools/VERSION` ← 常被遗漏
  6. `packages/engine/.hook-core-version`
  7. `packages/engine/regression-contract.yaml`
