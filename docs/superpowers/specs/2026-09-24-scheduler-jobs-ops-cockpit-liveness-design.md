# Brain 调度 job 入运行舱 + notion-gtd-sync 整轮有界 — 设计

Brain task `50a2c256` ｜ 决策 `69cd802f`（模型）｜ Bug PrepPRD `sprints/09241005-scheduler-jobs-into-ops-cockpit/prep-prd.md`

## 1. 问题

2026-09-24 00:40:35Z Brain 事件循环停顿 ≥5s（3 条新 pg 连接 5s 超时被 reset、tick "already running"）。停顿后 notion-gtd-sync 的下一轮（00:41:06）再没返回：`inFlight` 永真，之后每 30s 的触发全部跳过；`gtdSyncJobHandler` 仍每分钟回报 `loop: running`。主理人中文 GTD 库两行「委派」任务 8.4 小时没被接收，运行舱与 Notion 驾驶舱全绿。

两层根因：
1. **入图缺口**：`scheduler-jobs.js` 的 48 个 JOBS 是 Brain 自己的 workflow，从未进 `ops_workflows`。活性判定只对 `ops_workflows` 行生效，所以 Brain 内部循环死了没人知道。
2. **整轮无界**：单请求有超时（Notion 30s abort、pg 连接 5s、ssh 30s），但 pg **查询**无超时（`statement_timeout=0`、无 `query_timeout`、keepalive 7200s），整轮也没有总超时。任何一个既不 resolve 也不 reject 的 await 就把循环永久锁死，且不留任何日志。

精确挂在哪个 await 已随重启不可复原——这正是本设计"记录当前步名"要补的证据。

## 2. 目标 / 非目标

目标（一条 golden path）：**job 在代码里 → 出现在运行舱 → 活性等于真相 → 卡死 16 分钟内红灯 + 告警 → 下次卡死能说出卡在哪一步**。

非目标：
- launchd / crontab 已进 `ops_schedule_entries`，不动
- activity / 边 模型（走 /capability，另立）
- tick 依赖检查脏 uuid（issue e13df2b5，另修）

## 3. 方案

### 3.1 活性来源：哨兵 + handler 自报 `liveness_at`

`runSchedulerJobsOnce` 写哨兵 `working_memory.scheduler_job_last_run:<name>` 时，若 handler 返回对象含 `liveness_at`（ISO），原样写进 record。

- `gtdSyncJobHandler` 立即返回，哨兵的 `at` 每分钟都刷新，**内层循环死了也刷新**——所以活性必须用 `liveness_at = 最后一轮完成时刻`，不能用哨兵时间戳。
- 超时的那一轮不算活：`liveness_at` 只在整轮真正跑完时推进。
- 一轮都没完成过时用**循环启动时刻**兜底（`lastCompletedAt ?? loopStartedAt`），不返回 null：否则调度器丢掉 null、采集器回退哨兵 `at`（每分钟都新），开机首轮就挂住的循环会永远显示 ok——这正是要杀的病。
- 其他 job 不返回 `liveness_at`，采集时回退为哨兵 `at`（handler 被调用即视为活）。

JOBS 条目可选声明 `livenessIntervalSec`（notion-gtd-sync = 30）；未声明的按调度轮 60s。

### 3.2 新 job `scheduler-liveness`（每 60s，不 gate）

放在 `ops-notion-push` 之前。不 import scheduler-jobs（会成环：scheduler-jobs → ops-collector → … ，仓库已有 `routes/sentinel.js` 明确避坑），改为注入：`handler: (pool) => runSchedulerLiveness(pool, { jobs: JOBS })`。实现放独立模块 `ops-scheduler-liveness.js`（ops-collector.js 已 1196 行，不再加腿）。

每轮：
1. 读全部 `scheduler_job_last_run:*` 哨兵。
2. 对每个 job：`lastRunAt = record.liveness_at ?? (record.ok ? record.at : null)`；`intervalSec = job.livenessIntervalSec ?? 60`；活性用新函数 `classifyDeclaredLiveness({ lastRunAt, intervalSec, now })`——声明间隔不是统计估计，**不走 `COLD_START_RUNS` 冷启动门槛**，阈值公式与 `classifyLiveness` 一致（warn = max(5×, 300s)，dead = min(max(20×, 900s), 30d)）。30s 间隔 → warn 300s / dead 900s。
3. upsert `ops_workflows (source='scheduler', wf_id=job.name)`：只写机器列 `name, active=false, machine='us-vps', meta{description,timeoutMs,livenessIntervalSec,kind:'scheduler_job'}, last_run_at, last_run_status('success'|'error'|'timeout'), baseline_interval_sec=intervalSec, liveness, silent_sec, warn_after_sec, dead_after_sec, liveness_at, updated_at`。人工列（owner/note/priority/starred/enable_intent/dispatch）不在 SET 里。
4. **降噪**：`ON CONFLICT DO UPDATE ... WHERE` 仅当 `liveness` 或 `last_run_status` 变化、或 `last_run_at` 前进 ≥10 分钟时才真的更新（否则 48 行每分钟刷 `updated_at`，会把 `pushOpsWorkflows` 的 `LIMIT 50` 吃光并让 Notion 每轮 PATCH 48 页）。
5. **告警**：UPDATE 用 `RETURNING` 拿到旧 `liveness`；由非 dead → dead 的行调 `raiseAlert`（现有告警通道，去重靠"只在翻转时发"）。恢复（dead → ok）也发一条，文案不同。
6. 心跳 `writeHeartbeat('scheduler','us-vps', ...)`（沿用 ops-collector 的 per-source 心跳约定，函数从 ops-collector 导出或搬到 lib）。

`active=false` 的原因：`routing/cheap-gates.js:14` 用 `WHERE active = TRUE` 把 `ops_workflows` 当秋米路由的 registry pool，job 名（`ci-patrol`、`daily-backup`…）会被当 workflowRef 命中。同时在 cheap-gates 的查询加 `AND source = 'n8n'`（双保险，路由 registry 本就只该是 n8n 业务流程），带测试。

### 3.3 notion-gtd-sync 整轮有界 + 步名

- `runGtdSyncOnce` 新增两个注入回调：`onStep(name)` 每步前上报步名（`zh→en` / `en→zh` / `入账` / `急停` / `回写`，结束 `null`）；`isAbandoned()` 每步边界检查，为真则停下并返回 `{ ...已完成的步, abandoned: true, abandoned_before }`——超时后旧轮不能与新轮并发写（`syncEnToZh` 查后建非原子，两轮并发会在中文表建重复行），被放弃的轮最多再跑完当前步。
- `ensureGtdSyncLoop` 的定时回调用 `Promise.race` 包一层总超时 `QIUMI_SYNC_ROUND_TIMEOUT_MS`（默认 300000；非法值 NaN/0/负回落默认，与 `QIUMI_SYNC_SINCE` 同款 fail-closed，否则 `setTimeout(NaN)` 按 1ms 触发）。步名存在回调闭包里并按轮次门控（`myRound === round`），被放弃的旧轮迟到的 `onStep` 不改写当前轮。超时 → `lastRun = { error: 'round_timeout', step, at }`、`console.warn` 带步名、**释放 `inFlight`**、置该轮 `abandoned`；`lastCompletedAt` 不推进；迟到的结果被 race 丢弃。`setTimeoutFn` / `clearTimeoutFn` 成对可注入。
- `gtdSyncJobHandler` 返回 `{ loop, lastRun, liveness_at: lastCompletedAt }`。

### 3.4 pg 客户端 `query_timeout`

`DB_DEFAULTS.query_timeout = DB_QUERY_TIMEOUT_MS`，默认 600000（10 分钟）。node-pg 8.19 经 pg-pool 透传到 Client，超时后 `client.release(err)` 丢弃该连接——正好把"半死连接"清出池。默认取 10 分钟而不是更短，因为主 pool 也跑启动 `runMigrations` 与 `preview-destroyer` 的 `pg_advisory_lock` 阻塞等待，这两者必须有充裕上限；bug 的本质是"无界"，10 分钟已把它变成有界，且轮超时 5 分钟先于它触发。

## 4. 错误处理

- 哨兵缺失/坏 JSON → 该 job liveness=cold，不抛。
- `raiseAlert` 失败 → warn 不抛（告警是增益不是前提）。
- `scheduler-liveness` 自身也是 JOBS 一员，自我登记；它挂了由 ops-collector 的 5 分钟哨兵覆盖兜底（既有机制）。
- 轮超时后那条挂住的 pg 连接最迟 10 分钟由 `query_timeout` 回收。

## 5. 测试（unit 档，沿用现有写法）

| 文件 | 断言 |
|---|---|
| `__tests__/scheduler-jobs-gtd-sync.test.js` | 一轮永不返回 → fake timers 推进过总超时 → `inFlight` 释放、下一次 tick 真的再跑、`lastRun.error='round_timeout'` 且 `step` 为当时步名、`liveness_at` 不前进（**复现今日事故，先红**） |
| `__tests__/scheduler-jobs.test.js` | handler 返回 `liveness_at` → 哨兵 record 带该字段；JOBS 含 `scheduler-liveness` 且在 `ops-notion-push` 之前 |
| `__tests__/ops-scheduler-liveness.test.js`（新） | fakePool 预置哨兵行 → upsert 参数 source='scheduler'；SQL 不含任何人工列；30s 间隔 + 老于 900s → dead；ok→dead 翻转调 raiseAlert、非翻转不调；`WHERE` 降噪子句存在 |
| `__tests__/ops-liveness.test.js` | `classifyDeclaredLiveness` ok/warn/dead 边界、无 lastRunAt→cold、不受 runCount 影响 |
| `__tests__/cheap-gates*.test.js` | registry 查询含 `source = 'n8n'` |
| `__tests__/db-config.test.js` | `DB_DEFAULTS.query_timeout` 默认 600000、env 可覆盖 |

守卫 proven-to-fire（上产后）：`psql` 查 `ops_workflows WHERE source='scheduler'` 行数 = JOBS.length 且 notion-gtd-sync 行 liveness='ok'；再把该行 `liveness_at`/哨兵 `liveness_at` 人为改老一轮，看 Notion 驾驶舱红灯 + 告警各响一次。

## 6. 影响面

- 新 job 每 60s 一次 ≤48 行 upsert（多数被 WHERE 挡下），Notion 增量 ≤ 每 10 分钟 48 页。
- `ops_workflows.source` 出现新值 `scheduler`；Notion `Source` select 自动多一个选项。
- `query_timeout` 对所有 `DB_DEFAULTS` 使用方生效（主 pool / migrate / selfcheck / 脚本 / 集成测试），10 分钟上限对它们无实际影响。
