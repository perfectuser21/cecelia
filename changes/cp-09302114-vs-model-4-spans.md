## Brain {VERSION} — 价值流建模④：spans 表 + task_runs.workflow_id + activity_flow_metrics 视图 + POST/GET /api/brain/spans（迁移 495，任务 ec643d60，决策 3e867cad 第 9-10 张表）

- 新表 `spans`：一次 run 里一个 Activity / Step / Enabler 的一次执行；三个目标至少挂一个（CHECK）；`executor_kind` code|agent|human、`outcome` pass|fail|skipped|unknown；`duration_ms` 生成列；幂等唯一键 `(run_id, COALESCE(step_id, activity_id, enabler_id), started_at)` 让执行机重发不产生重复行
- `task_runs.workflow_id`（可空，不回填）与 `spans.workflow_id` 同一根轴
- 视图 `activity_flow_metrics`：近 7 天按 Backbone Activity 汇总 runs / span_count / p50 / p95 / avg_wait_ms / fallback_rate / first_pass_yield(=1−fallback_rate) / pass_rate / tokens_total / cost_usd_total
- `POST /api/brain/spans`（内网/回环鉴权，单条或数组，逐条 ON CONFLICT DO NOTHING，回报 inserted/skipped/count/ids）、`GET /api/brain/spans?run_id=&activity_id=`
- 测试：结构断言 + 真库集成（幂等 / CHECK / 幂等键 / 视图 4 条 span 2 fallback→0.5 / 回滚）+ 路由 mock + smoke `vs-model-spans-smoke.sh`
