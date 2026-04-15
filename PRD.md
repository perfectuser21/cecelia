# Pipeline-Level Stuck Watchdog PRD

## 背景
今天发现 sprint_dir=harness-v5-e2e-test2（planner d8acf398）跑了 3 天还没完成：
Evaluator→Fix 循环 47 轮无限 spin。pipeline-patrol 模块只监督单个 stage（.dev-mode 文件级别）超时，
对"pipeline 整体 N 小时无进展"场景无感知。结果就是任务链在后台反复 spin，持续消耗 slot/账号/token。

## 成功标准
- 新增 `packages/brain/src/pipeline-watchdog.js`，导出 `checkStuckPipelines(pool, opts?)`
- 默认阈值 6 小时（可通过 `PIPELINE_STUCK_THRESHOLD_HOURS` 环境变量 / `opts.thresholdHours` 覆盖）
- 扫描范围：`sprint_dir IS NOT NULL` 的 harness_* 任务
- 判定规则：该 sprint_dir 的 `MAX(updated_at)` 距今超过阈值、且存在 `queued/in_progress/paused` 任务、且没有 `completed` 的 harness_report
- stuck 命中时：所有 open 任务 `UPDATE status='canceled', error_message='pipeline_stuck'`
- 同时 `INSERT INTO cecelia_events (event_type='pipeline_stuck', source='pipeline-watchdog', payload)`，payload 含 sprint_dir / planner_task_id / stuck_for_hours / canceled_task_ids
- `tick.js` 每 30 分钟调用一次（`MINIMAL_MODE` 下跳过），失败不影响主 tick
- 单元测试：stuck 命中 / 未过期 / 已完成 / 无 open 任务 / 可配置阈值 / planner_task_id 回退 / 任务类型过滤 共 7 个用例
- 恢复方式：手动 `PATCH /api/brain/tasks/:id` 任一任务即会刷新 `updated_at`，pipeline 自动解除 stuck

## 不做
- 不改 task schema（不加 `planner_task_id` 列，仍然按 `sprint_dir` 聚合，`planner_task_id` 从 payload 读）
- 不影响非 harness_* 任务类型
- 不做自动恢复（stuck 后不再主动 rescue，Ken 或用户决定是否重启 pipeline）
- 不做 Dashboard UI（事件已写入 cecelia_events，后续另立任务展示）
