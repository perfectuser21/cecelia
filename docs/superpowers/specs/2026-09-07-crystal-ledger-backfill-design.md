# 判官口粮第一铲：近 30 天 run 数据回填 crystal_ledger

日期：2026-09-07　任务：d8963868-12ab-49b0-b59c-d3b196b75a60　决策：0e200050

## 问题

crystal-judge 每天在跑，但 `crystal_ledger` 只有 10 行，其中 og1..og8 全部
`n_runs=0 / data_gap=true`，`crystal_verdict` 对应 8 条全是 `keep_llm{"rule":"data_gap"}`——
判官在空账上判案。根因不是 bug：判官只吃 `crystal_run_evidence`（迁移 438），
该表目前仅 7 行（search_account 段，由 crystal-verify.mjs 人工搬运）。

与此同时，近 30 天真实运行数据躺在两张表里无人搬：

| 源 | 量 | 说明 |
|---|---|---|
| `ops_runs`（迁移 439，运行舱刀6） | 4505 行 / 9 个 wf_id | n8n execution 实录，含 Commander Canvas 两条主线 |
| `tasks` | dev 59 行（completed+failed） | Brain 任务终态 |

`ops_runs` 实测：`AwrSocialLeadgenV4` 155/193 ≈ 80%、`AwrCodingHarnessV4` 56/63 ≈ 89%
——正是「智能获客 80% / 编码 89%」那两个数，确认它就是任务描述里所指的 run 数据。

## 与任务描述的三处偏差（按真实 schema 纠偏）

1. **幂等键不是 task_id**。`crystal_ledger`（迁移 435）无 task_id 列，唯一键是
   `(report_date, grid_key)`，且它是**按日聚合表**而非逐 run 明细表。
   → 幂等改为按 `(report_date, grid_key)` upsert；聚合是源数据的确定性函数，重跑行数不变。
2. **`payload.pipeline=canvas` 在 tasks 里 0 行**。真正的 canvas run 在 `ops_runs`。
   → 增 `ops_runs` 为第二源；tasks 侧两条规则原样保留（将来出现 canvas task 自动生效）。
3. **token 无源**。`task_run_metrics` 2026-08-23 后断流且仅 1102/10753 行带 token；
   迁移 439 明说 n8n 不记 token（在 OpenClaw 会话侧）。
   → `token_cost=0` 且 `data_gap=true` 诚实标注成本缺口，**不编造**。
   后果可接受：判决引擎 `cost_benefit = n_runs × token_cost` 因此判 `keep_llm`，
   与「没有成本证据就不许晋升」的 INV 语义一致。

## 设计

新增 `packages/brain/scripts/backfill-crystal-ledger.mjs`，两层：

- **纯函数层** `aggregateLedgerRows(runs)`：输入已带 `report_date`(北京日) / `grid_key` /
  `success`(bool) / `duration_ms` 的扁平 run 列表，输出 ledger 行对象数组。
  无 DB、无时钟依赖 → 单测全覆盖。
- **IO 层**：两条 SELECT（report_date 在 SQL 里就换算成北京日，避开 node 进程时区歧义）
  → 调纯函数 → 逐行 upsert `crystal_ledger`。

### grid_key 命名与写者隔离

| 源 | grid_key |
|---|---|
| `ops_runs` | `n8n:<wf_id>` |
| `tasks` task_type=dev | `task:dev` |
| `tasks` payload.pipeline=canvas | `task:canvas` |

前缀保证与判官自管单位（`og1..og8` + 证据段名如 `search_account`）永不撞键。
判官每天只判「og 八格 ∪ 当日有 evidence 的段」，回填单位不在其中 →
两个写者各写各的行，回填结果不会被次日判官抹掉，也不会污染判官原有判决。

### 指标映射

| ledger 列 | 取值 |
|---|---|
| `n_runs` | 当日该单位 run 数 |
| `success_rate` | 成功数/总数（ops_runs `status='success'`；tasks `status='completed'`） |
| `broken_count` | 失败数 |
| `latency_ms` | 有时长样本时取均值，否则 `null`（不填 0） |
| `token_cost` | `0`（无源） |
| `new_branch_rate` | `0`（无源） |
| `data_gap` | `true`（成本维度缺口） |

不写 `crystal_verdict`：回填只补账，不代判。

### 边界与失败语义

- 无 run 的日子不写行（不造 0 行）。
- `tasks` 终态时刻取 `COALESCE(completed_at, updated_at)`；两者皆空则跳过该行并计数上报。
- `ops_runs` 取 `started_at`；`duration_sec` 为 NULL（crashed）时不计入时长均值。
- CLI：`--days=30`（默认）、`--dry-run`（只打印不写库）。
- 单条 upsert 失败即抛错退出非 0，不吞异常。

## 验收

- 单测先红后绿（`packages/brain/scripts/__tests__/backfill-crystal-ledger.test.mjs`）。
- 真库跑：`crystal_ledger` 出现 `n_runs>0` 的历史行；重跑脚本行数不变。
- CI 全绿。
