# 5/3 Brain 救火综合修复 — Learning

## 现象

5/3 上午 Brain 整体瘫痪：
- 321 paused + 331 quarantined + 246 queued = 898 任务卡死或排队
- 0 in_progress
- 6 个手动派的 P0 修复任务全部子容器 exit=0，但 task.status 永停 queued
- 22 小时实测：本地子容器跑完 0 PR 产出
- 测试金字塔倒挂：645 unit / 48 integ / 5 e2e

## 根本原因

**5 个独立 bug 在同一条 callback 链路串联失效，加上诊断盲区**：

1. `routes/execution.js:64` — `_attemptVal = req.body.attempt || iterations || null`，
   callback_queue.attempt 列 NOT NULL DEFAULT 1，显式 INSERT NULL 覆盖 DEFAULT 触发约束错。
   3 次 retry 全失败 → 503 → cecelia-runner 容器无 retry 路径 → tasks.status 永不更新。

2. `observer-runner.js:62` — `runLayer2HealthCheck()` 调用漏传 pool 参数，
   函数内 `pool.query(...)` 全部失败被 catch 后 silent，监控数据全断 → 我们盲飞。

3. `executor.js:387` — `getEffectiveMaxSeats() = Math.min(_budgetCap, PHYSICAL_CAPACITY)`，
   低内存容器（786MB 可用）PHYSICAL_CAPACITY=2 把用户 ENV 7/10 静默截到 2，
   再经 SAFETY_MARGIN floor(2*0.8)=1 → effectiveSlots=1，连 P0 任务都串行排队。

4. `startup-recovery.js:275` — `cleanupStaleClaims` 只清 status='queued' 的 claimed_by，
   paused 状态的死锁不释放（28 个 paused 任务被 brain-tick-7 锁 19 天）。

5. `quarantine.js:classifyFailure` 无 evidence gate — watchdog 杀任务时无 RSS/runtime 实证
   也标 reason='resource_hog'，193/200 quarantined 全是误伤。

**共因**：dev-task → docker-spawn → callback → status 这条核心路径无 E2E 测试覆盖（只有 5 个 e2e
全在 frontend Playwright + engine 工具层），所有 silent 吞错累积成系统瘫痪也不会被 CI 抓到。

## 下次预防

- [x] callback_queue INSERT 必须有兜底（attempt=1），不接受 silent 吞 NULL constraint
- [x] writeDockerCallback 加 retry+DLQ 而非 silent 失败
- [x] observer/health-monitor 跨模块调用必须传完 pool 参数
- [x] cleanupStaleClaims 覆盖所有可能持 claimed_by 的状态（queued + paused）
- [x] quarantine 必须有实证才能标 RESOURCE 类（防"看天断绝"）
- [x] dev-task-lifecycle E2E 入 CI 强制门禁（packages/brain/ 改动必跑）
- [ ] **后续**：health-monitor / callback-queue 任何 silent 吞错添加 metric 触发飞书告警
- [ ] **后续**：决策"LLM→docker / 非 LLM→进程内"落 decisions 表
- [ ] **后续**：系统级金字塔倒挂 — Unit 645:48:26:5 倒挂，需要 e2e 补到 ≥ 20

## 涉及文件

- `packages/brain/src/routes/execution.js` (attempt=null fix)
- `packages/brain/src/docker-executor.js` (retry + DLQ + cleanDlq)
- `packages/brain/src/observer-runner.js` (import pool + 传参)
- `packages/brain/src/executor.js` (getEffectiveMaxSeats)
- `packages/brain/src/startup-recovery.js` (扩 paused)
- `packages/brain/src/quarantine.js` (evidence gate)
- `packages/brain/src/eviction.js` (RSS<100MB 排除)
- `packages/brain/src/paused-requeuer.js` (新)
- `packages/brain/src/paused-requeuer-plugin.js` (新)
- `packages/brain/src/tick-runner.js` + `tick-state.js` (注册 plugin)
- `packages/brain/src/__tests__/integration/dev-task-lifecycle.e2e.test.js` (新)
- `docs/diagnosis/slot-allocator-shrink-rca.md` (RCA)
