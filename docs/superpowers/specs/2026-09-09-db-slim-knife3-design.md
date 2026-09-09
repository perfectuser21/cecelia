# 设计：库瘦身第三刀——superseded 投影清理 + 长尾收紧

- Brain task：`2216b3c8-c13b-4d18-a82d-417c1d316d0a`；前序：#5250（刀1）、#5258（刀2）
- 目标：库 1879MB → ≤900MB；active 投影不动、Brain 在线
- 用户拍板：cecelia_events 收紧 7 天（对齐 migrations/041 既有语义）；superseded 投影删除沿用决策 b3d64d59 的 fail-closed 立场（钉住回溯查不到 → 503，不静默）

## 规则变更（packages/brain/src/db-slim-rules.js）

**新增 4 条**（追加在 SLIM_RULES 末尾，顺序即删除顺序，FK：edges→nodes→runs 先子后父）：

| # | name | table | 条件 |
|---|---|---|---|
| 10 | map_projection_edges_superseded | map_projection_edges | `NOT EXISTS (SELECT 1 FROM map_projection_runs r WHERE r.id = map_projection_edges.run_id AND r.status = 'active')` |
| 11 | map_projection_nodes_superseded | map_projection_nodes | 同构（nodes.run_id） |
| 12 | map_projection_runs_superseded | map_projection_runs | `status <> 'active'` |
| 13 | harness_attempts_terminal_old | harness_attempts | `created_at < NOW() - INTERVAL '30 days' AND status IN ('completed','completed_with_concerns','failed','cancelled')` |

**修改 2 条参数**：
- `cecelia_events_old`：`'30 days'` → `'7 days'`（deleteWhere/archiveWhere/preAssert 三处同步）
- `memory_stream_selfmodel_history`：`LIMIT 30` → `LIMIT 5`

规则 10-12 的 archiveWhere = deleteWhere（条件不依赖前序删除；runs 行在 edges/nodes 删除前后语义一致）。

## 配套

- `db-slim-rules.test.js`：名单 9→13 条；新增规则 10-13 断言（表名/条件/顺序 edges<nodes<runs）；改 events 7 天与 self_model LIMIT 5 的既有断言
- `db-slim-smoke.sh`：RULE_COUNT 9→13
- 版本 bump + DevGate 三件套

## 运维序列（主会话）

1. dry-run 核数（edges ~45.1万/nodes ~41.1万/runs 4672/attempts ~1331）
2. `--apply --archive-dir ~/cecelia-backups/db-slim-20260909-knife3`
3. 全库 `vacuumdb --full --analyze -d cecelia`（回收从未 vacuum 的长尾死空间 ~300MB；逐表短锁，Brain 在线）
4. 验收：库 ≤900MB；active 投影完好（map API 200、active run 的 nodes/edges 行数不变）；Brain /context 200；归档可读；核心表零变化

## 测试策略

- unit：规则守护断言（先红后绿）
- E2E：运维序列真实查库验收
- 守卫：既有 db-size-check.sh + smoke（RULE_COUNT 断言防规则丢失）

## 不做

- projection_outbox/suggestions 等小表的行清理（vacuumdb 回收死空间已够，行是活数据）
- tasks 表清理（业务台账，只 vacuum）
- us-vps 迁移准备（下一任务）
