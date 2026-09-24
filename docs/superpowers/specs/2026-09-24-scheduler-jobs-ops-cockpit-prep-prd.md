# Bug PrepPRD：Brain 调度 job 不在运行舱，notion-gtd-sync 循环卡死 8.4h 无告警

Brain task: 50a2c256-0828-418a-a9a6-9547654db1ce ｜ 决策 69cd802f ｜ 锚：工厂·F5 指挥舱 / GP 804520f5 / 步骤3「看到的等于真相」

## 症状
2026-09-24 00:40Z 起 notion-gtd-sync 30s 循环再无新一轮；主理人中文 GTD 库 08:40（北京）写的两行「委派」任务 OpenClaw任务号 始终为空。
运行舱/Notion 驾驶舱无任何红灯；scheduler 哨兵 `working_memory.scheduler_job_last_run:notion-gtd-sync` 仍每分钟写 ok + `loop: running`。
重启 Brain 容器（02:00Z）后循环恢复。

## 根因（两层）
1. **入图缺口**：`scheduler-jobs.js` JOBS 数组（48 个 job）是 Brain 自己的 workflow，却从未进 `ops_workflows`——采集器五条腿只扫 launchd / openclaw / gha / crontab / n8n。活性告警（`ops-liveness.js`）只对 `ops_workflows` 行生效，所以 Brain 内部循环死了没人知道。
2. **循环无总超时**：`ensureGtdSyncLoop` 用 `inFlight` 做重入守卫，但 `runGtdSyncOnce` 一轮没有总超时；单请求 30s 超时 + 4 次退避不能保证每一步都返回。某一步挂住 → inFlight 永真 → 之后每 30s 触发全部跳过，且 handler 仍回报 running。

## 关联上下文
- Journey：工厂·F5 指挥舱（8bb8252f）；GP「运行舱加厚（统一注册投影）」804520f5 candidate
- Issue 9aa89588（scheduler job 重叠）相关但不同根因
- 决策 69cd802f：入图不靠手填，scheduler JOBS 由采集器扫进 ops_workflows；派发链作为第一个样本

## 修法（一个 PR，三处，组成一条 golden path：job 在代码里 → 出现在运行舱 → 活性等于真相 → 卡死可见）
1. `scheduler-jobs.js`：JOBS 条目可选声明 `livenessIntervalSec`（notion-gtd-sync=30）；`runSchedulerJobsOnce` 把 handler 返回的 `liveness_at` 一并写进哨兵 record；`ops-collector` handler 传入 `{ jobs: JOBS }`（避免 import 环）。
2. `notion-gtd-sync.js`：整轮加总超时（`QIUMI_SYNC_ROUND_TIMEOUT_MS`，默认 5min）；`runGtdSyncOnce` 记录当前步名；超时 → `lastRun={error:'round_timeout', step, at}` 并释放 inFlight，下一轮照常起；`gtdSyncJobHandler` 返回 `liveness_at = lastRun.at`。
3. `ops-collector.js` 新腿 scheduler@brain（不需要 exec）：读 `opts.jobs` + `working_memory` 哨兵 → upsert `ops_workflows(source='scheduler', wf_id=job.name, machine='us-vps')`，只写机器列（name/active/meta/last_run_at/last_run_status/liveness 五件套），人工列不碰；活性用声明间隔算（新增 `classifyDeclaredLiveness`，声明间隔不是统计估计，不走冷启动门槛）；心跳 source='scheduler'。
   Notion 投影（pushOpsWorkflows）不分 source，自动带出 Liveness 列。

## 不包含
- launchd / crontab 已由采集器进 `ops_schedule_entries`，本次不动
- activity/边 模型（走 /capability，另立）
- Bark 推送 dead（本次只保证运行舱与 Notion 红灯为真）

## Regression Test 计划（先红后绿，永久留 CI）
- `scheduler-jobs-gtd-sync.test.js`：一轮永不返回 → 超过总超时后 inFlight 释放、下一次 tick 真的再跑一轮、lastRun.error='round_timeout' 且带 step 名（复现今日事故）
- `ops-collector.test.js`：传入 jobs + 哨兵行 → 写 `ops_workflows` source='scheduler'；哨兵 liveness_at 老于 20×声明间隔 → liveness='dead'；人工列不在 SET 里
- `ops-liveness.test.js`：`classifyDeclaredLiveness` 边界（ok/warn/dead，无 lastRunAt→cold）
- 守卫 proven-to-fire：上产后 psql 查 `ops_workflows` source='scheduler' 行数=JOBS 数且 notion-gtd-sync liveness=ok；再人为把该行 liveness_at 改老一轮采集，看 Notion 驾驶舱红一次

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 上产后 `ops_workflows WHERE source='scheduler'` 行数 = JOBS.length，notion-gtd-sync 行 liveness='ok'
- [ ] 中文库两行测试任务被接收（OpenClaw任务号 = en:/brain:）
- [ ] CI 全绿
