# Learning — POST /api/brain/tasks prd 字段 fallback 漏

分支：cp-0422084553-task-api-prd-fallback
日期：2026-04-22
Task：fc6930db-6980-4763-b628-a3aed754d181
前置：#2509（arch-review 源头）+ #2511（runtime muted）+ #2513（Dashboard toggle）

## 背景

P0 pre_flight_burst 飞书轰炸在 PR #2509 后**仍然发生**。Alex 今天发现
夜里到早上一直在推送 "24h 内 21 个任务被 pre-flight 拒绝"。昨晚
"解锁" plist env 时没让 Alex 切 Dashboard toggle，所以 Brain
runtime muted 回到 false 状态 —— 飞书全程在发。

## 根本原因

PR #2509 只堵了 **arch-review task 源头**（daily-review-scheduler 写
payload.prd_summary），但 **POST /api/brain/tasks handler 本身漏写
prd 字段 fallback**。

当调用方传 `{title, prd}`（常见模式 —— Claude / Agent / 手工 curl 都
这么写）时，prd 字段被 destructure 丢弃，description=null → pre-flight
拒 → 累积 ≥ 3 条触发 P0 告警。

实测存量：24h 内 21 条（多数是 `curl POST /api/brain/tasks -d '{"title":...,"prd":...}'` 注册的 dev task）。

## 本次解法

两件事一起：

1. **堵源头**：task-tasks.js C2 normalize 段 fallback 链从 2 层扩
   成 3 层（description > payload.prd_summary > prd）。destructure 加
   prd 字段。不改 API 公开契约，只是接受更多输入形式。

2. **清存量**：migration 243 移除 `metadata.pre_flight_failed` 和
   `metadata.failed_at` 两个 key（幂等）。保留 task 原 status/title/
   description 作审计痕迹。清完后 alertOnPreFlightFail 的 24h COUNT
   自然降到 0，P0 告警不再被持续触发。

## 设计决策

**为什么 migration 只清 metadata 不改 status**：
- status='failed' 可能有其他原因（不只 pre-flight）
- 误改 status 会让 Brain 的其他监控（比如 zombie-cleaner）产生副作用
- metadata.pre_flight_failed 是**单一信号** —— 只服务 alertOnPreFlightFail
  的 24h COUNT。清它 = 清那个告警的输入，不碰别的

**为什么不在 INSERT handler 做更激进的 PRD 收敛**：
- 保持 fallback 链清晰（3 层顺序反映调用方约定的优先级）
- 不主动把 prd 存进 payload（保持 payload 语义单纯）
- 兼容未来：如果调用方想同时传 description 和 prd，description 优先

### 下次预防

- [ ] 新加 API 字段时必须同步更新 destructure（否则 req.body 里的
      字段会被 express 丢弃）
- [ ] pre-flight-check 的 fallback 链任何变更（增删字段）必须同步
      task-tasks.js 的 C2 段（两处要对齐）
- [ ] 任何引入"DB 副作用标记"（如 metadata.pre_flight_failed）的
      功能必须同时提供**清理 migration** 或 GC 策略，否则存量永远堆积
- [ ] "解锁" plist env 后必须提醒用户去 Dashboard 确认开关状态
      （避免默认值让系统回到未预期状态）

## 下一步

- 本 PR 合并后，跑 migration 243 → 存量清零（已在 T1 手工跑过）
- Alex 可继续让 BRAIN_MUTED=true（runtime），或 toggle 到 false
  观察不再有 pre_flight_burst
- 更深层的 alerting.js P0 限流持久化（in-memory Map → DB）是另一个
  独立 PR（runtime muted 已挡住，不急）
