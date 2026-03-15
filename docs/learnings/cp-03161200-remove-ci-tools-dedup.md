---
id: learning-remove-ci-tools-dedup
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
branch: cp-03161200-remove-ci-tools-dedup
changelog:
  - 1.0.0: 初始版本
---

# Learning: 删除 ci-tools/ 符号链接冗余目录

## 背景

`packages/engine/ci-tools/scripts/devgate/` 目录下的 6 个文件（check-dod-mapping.cjs、detect-priority.cjs 等）全部是符号链接，指向 `packages/engine/scripts/devgate/` 下的同名文件。这造成了两个并列路径引用同一套工具，维护时需要同步两处，存在误导性。

## 根本原因

### ci-tools/ 作为符号链接目录存在的历史原因

早期设计时，ci-tools/ 作为"CI 工具集合"的独立入口存在，但随着 scripts/devgate/ 成为唯一真实源，ci-tools/ 变成了纯粹的符号链接层，没有独立价值。

### VERSION 文件重复

`packages/engine/ci-tools/VERSION` 和 `packages/engine/VERSION` 内容相同，造成版本 bump 时需要更新 7 个文件（多了 ci-tools/VERSION）。

## 解决方案

1. 通过 `git rm -r packages/engine/ci-tools/` 彻底删除符号链接目录
2. 更新 `install-hooks.test.ts`：从引用 `ci-tools/VERSION` 改为 `packages/engine/VERSION`
3. 更新 `03-prci.md` 8.3.5 节：从"7 个文件"改为"6 个文件"，移除 ci-tools/VERSION 条目

## 下次预防

- [ ] 新增工具脚本时，只放在 `scripts/devgate/` 下，不创建符号链接层
- [ ] 版本文件 bump 规范：6 个文件（不含已删除的 ci-tools/VERSION）
- [ ] 删除符号链接目录时，检查所有测试文件是否引用了被删除的路径
