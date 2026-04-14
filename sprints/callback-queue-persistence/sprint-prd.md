# Sprint PRD — Brain Callback 持久化

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 85%
- **说明**：Callback 持久化直接解决 Harness Pipeline 端到端断链的根因，是"系统可信赖"的关键基础设施

## 背景

当前 Harness Pipeline 无法端到端跑通的根因：Brain 重启时正在处理的 HTTP callback 丢失。完整链路：bridge 跑完 claude → HTTP POST /api/brain/execution-callback → Brain 正在重启 → callback 连接失败 → 数据丢失 → pipeline 断链。

这是鸡生蛋问题：Harness 产出的代码要上线必须重启 Brain，但重启会中断正在跑的 pipeline callback。解决此问题后，Brain 可以随时安全重启（部署、更新、崩溃恢复），不丢失任何 pipeline callback。

## 目标

Bridge 将执行结果直接写入数据库而非 HTTP 发送，Brain 后台 worker 异步处理，实现 callback 跨重启零丢失。

## User Stories

**US-001**（P0）: 作为系统运维者，我希望 Brain 重启时不丢失任何 callback 数据，以便 Harness Pipeline 能端到端可靠运行

**US-002**（P0）: 作为 Bridge 脚本，我希望通过 DB 直写 callback 数据，以便不再依赖 Brain HTTP 端点的可用性

**US-003**（P1）: 作为 Bridge 脚本，我希望在 DB 不可达时自动降级到 HTTP 发送，以便在极端情况下仍有 fallback 路径

**US-004**（P1）: 作为系统运维者，我希望 callback 处理是幂等的，以便重复处理不会产生副作用（重复创建任务、覆盖已有结果）

**US-005**（P1）: 作为旧版 Bridge 脚本，我希望现有 HTTP callback 端点继续工作，以便升级过程中不中断服务

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）: Brain 重启时 callback 不丢
- **Given** Bridge 已经 INSERT 一条 callback_queue 记录且 processed_at IS NULL
- **When** Brain 被 kill -9 后通过 launchctl 重启
- **Then** 新 Brain 启动后 30 秒内，该 callback 被 worker 处理，task 状态正确更新

**场景 2**（关联 US-004）: 幂等性保证
- **Given** 同一个 callback 记录已被处理过一次（task 状态已更新）
- **When** Worker 因异常重试再次处理该记录
- **Then** task 状态不发生变化，不会创建重复的下游任务

**场景 3**（关联 US-003）: Bridge DB 降级
- **Given** DB 连接不可达（psql 连接超时）
- **When** Bridge 脚本尝试写入 callback_queue
- **Then** Bridge 自动降级到 HTTP POST /api/brain/execution-callback，Brain 收到后写入 callback_queue 异步处理

**场景 4**（关联 US-005）: HTTP 端点兼容
- **Given** 旧版 Bridge 脚本仍使用 HTTP POST 发送 callback
- **When** POST /api/brain/execution-callback 收到请求
- **Then** 端点将数据写入 callback_queue 后立即返回 200，由 worker 异步处理

**场景 5**（关联 US-001）: Worker 正常轮询
- **Given** callback_queue 中有 3 条未处理记录（processed_at IS NULL）
- **When** Worker 执行一次轮询周期
- **Then** 3 条记录按 created_at 顺序依次处理，成功的标记 processed_at，失败的保留等下次重试

## 功能需求

- **FR-001**: 新建 callback_queue 表，存储 task_id、checkpoint_id、run_id、status、result_json、stderr_tail、duration_ms、attempt 等字段，支持按未处理状态的部分索引
- **FR-002**: cecelia-run.sh 的 send_webhook 函数改为优先通过 psql INSERT 写入 callback_queue 表，DB 不可达时降级到 HTTP POST
- **FR-003**: Brain 启动时启动 callback worker，每 2 秒轮询 callback_queue 中未处理记录（LIMIT 10），调用现有 execution-callback 处理逻辑
- **FR-004**: execution-callback 处理逻辑提取为共享函数，支持 worker 和 HTTP 端点复用
- **FR-005**: execution-callback 处理逻辑必须幂等 — task result 只在空时写入，下游任务按 trigger_source 去重
- **FR-006**: HTTP POST /api/brain/execution-callback 端点保留，改为写入 callback_queue 后立即返回 200

## 成功标准

- **SC-001**: Brain 重启后 30 秒内，所有未处理的 callback 被 worker 消费并正确更新 task 状态
- **SC-002**: 同一 callback 被处理两次时，task 状态不变化，下游任务不重复创建
- **SC-003**: Bridge 在 DB 不可达时自动降级到 HTTP，callback 数据不丢失
- **SC-004**: 现有 HTTP callback 端点兼容旧版 Bridge，行为不变（写入队列 + 返回 200）

## 假设

- [ASSUMPTION: migration 编号 234 不与已有 migration 冲突]
- [ASSUMPTION: cecelia-run.sh 运行环境中 psql 命令可用且 DB 连接串可获取（通过环境变量或配置文件）]
- [ASSUMPTION: 系统为单 Brain 实例，不需要考虑多 worker 并发处理同一条 callback 记录的竞争问题]
- [ASSUMPTION: callback_queue 表不需要定期清理已处理记录，后续可按需添加清理策略]
- [ASSUMPTION: worker 轮询间隔 2 秒对当前系统负载足够，不需要动态调整]

## 边界情况

- **Worker 处理中途 Brain 崩溃**: callback 记录 processed_at 仍为 NULL，重启后 worker 会重新处理，依赖幂等性保证正确
- **DB 连接池耗尽**: worker 的 pool.query 抛异常，该条 callback 不标记 processed_at，下次轮询重试
- **callback_queue 堆积**: 如果 Brain 长时间宕机，大量 callback 堆积，worker LIMIT 10 + 2秒间隔可稳定消化
- **Bridge psql 超时**: send_webhook 中 psql 连接设置超时（如 5 秒），超时后降级到 HTTP fallback
- **空队列时的 CPU 开销**: 空查询（SELECT ... LIMIT 10 WHERE processed_at IS NULL）开销极小，部分索引保证效率

## 范围限定

**在范围内**:
- callback_queue 表的创建和索引
- cecelia-run.sh send_webhook 改为 DB 直写 + HTTP fallback
- Brain callback worker（轮询 + 处理 + 标记）
- execution-callback 处理逻辑的幂等性改造
- HTTP callback 端点兼容改造（写队列 + 立即返回）

**不在范围内**:
- callback_queue 表的定期清理/归档策略
- Worker 的动态轮询间隔调整
- 多 Brain 实例的 callback 竞争处理
- Bridge 脚本的其他重构
- callback 处理失败的告警/通知机制
- callback_queue 的管理 UI 或 API

## 预期受影响文件

- `database/migrations/234_callback_queue.sql`：新增 migration，创建 callback_queue 表和索引
- `packages/brain/scripts/cecelia-run.sh`：send_webhook 函数改为 psql INSERT + HTTP fallback
- `packages/brain/src/callback-worker.js`：新增 worker 模块，轮询处理 callback_queue
- `packages/brain/src/server.js`：启动时初始化 callback worker
- `packages/brain/src/routes/execution.js`：HTTP callback 端点改为写入队列后立即返回，处理逻辑提取为共享函数
