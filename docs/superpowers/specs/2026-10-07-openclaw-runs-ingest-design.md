# OpenClaw 运行记录入库 + Notion「最近执行」库 设计

- 任务：2ffa095e（父 40627a17）；决策：c7ff6e02（记录落库同步 Notion，不推飞书）、9ec7a010（本功能三点拍板）、ff2019e2（runs 执行记录模型）
- 判定点：b7be0e26（结果按 task_runs.status 判）、6d4b7ed5（任务名取 cron_jobs.name，回退 job_id 前 8 位）

## 背景与目标

OpenClaw 网关（MMV 本机）的 cron 每跑一次就往飞书「VPS 状态」群贴结果，累计 3000+ 条未读。10-07 已关掉全部群投递，但运行记录目前只躺在 MMV 的 OpenClaw 本地 SQLite 里，主理人看不到。

目标：OpenClaw 每次 cron 运行 → Brain `runs` 表一行 → Notion「最近执行」库一页。主理人在 Notion 看运行情况，飞书不再承担记录职能。

## 范围

做：
1. 采集：Brain 定时任务 `openclaw-run-ingest`（每 300s）经宿主 `ssh mmv` 只读查询 OpenClaw SQLite，增量 upsert 进 `runs`。
2. 失败升级：同一 OpenClaw 任务连续失败 ≥3 次 → 发一次 Bark（同一连败段只发一次）。
3. 投影：Brain 定时任务 `runs-notion-push`（每 120s）把窗口内的 runs 推到 Notion「最近执行」库，移出窗口的页归档。
4. 一次性：建 Notion 库脚本；近 30 天回填由采集任务首轮自然完成（见游标）。

不做：spans 投影、token 上报、ops_workflows 收口、修 OpenClaw 哨兵 SOP 读不到问题（另立）。

## 数据源（MMV `~/.openclaw/state/openclaw.sqlite`，只读）

`task_runs WHERE runtime='cron'`：每次 cron 运行一行（实测 3919 行）。

| 源字段 | 用途 |
|---|---|
| task_id | 唯一键 → `runs.run_id = 'openclaw:' || task_id` |
| source_id | cron job id |
| agent_id | 执行者 |
| status | succeeded/failed/timed_out/running/其他 |
| created_at / started_at / ended_at / last_event_at（ms） | 起止、增量游标 |
| terminal_summary | 当次结果摘要（以前发群的那段话） |
| error | 错误文本 |

`LEFT JOIN cron_jobs ON cron_jobs.job_id = task_runs.source_id` 取 `name`、`payload_kind`（一次性 at 任务跑完被删，约一半行 join 不上）。

查询方式：SQL 经 base64 编码后拼进命令（无引号转义问题）：
`ssh -o BatchMode=yes -o ConnectTimeout=20 mmv 'echo <b64> | base64 -d | sqlite3 -readonly -json ~/.openclaw/state/openclaw.sqlite'`，外层经 `buildHostCmd` 逃出容器，用 `defaultExecAsync`（禁 execSync，超时 60s）。

## 映射到 runs

| runs 列 | 值 |
|---|---|
| run_id | `openclaw:<task_id>` |
| trigger_kind | `schedule` |
| trigger_ref | 任务名：`cron_jobs.name` → 否则 `openclaw-job:<job_id 前 8 位>` |
| schedule_entry_id / workflow_id | LATERAL 查 `ops_schedule_entries WHERE source='openclaw' AND label=<任务名>`，按 active DESC, id 取一行；查不到留空 |
| executor_kind | payload_kind=`command` → `code`；否则 `agent` |
| executor_id | `openclaw:<agent_id>`（空则 `openclaw`） |
| started_at | started_at ?? created_at |
| ended_at | ended_at（running 为空）；若 < started_at 则置 started_at |
| outcome | succeeded→pass，failed→fail，timed_out→timeout，running/queued→running，其他→unknown |
| error | error 截 2000 字 |
| detail | `{source:'openclaw', job_id, task_id, summary(截 4000), status}` |
| header_source | `owner` |

写法：`INSERT ... ON CONFLICT (run_id) DO UPDATE SET ended_at, outcome, error, detail, updated_at=now() WHERE runs.outcome IS DISTINCT FROM EXCLUDED.outcome OR runs.ended_at IS DISTINCT FROM EXCLUDED.ended_at OR runs.detail IS DISTINCT FROM EXCLUDED.detail`（running → 终态时更新；无变化不改，避免无谓重推）。

保留期沿用现有 `pruneSchedulerRuns`（trigger_kind='schedule'：成功 30 天、失败 90 天），不新增清理逻辑。

## 增量游标（断线自愈）

游标 = `SELECT max(started_at) FROM runs WHERE run_id LIKE 'openclaw:%'`。
- 游标为空（首轮）→ 拉近 30 天（即回填）。
- 否则拉 `coalesce(last_event_at, ended_at, created_at) >= 游标 - 1h` 的行，再并上所有 `status IN ('running','queued')` 的行。
- 每轮最多 2000 行，按 created_at 升序；满 2000 说明还有积压，下一轮继续（游标前移）。

MMV 断线几小时：游标停在断线前，恢复后自然补齐；upsert 幂等，不重复。

## 失败升级（Bark）

每轮写入后，对本轮出现 fail/timeout 的任务名，查该任务最近 3 条已结束运行：全为 fail/timeout → `sendBark('OpenClaw 任务连续失败', '<任务名> 连续 N 次失败：<最近错误/摘要前 120 字>', { dedupeKey: 'openclaw-run-streak:<任务名>:<本连败段第一条 run_id>', dedupeTtlSec: 7*86400 })`。连败段第一条 = 最近一次成功之后的第一条失败，因此同一连败段只发一次，恢复后再连败会重新发。首轮回填（游标为空）不发 Bark，避免历史连败一次性炸出来。

## 投影：Notion「最近执行」库

注册：`notion_projection_map` 加一行 `brain_table='runs'`（迁移先插 `pending_vessel` 占位，建库脚本填真 id 并置 active，同迁移 468 模式）。`runs` 加 `notion_id / notion_digest / notion_synced_at` 三列，复用 `notion-projection-engine.pushRegisteredRows`（指纹不变跳过、404 自动重建）。

窗口（决策 9ec7a010）：
- OpenClaw 运行（run_id `openclaw:%`）：最近 7 天全部；fail/timeout 保留 30 天。
- 其他 runs（Brain 内部定时任务、spans 外部上报）：只放 fail/timeout，30 天（实测 30 天 54 条）。

每轮：先推窗口内 `notion_digest` 缺失或变化的行（≤100 行，按 started_at DESC）；再把已有 `notion_id` 但移出窗口的行归档（PATCH archived=true，≤100 行）并清空三列。

列（全部来自 Brain）：

| 列 | 类型 | 来源 |
|---|---|---|
| 任务 | title | trigger_ref |
| 开始时间 | date | started_at |
| 结果 | select（成功/失败/超时/运行中/跳过/未知） | outcome |
| 耗时（秒） | number | duration_ms/1000 |
| 执行者 | rich_text | executor_id |
| 来源 | select（OpenClaw/Brain/外部上报） | run_id 前缀 + trigger_kind |
| 摘要 | rich_text（≤1900 字） | detail.summary |
| 错误 | rich_text（≤1900 字） | error |
| Brain ID | rich_text | run_id |

建库：`packages/brain/scripts/ops/create-runs-notion-db.mjs`（默认 dry-run，`--apply` 才建），父页复用目录投影配置的 `parent_page_id`，建好后更新 `notion_projection_map` 并置 active。库未注册（pending）时投影 job 直接跳过，不报错。

## 错误处理

| 场景 | 行为 |
|---|---|
| ssh mmv 失败/超时 | 本轮抛错 → 调度器记一行 fail（现有 writeRun）；游标不动，恢复后补齐 |
| sqlite 返回非 JSON | 抛 parse_error，不写库 |
| 返回 0 行 | 正常（安静时段），不当异常 |
| 单行映射失败（时间戳非法等） | 跳过该行并计数，进本轮结果 `skipped_rows`，不拖垮整批 |
| Notion 429/5xx | 本轮停止推送，下轮继续（digest 未写即会重推） |
| Notion 页 404/已归档 | 引擎清 notion_id，下轮重建 |
| Bark 失败 | 只打日志（sendBark 不抛） |

## 测试策略

- **unit**（vitest）：SQL 构造（游标/首轮/running 并集）、base64 命令拼装、行映射（每个 status、名字回退、ended<started、截断、非法时间戳跳过）、连败判定与 dedupeKey、首轮不发 Bark、窗口判定、Notion 属性构造。
- **integration**（`*.pg.integration.test.js`，真 Postgres）：upsert 幂等（同一批写两次行数不变）、running→pass 更新、schedule_entry_id 经 label 解析、游标查询、窗口查询与归档清列。
- **smoke**（`packages/brain/scripts/smoke/openclaw-run-ingest-smoke.sh`，只读）：查 `runs` 中 `openclaw:%` 行存在且关键字段非空；登记 smoke-allowlist。
- **E2E 验收**（上线后真环境）：生产库 `runs` 有 OpenClaw 行，抽 3 条与 MMV SQLite 逐字段比对；Notion「最近执行」库可见今晚班会/日间巡检运行且摘要与以前发群文本一致；人为让一轮 ssh 失败后恢复，期间运行被补齐且不重复。

## 文件清单

| 文件 | 内容 |
|---|---|
| `packages/brain/migrations/532_runs_notion_projection.sql` | runs 加三列 + projection_map 占位行 |
| `packages/brain/src/openclaw-run-ingest.js` | 采集：SQL/命令构造、行映射、upsert、游标、连败 Bark |
| `packages/brain/src/runs-notion-projection.js` | 投影：窗口查询、属性构造、推送、归档 |
| `packages/brain/src/scheduler-jobs.js` | 注册两个 job |
| `packages/brain/scripts/ops/create-runs-notion-db.mjs` | 一次性建库 |
| `packages/brain/scripts/smoke/openclaw-run-ingest-smoke.sh` + quality 登记 | smoke |
| `changes/cp-1007231057-openclaw-runs-ingest.md` | 版本碎片（feat） |
| 测试文件若干 | 见测试策略 |
