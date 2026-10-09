# workflow_run 整批总时限到期判 lost + 收割器放锁回桌面（任务 c2d73868，决策 3c98fb36）

## 背景

09-30 02:00–08:15 事故：三部手机各卡 6 小时，escort 02:52 被移除后无人陪跑，Brain 侧 device_job
镜像单一直 in_progress，没有任何程序判 lost。PRD（zenithjoy-workspace
`sprints/09301230-commander-contract-orchestration/prep-prd.md`「阶段 1」）要求：
**整批总时限到期无 finalize → Brain 判 lost，收割器放锁回桌面**；对标 run 的账本 run_id
前缀写死 `social-keyword-leadgen-crontab-`，Brain 读侧按 payload 能力取名，不按前缀错分类。

## 现状（代码事实）

- Commander 发起的 run：执行机 `wf-run.sh` → `wall-report.sh start` 经 ZenithJoy API 桥在 Brain 建
  `device_job`（status=in_progress，payload `{serial, source:'cron', read_only, headed_manual, idempotency_key, executed_at}`，
  `due_at`=起跑时间，`started_at` 为空）。stage/finalize 经 `workflow-result.sh brain_post` 打
  `POST /api/brain/execution-callback`（status=in_progress 记 stage；finalize 才送 completed/failed 终态）。
- Notion 排单 ssh 直派的 `workflow_run`（payload `run_id/wf_id/machine/channel=ssh`）由
  `reapSshWorkflowRuns` 读 `.exit`，6 小时超时判 failed(timeout>6h)。
- 手机台账 `phone_registry(serial → host, profile)` 已上产（PR #5680）。
- `lib/business-probe-judge.js resolveWorkflow` 无锚兜底时从 run_id 的 `-crontab-` 前缀解析 workflow ——
  对标 run 账本 run_id 前缀写死会被错归到 social-keyword-leadgen。

## 设计

### 1. 新 scheduler job `workflow-run-lost-deadline`（`src/workflow-run-lost-deadline.js`）

- 每轮调度调用，进程内 5 分钟自 gate；整轮有界（`query_timeout` 走 pool 既有配置，单批 ≤ 20 行，ssh 每步 30s 超时）。
- 判据（SQL 内比较，禁 JS 解析无时区时间）：
  `status='in_progress'` 且 (`task_type='workflow_run'` 或 `task_type='device_job' AND payload->>'source'='cron'`)，
  `COALESCE(started_at, due_at, created_at) < NOW() - 总时限`。
  总时限 = `WORKFLOW_RUN_DEADLINE_MS`（默认 4h）+ `WORKFLOW_RUN_DEADLINE_GRACE_MS`（默认 30min）。
- 到期即终态：`finalizeTask(...,'failed',{ onlyIfStatus:'in_progress', mergeResult:{ reason:'lost_deadline', deadline_ms, cleanup } })`；
  该任务未收尾的 `task_runs` 行 `finishRun(status='timeout')`；`task_events` 记 `lost_deadline`。
- 善后（每步 fail-open，失败只记日志与 cleanup 摘要；只做一次，`payload.lost_cleanup_at` 为标记）：
  1. 解析现场：`hostkey` = payload.machine/host/hostkey → 否则 phone_registry(serial).host；
     `profile` = payload.profile → 否则 phone_registry(serial).profile；
     `TAG` = payload.tag/run_tag → 否则由该任务最新 task_runs.run_id（`<账本run>__aN.<stage>`）取账本 run 最后一段；
     `escort_id` = payload.escort_id / payload.commander_escort_id（阶段 B 看门狗会写入）。
  2. ssh 执行机（`sshTargetFor(resolveMachineId(hostkey))`，只认注册表机器）：
     `~/.local/bin/douyin-phone-adb --profile <p> lock-release <TAG>`（子命令无 --force，按 owner=TAG 释放；owner 不同即拒绝并记录）、
     `~/.local/bin/douyin-phone-adb --profile <p> return-safe-desktop`。
  3. ssh MMV：`openclaw cron rm <escort_id>`（无 id 跳过并记录）。
  - 参数白名单 `^[A-Za-z0-9._-]{1,64}$`，不合法的步骤跳过（ssh 单 argv 传远端串，本地零 shell）。
- 幂等：ZenithJoy `reconcileBrainMirrors` 以本地 worker_tasks 为准可能把 Brain 行翻回 in_progress，下一轮再判到期
  时只重写终态、不重复善后（标记在 payload）。

### 2. 读侧按能力取名

`resolveWorkflow(runId, result, hints)`：`result.workflow` → `hints.wf_id / capability / cap` → 再兜底 run_id 前缀。
`handleRunFinished` 查锚时同 SQL 一并读出 payload 里这三键传入。新增 `workflowRunLabel(task)` 供 job 事件/日志取能力名，
永不从 run_id 前缀推能力。

### 3. 登记

- `JOBS` 里注册（在 scheduler-liveness 之前），scheduler-liveness 自动入 `ops_workflows(source=scheduler)`。
- smoke：`packages/brain/scripts/smoke/workflow-run-lost-deadline-smoke.sh`（伪造 5h 前 in_progress 行 + 桩 ssh，
  断言 lost 与三条善后命令；新鲜行不动）→ `packages/quality/smoke-allowlist.txt`。
- `changes/cp-09301320-workflow-run-lost-deadline.md`（`{VERSION}` 占位，不碰版本五件套）。

## 不包含

- 执行机 wf-run/batch2 自身 4h 平滑收工（任务 7d150e33）。
- ZenithJoy 侧 workflow-result.sh 账本 run_id 前缀改名、reconcile 不翻回 Brain 终态（zenithjoy 仓另行处理，报告里注明）。
- Commander 心跳/看门狗/Bark（任务 17ea4536，下一 PR）。

## 测试

- vitest 单测（mock pool + 桩 execFileFn）：到期无 finalize → failed/lost_deadline + 三条 ssh 命令；未到期不动；
  已终态（finalize 已收）不在查询结果内不动；payload 已有 lost_cleanup_at → 只终态不善后；hostkey 不在注册表 → 善后跳过仍判 lost。
- resolveWorkflow：hints.wf_id 优先于 run_id 前缀。
- JOBS 注册测试（照 script-reaper 先例）。
