# 设计：Cecelia 库瘦身第一刀（db-slim）

- Brain task：`5f1a4304-cefa-4831-baf9-622244f07e60`
- 决策：`2fd5cb47`（方案拍板）、`b3d64d59`（判定点：不保留合同钉住 revision）
- 目标：库 9628MB → ≤2GB；核心表（decisions/tasks/journeys/journey_features）零触碰；Brain 在线不停机
- 前置审查：Research Subagent 对全部读方逐一核过（见「删除安全性证据」），唯一硬阻碍已纳入规则 2 修正

## 组件

### 1. 纯规则模块 `packages/brain/src/db-slim-rules.js`

导出清理规则表与 SQL 构造函数，无副作用、可单测：

```js
export const SLIM_RULES = [/* 每条: { name, archiveSql, deleteSql, preAssertSql?, params } */];
export function buildCutoff(days) { ... }
```

规则（均先归档后删除，同一表的归档→断言→删除在一个事务外/内组织见执行器）：

| # | 表 | 删除条件 | 关键修正 |
|---|---|---|---|
| 1 | memory_stream | `expires_at IS NOT NULL AND expires_at < now()`（454,493 行） | 与已执行过的 migrations/173 逐字一致；核心检索路径本就过滤过期行 |
| 2a | graph_edge_snapshots | `(repo, source_revision)` 不在 active `map_projection_runs.fact_revisions` 集合内（删 ~239.6 万行，留 22,081 行） | 不保留合同钉住 revision（判定点 b3d64d59） |
| 2b | graph_snapshot_versions | 同一事务连带删除对应 `(repo, source_revision)` 行，**顺序先 2a 后 2b**（FK ON DELETE RESTRICT） | 不删则 `replaceRepoEdges` 触发 GRAPH_SNAPSHOT_IMMUTABILITY_VIOLATION，每日 scan-graph 永久红（审查硬阻碍） |
| 3 | cecelia_events | `created_at < now() - interval '30 days'` | 删前断言：`cortex_analyses.event_id` 指向待删行数必须为 0（FK NO ACTION）；migrations/041 既有策略是 7 天，本规则更保守 |
| 4 | alertness_metrics | `"timestamp" < now() - interval '14 days'`（用 timestamp 列，走索引） | migrations/041 既有策略 3 天，更保守 |
| 5a | checkpoints | `(checkpoint->>'ts')::timestamptz < now() - interval '7 days'`（删 ~100,083 行） | 实测无任何活跃/parked 任务持有超 7 天 checkpoint |
| 5b | checkpoint_writes | 孤儿清理：`(thread_id, checkpoint_ns, checkpoint_id)` 不在剩余 checkpoints | |
| 5c | checkpoint_blobs | thread 级保留：`thread_id` 不在剩余 checkpoints（宁多留） | LangGraph resume 只取最新 checkpoint，不遍历祖先 |

### 2. 执行器脚本 `packages/brain/scripts/db-slim.mjs`

模式（模仿 backfill-learning-embeddings.mjs：pg Pool + `DATABASE_URL`，默认 `postgres:///cecelia`）：

- `--dry-run`（默认）：逐规则报告命中行数、表体积、断言结果，不写库
- `--apply`：逐规则执行 归档 → 断言 → 事务内 DELETE；全部规则完成后逐表 `VACUUM FULL` + `ANALYZE`（`--no-vacuum` 可跳过）
- `--check --max-db-gb <n>`：库超阈值退出码 1（守卫模式，默认 4GB）
- `--archive-dir <dir>`：默认 `~/cecelia-backups/db-slim-<YYYYMMDD>/`

归档格式：每条规则 `COPY (SELECT * FROM <表> WHERE <删除条件>) TO STDOUT` 经 gzip 写 `<表名>.csv.gz`，写完校验文件存在且 >0 字节，失败则该规则整条跳过删除并计入失败退出码。只归档待删行（不整表 dump），恢复用 `\copy FROM`。

执行顺序细节：
- 规则 2a/2b 在同一事务（先边后版本）；其余每条规则各自事务
- VACUUM FULL 不能在事务里，逐表单独执行；Brain 在线，单表 ACCESS EXCLUSIVE 锁短暂阻塞可接受
- DELETE 分批（每批 50,000 行，`DELETE ... WHERE ctid IN (SELECT ctid ... LIMIT 50000)`）避免长事务压 WAL

### 3. 守卫（哨兵，proven-to-fire）

- 逻辑接缝：vitest 单测 `packages/brain/src/__tests__/db-slim-rules.test.js`——规则表完整性（5 组表全覆盖、核心表绝不出现在规则里）、删除条件与本设计逐字一致、cutoff 构造正确
- 环境接缝（库无限增长复发）：`packages/brain/scripts/cron/db-size-check.sh`（模仿 credentials-health-check.sh），调 `db-slim.mjs --check`，超阈值非零退出；proven-to-fire 验法：`--max-db-gb 0.001` 跑一次亲眼看报红
- 已知背景：migrations/041 建了 `cleanup_cecelia_events()`/`cleanup_alertness_metrics()`/`run_periodic_cleanup()` 但生产从未被调度（表才涨到 218 万行）——cron 脚本同时调用 `SELECT run_periodic_cleanup()`，让既有函数真正跑起来，防止 events/metrics 复涨

### 4. 已知知情接受的行为变化（删过期 memory_stream 行）

- orchestrator-chat buildNarrativesBlock：137 条 narrative 全过期（最后写于 2026-05-04），删后该段为空——本就是陈货
- rumination 候选池 1370→147——反刍的就该是未过期记忆
- ops.js 群聊印象：feishu_group TTL 7 天，删后低频用户（<3 条）跳过印象更新——与 TTL 语义一致

## 验收（Final E2E，真实查库）

1. `pg_database_size('cecelia')` ≤ 2GB
2. decisions/tasks/journeys/journey_features 删前删后 count 一致
3. memory_stream 剩余 = 总数 − 过期数（执行时以删前实测为准）；graph_edge_snapshots ≈ 22,081 行且 graph_snapshot_versions 无孤儿
4. 归档文件逐个存在且 >0 字节，抽一个 `zcat | head` 可读
5. Brain 健康：`/api/brain/context` 200；`node scripts/scan/scan-graph.mjs` 跑通不抛 IMMUTABILITY（硬阻碍回归验证）
6. `--check --max-db-gb 0.001` 报红一次（守卫 proven-to-fire）
7. vitest + CI 全绿

## 测试策略

- unit（vitest）：db-slim-rules 规则表与 SQL 构造（新增）
- integration：不新增（删除路径直接由生产执行 + 验收断言覆盖，dry-run 先行）
- E2E：上面 7 条验收，全部真实查库/真实执行，不 mock

## 不做

- memory_stream 无 expiry 的 63,533 条（保留策略另行拍板）
- parent_checkpoint_id 置 NULL（LangGraph resume 不受影响，时间旅行 API 本系统未用）
- pg_repack（引入依赖不值当，VACUUM FULL 够用）
- 备份迁对象存储/NAS（属迁移刀，不在本刀）
