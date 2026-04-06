# Learning: brain-unit CI OOM 修复 — maxForks=1 + 移除 continue-on-error

**任务**: 修复 brain-unit CI OOM 导致 CI gate 失效
**PR**: cp-04052122-22699912-b598-415f-9938-847665
**日期**: 2026-04-06

---

### 根本原因

`brain-unit` job 因 OOM 加了 `continue-on-error: true`，导致测试失败时 CI 仍显示绿色，CI 门禁完全失效。根源是 `maxForks: 2` 时两个 Worker 同时持有大量模块缓存（406文件 × ~20MB），总内存超过 ubuntu-latest 7GB 限制。

### 修复方案

1. `vitest.config.js`: `maxForks: 2 → 1`（串行执行，彻底消除 OOM）
2. `ci.yml` brain-unit job: 删除 `continue-on-error: true` 及相关注释
3. `ci.yml` NODE_OPTIONS: `3072 → 4096`（给单 Worker 更多余量）
4. `ci.yml` `--maxWorkers=2 → --maxWorkers=1`（与 maxForks 保持一致）

### 下次预防

- [ ] 加 `continue-on-error` 之前先考虑是否有更根本的修复方案
- [ ] OOM 问题应优先降低并发（maxForks=1），而不是掩盖失败
- [ ] CI gate 失效（continue-on-error）是技术债，应立即追踪修复
