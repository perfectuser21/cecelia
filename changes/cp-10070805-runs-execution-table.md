## Brain {VERSION} — 执行记录 runs 表：每次流程运行一行，定时任务开始逐次留痕

- 决策 ff2019e2，任务 1215b441。业内通行形状（OpenTelemetry trace/span、Langfuse traces/observations、Airflow DagRun/TaskInstance）：运行表 + 明细表 + 汇总。取代交接单里「一张 spans 管三层」的方案（spans 现有约束本就禁止只带 workflow_id 的行）。
- 迁移 531：
  - 新表 `runs`：一次流程运行一行，`run_id` 与 `spans.run_id` 同一把键；挂 `workflows` / `ops_schedule_entries` / `task_runs`；`header_source` 区分运行方自己写（owner）与由 span 自动长出（spans）。
  - `spans` 加 `parent_span_id`（自关联）与 `span_level`（生成列）；`spans.run_id` 外键指向 `runs`（级联删，便于以后按运行做保留期清理）；已有 spans 回填总记录（生产干跑 119 条，其中 63 条时长为 0——上游上报没真计时，待获客线上报方修）。
  - 触发器：span 入库前保证总记录存在，入库后加总起止/结果/token/费用（只对真插入的行）。
  - 汇总视图 `v_workflow_run_stats`、`v_activity_span_stats`（24h/7d/30d）。
- 调度器：每轮真干活的 job 写一行 `runs`（自 gate 跳过的不记），带真实起止；流程经闹钟总账解析（72 个 brain_job 已全部挂流程）。
- 后续步（未做）：Notion 流程/Activity 页汇总列 + 「最近执行」库；运行明细保留期；执行方上报 token；`ops_workflows` 收口；`run_events` 是 harness 内核运行观测，单独评估。
