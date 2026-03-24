# Learning: 清理重复 check-manual-cmd-whitelist.cjs

**Task**: cp-03242032-fix-engine-whitelist-cleanup
**Date**: 2026-03-24

## 问题描述

verify-step.sh 在 main 分支第一次调用时报 `MODULE_NOT_FOUND`，根因是 `scripts/devgate/check-manual-cmd-whitelist.cjs` 是从未被 git 追踪的游离文件（正确位置在 `packages/engine/scripts/devgate/`）。该文件可能在某次手动调试中被误置于根目录 `scripts/devgate/` 下。

### 根本原因

未追踪的重复文件导致 Node.js 模块解析混乱。verify-step.sh 的路径搜索顺序决定了哪个文件被加载，而未追踪的副本位于优先搜索路径，造成 MODULE_NOT_FOUND（因为该副本内容不完整或缺少依赖）。

### 下次预防

- [ ] 每次在 `scripts/devgate/` 放新文件时，立即检查 `git status` 确认已追踪
- [ ] verify-step.sh 路径搜索逻辑已正确包含两个路径，不需要修改
- [ ] 正确位置固定为 `packages/engine/scripts/devgate/`，根目录 `scripts/devgate/` 仅存放已追踪脚本

## 修复方式

删除未追踪的重复文件 `scripts/devgate/check-manual-cmd-whitelist.cjs`（该文件从未被 git 追踪，直接删除无需 revert）。
