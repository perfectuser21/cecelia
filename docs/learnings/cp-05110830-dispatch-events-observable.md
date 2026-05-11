# Learning: dispatch_events 真写入 (B6)

**Branch**: cp-05110830-dispatch-events-observable
**Date**: 2026-05-11

## 根本原因

`recordDispatchResult` 函数只向 `working_memory`（JSONB 滚动窗口）写入统计，从未 INSERT 到 `dispatch_events` 专用表。`dispatch_events` 表虽然建好了（含 CHECK constraint `event_type IN ('dispatched','failed_dispatch','skipped')`），但 Brain 源码从未调用 INSERT——导致表永远为空、dispatcher silent-skip 完全无可观察性。

## 发现过程

- `grep recordDispatchResult packages/brain/src/dispatch-stats.js` → 只有 `working_memory` UPSERT
- `PGPASSWORD=cecelia psql ... \d dispatch_events` → 表存在、schema 完整
- `SELECT count(*) FROM dispatch_events` → 0 rows（W28 排队 30 min 无任何记录）

## 修复方案

1. **`dispatch-stats.js`**：`recordDispatchResult` 新增第 5 参数 `taskId`，在 working_memory 写入前先 INSERT `dispatch_events (task_id, event_type, reason, created_at)`
2. **`routes/dispatch.js`**：新 route 文件，导出 `buildRecentDispatchEventsHandler(pool)`（便于注入测试），实现 `GET /dispatch/recent?limit=20`
3. **`routes.js`**：注册 `dispatchRouter`
4. **`dispatch-stats.test.js`**：更新现有测试 mock 序列（+1 mock call for INSERT），call index 从 `[1]` 更新为 `[2]`

## 下次预防

- [ ] 新增 DB 表后，立即检查对应业务代码是否有真实 INSERT（不能只建表不写数据）
- [ ] `dispatch_events` 类似的"审计表"应在 migration 注释中标注"写入者: dispatch-stats.js"
- [ ] 现有测试用硬编码 call index（`mock.calls[1]`）对新 DB 操作脆弱，考虑用 `calls.find(c => c[0].includes('INSERT INTO working_memory'))` 替代索引

## 影响

- `dispatch_events` 现在每次 dispatch 决策（success/fail + reason）均持久化
- `GET /api/brain/dispatch/recent` 提供即时诊断入口
- W28 排队静默问题今后可通过 `SELECT * FROM dispatch_events ORDER BY created_at DESC LIMIT 50` 立即定位
