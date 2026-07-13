# 小改动 PrepPRD：scheduler-jobs 声明式定时任务注册表（作战循环 P1-PR1）

Brain task: fb00e0b8-0c16-482b-a791-ed725df23346
设计依据: docs 第五节 P1 + 第七节（http://38.23.47.81:9998/cecelia-battle-loop-design.html）

## 改什么

1. **新建 `packages/brain/src/scheduler-jobs.js`**：声明式 job 注册表 + `startSchedulerJobsLoop(pool)`
   - Job 条目：`{ name, handler, needsPool, timeoutMs, description }`
   - 调度模型（侦察实锤决定）：**统一 60s 轮询、每个 job 无脑调用、模块自 gate**——现有 scheduler 函数全部内置窗口/幂等（triggerArchReview 自带 4h 窗口+recent 去重+dev-completed guard；maybeTriggerStrategySession 自带 active_goals=0 gate+24h 冷却+活跃态去重），注册表不重复实现 cron 逻辑
   - 兼容两类签名：接收 pool（`triggerArchReview(pool)`）与无参自取（`runCaptureDigestion()`）
   - 每 job 包 try/catch（`[scheduler-jobs] <name> failed:` console.warn，单 job 失败不影响其他）+ `Promise.race` timeout（默认 5min，参考 tick-runner withThalamusTimeout 范式，loop 级无先例需自建）
   - 每次实际执行后写 working_memory 哨兵 `scheduler_job_last_run:<name>`（INSERT ON CONFLICT 模式，抄 conversation-consolidator.js:169）——供死人开关/战报查询"最近一次跑是什么时候"，幂等仍由模块自 gate 负责
2. **首批注册 4 个 job**（全是死于 Wave 2 的既有函数，零新业务逻辑）：
   - `arch-review`: triggerArchReview(pool)
   - `strategy-trigger`: maybeTriggerStrategySession(pool)（P3 军师日 tick 将来同点位接入）
   - `conversation-digest`: runConversationDigest()
   - `capture-digestion`: runCaptureDigestion()（想法箱进箱通道）
3. **server.js 挂载**：try/catch 非阻断动态 import 模式（对齐 server.js:791-800 Notion Push Sync 先例），import 失败 console.warn non-fatal 不崩启动
4. **tick-runner.js**：executeTick 里对应 4 处调用点加 `DEPRECATED(P1-PR1)` 注释（不删代码，防未来复活 executeTick 时双跑）
5. **文档**：`docs/current/battle-loop-design.md`（设计文档 md 版入库）+ `docs/current/executetick-dead-jobs-inventory.md`（约 25 个死调用逐条处置清单：已迁移/待迁移/建议废弃）

## 为什么改
Wave 2（2026-05-04）重构后 executeTick step 10.x 全部定时任务成死代码（diary 停更、arch_review 停摆、strategy_session 从未跑过）。本 PR 建立声明式恢复通道并首批救活 4 个（migration-orphan-audit 铁律要求的孤儿清单一并产出）。

## 影响范围
server.js 启动序列加一个非阻断 loop；不改 tick-scheduler/dispatcher 派发逻辑；不删任何现有代码；不动 LangGraph。

## 判定点登记（拍板 8 机制）
- 「job 该不该跑」判定：选**模块自 gate**而非注册表 cron 表达式。依据：现有函数已内置窗口+幂等，双重 gate 会打架且引入两处时区语义。误判后果：低（多调一次被模块内 gate 挡住，浪费一次 SQL）。

## 验收标准
- [ ] 单测（vitest + mock pool，参考 __tests__/daily-review-scheduler.test.js 模式）：job 调度、单 job 异常隔离、timeout、两类签名兼容、sentinel 写入
- [ ] 真环境验证（铁律：真环境验证才算 done）：brain-deploy 后 docker logs 见 `[scheduler-jobs] started`；working_memory 出现 4 个 `scheduler_job_last_run:*` key；下一个 4h 窗口 tasks 表出现新 arch_review 任务
- [ ] CI 全绿
