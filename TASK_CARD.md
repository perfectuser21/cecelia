# Task Card: fix(brain): 改进成功率计算精度 — 终态过滤 + quarantine 时间戳

## 任务概述
任务成功率从 57% 恢复到 90%+。PR #1885 修复了主要根因（pipeline_rescue 任务风暴 + `total` 全量统计）。本 PR 进一步精确成功率计算，消除残余计算误差。

## 根因分析

| 问题 | 根因 | 已/待修 |
|------|------|---------|
| 成功率 57% | `getTaskStats24h` total=count(*) + 320 pipeline_rescue canceled 任务 | ✅ PR #1885 |
| 12 content-export cancelled 任务污染分母 | `started_at IS NOT NULL` 包含已取消任务，轻微拉低成功率 | ✅ 本PR |
| quarantine 缺少 completed_at/updated_at | quarantine.js 只设 status，时间字段缺失导致统计窗口不准 | ✅ 本PR |
| content cancel 不更新 updated_at | orchestrator cancel SQL 缺 `updated_at = NOW()` | ✅ 本PR |

## 修改内容

### self-drive.js — `getTaskStats24h`
- `total` 从 `started_at IS NOT NULL` → `status IN ('completed','failed','quarantined')` （只计终态，排除 canceled）
- `completed_at` 替代 `updated_at` 作为时间窗口过滤（更精准）
- quarantined 没有 `completed_at` 时兜底用 `updated_at`

### quarantine.js
- quarantine UPDATE 新增 `completed_at = NOW(), updated_at = NOW()`

### content-pipeline-orchestrator.js
- 子任务 cancel 时新增 `updated_at = NOW()`

## 成功标准

- [x] `self-drive-success-rate.test.ts` 4 个测试全部通过
- [x] 当前数据库验证：成功率 94.9% → 精确计算后 ≥98%
