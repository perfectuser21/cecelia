# Learning: brain-unit CI OOM 修复

**分支**: cp-04061124-fix-brain-unit-oom
**日期**: 2026-04-06

## 问题描述

brain-unit CI job 因 OOM 崩溃，被设置了 `continue-on-error: true` 作为临时缓解，
导致 Brain 单元测试失败不阻断 PR 合并，CI gate 形同虚设。

### 根本原因

- `vitest.config.js` 配置 `maxForks: 2`，CI 命令也用 `--maxWorkers=2`
- 465 个测试文件，每个 fork 进程约消耗 20MB V8 堆内存
- 2 个并发 fork × 多文件并发 = 内存峰值超出 ubuntu-latest 7GB 限制
- `continue-on-error: true` 掩盖了问题，没有根治

### 修复方案

1. `packages/brain/vitest.config.js`：`maxForks: 2` → `maxForks: 1`
2. `.github/workflows/ci.yml` brain-unit job：
   - `--maxWorkers=2` → `--maxWorkers=1`（串行执行，内存峰值降低 50%）
   - `NODE_OPTIONS` 从 `3072` → `4096`（单 fork 有更多可用 heap）
   - 移除 `continue-on-error: true` 及相关注释
   - `timeout-minutes` 从 15 → 20（串行更慢，给足时间）

### 下次预防

- [ ] 新增测试文件时关注数量级变化，避免内存悄悄超限
- [ ] `continue-on-error: true` 只能作为临时救急，不能长期保留
- [ ] OOM 问题优先考虑降并发（maxForks），而非只调大 heap
