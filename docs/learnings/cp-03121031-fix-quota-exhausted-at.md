---
branch: cp-03121031-fix-quota-exhausted-at
date: 2026-03-12
pr: 873
---

# Migration 版本号冲突导致字段静默缺失 → Brain degraded

## 根本原因

当两个 migration 文件争抢同一个版本号时，migrate.js 以 schema_version 表为准——先写入的赢，后写入的永远被跳过。表面上该版本"已应用"，实际上字段从没建。问题不会有任何错误提示，直到代码引用该字段才爆炸。

影响链：`column "quota_exhausted_at" does not exist` → execution-callback 全部失败 → 任务结果全丢 → Brain degraded。

## 修复方式

新建更高版本号的 migration（149）补建缺失字段，加 `IF NOT EXISTS` 保证幂等性。

**Why:** migration 145 版本号被 `brain_config quota_reset_at` 占用，`tasks.quota_exhausted_at` 字段缺失了数天。

**How to apply:** 当某功能字段缺失时，先对比 schema_version 表里该版本的 description 与 migration 文件内容——description 对不上即版本号冲突，需新建更高版本号补建。facts-check.mjs 的 `selfcheck_version_sync` 检查可以发现此类问题。
