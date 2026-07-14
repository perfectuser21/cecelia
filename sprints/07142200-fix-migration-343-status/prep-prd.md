# Bug PrepPRD：migration 343 status CHECK 窄枚举 → 生产 Gate3 部署失败

## 症状
#3900 合并后 Gate3 部署失败：[FAIL] 343_journey_features_guard_ref.sql: check constraint violated by some row（23514）。生产停在 1.261.0。

## 根因
343（blade3-T4 #3899）重建 journey_features_status_check 时枚举只写了 planned/building/done/deprecated/live，漏了生产真实在用的 working（28 行）/broken（3 行）。CI 空库全绿、生产真数据炸——"整机层×真实状态"盲区在部署链上的又一次实证（本日 Ops 半环 PRD 环3/环4 活教材）。staging/preview 已 apply 窄版（数据恰好无 working/broken 才侥幸通过）。

## 修法
1. 343 原文改宽（未 apply 的库=生产，直接得宽版；migrate.js 按版本号追踪无 checksum，改文安全）
2. 新增 344 幂等拓宽（兜住已 apply 窄版的 staging/preview）
3. selfcheck EXPECTED_SCHEMA_VERSION 343→344；版本 bump 1.262.1；DEFINITION.md 对齐

## Regression Test 计划
守卫已 proven-to-fire：生产部署本身就是把它打红的那次。344 的 DoD 断言 + 部署成功即绿。

## 验收标准
- [x] DoD.md 各断言绿
- [ ] CI 全绿 merge
- [ ] Gate3 重跑成功，生产 /health version=1.262.1
