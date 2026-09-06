## Brain {VERSION} — 判官口粮第一铲：近 30 天 run 数据回填 crystal_ledger

- 新增 `packages/brain/scripts/backfill-crystal-ledger.mjs`：把 `ops_runs`（n8n 实录）与
  `tasks`（dev / payload.pipeline=canvas 终态）近 N 天（默认 30）运行数据聚合成
  `crystal_ledger` 行，幂等键 `(report_date, grid_key)`，支持 `--days=` / `--dry-run`。
- grid_key 一律带 `n8n:` / `task:` 前缀，与判官自管单位（og1..og8 + 证据段名）写者隔离；
  只写台账不写 `crystal_verdict`（只补账不代判）。
- token 无源（`task_run_metrics` 08-23 断流、n8n 不记 token）→ `token_cost=0` +
  `data_gap=true` 诚实标注成本缺口，不编造。
- 实测：台账 10 行 → 63 行（53 行历史真数，含智能获客/编码两条 Canvas 主线），重跑行数不变。
