# 小改动 PrepPRD：Cecelia 库瘦身（迁移前置·第一刀）

Brain task: 5f1a4304-cefa-4831-baf9-622244f07e60（已 claim: interactive-dev-skill）
来源: handoff 2026-09-09（Notion 3d6c40c2ba63812fbfa0c40d78f8e3e2），用户已拍板"现在开始"

## 改什么

新增一个可复跑的 DB retention/清理脚本（`packages/brain/scripts/db-slim.mjs`，含 `--dry-run` / `--apply` / `--archive-dir`），并用它执行第一刀清理：

**A 刀（安全清理，先归档后删除）：**
| 表 | 现状 | 保留策略（默认，可参数化） |
|---|---|---|
| graph_edge_snapshots | 1609MB / 242万行 | 保留最近 7 天 |
| cecelia_events | 781MB / 141万行 | 保留最近 30 天 |
| alertness_metrics | 542MB | 保留最近 14 天 |
| checkpoint_writes / checkpoint_blobs / checkpoints | 278+168+130MB | 保留最近 7 天（LangGraph 历史 checkpoint） |

**B 刀（记忆清理，仅过期部分）：**
- memory_stream：仅删 `expires_at IS NOT NULL AND expires_at < now()` 的 454,493 条（52 万条中 87%，数据自身已标过期）
- 实测：4.3G 大头在 TOAST 3992MB（embedding 列本体，非索引），必须 DELETE 后 VACUUM FULL 才回收
- **不动**：63,533 条无 expiry + 未过期条目（保留策略另行拍板，明确不在本刀范围）

**执行顺序：** 逐表 `pg_dump --table` 压缩归档到 `~/cecelia-backups/db-slim-<date>/` → 校验归档文件非空 → DELETE → VACUUM FULL（逐表，Brain 在线，单表短暂锁）→ 复测库大小 + Brain 健康。

## 为什么改

库 9.6G 是迁移 us-vps 的前置阻塞（先瘦后迁），同时缓解本机卡。大头全是运行累积（snapshots/events/过期记忆），核心数据 decisions/tasks/journeys 才几百 MB。

## 关联上下文

- 相关 Journey/Ability：无（基础设施运维，map_scope=database_foundation crosscut）
- 相关历史决策：decisions/match 无相近记录；handoff 内 7 条架构决策已在 Brain
- 撞车检查：gh pr list 搜 memory_stream/retention/vacuum/瘦身 均无 open PR

## 影响范围

- VACUUM FULL 逐表加 ACCESS EXCLUSIVE 锁，Brain 在线运行，单表锁期间相关查询短暂阻塞（分表执行、避开 tick 高峰即可，无需停 Brain）
- 删除均先归档，可从 `~/cecelia-backups/db-slim-<date>/` 恢复
- decisions / tasks / journeys / journey_features 等核心表零触碰

## 哨兵（守卫）

- 逻辑接缝：脚本的保留窗口 SQL 生成逻辑配 CI test（regression）
- 环境接缝（库无限增长复发）：db-slim 以 `--dry-run` 输出超限告警，接入每日巡检（launchd/recurring task，方案由 plan 阶段定）；proven-to-fire：人为设小阈值看它报红一次

## 验收标准

- [ ] 库 9628MB → ≤ 2GB（`pg_database_size`，真实查库验证）
- [ ] decisions/tasks/journeys/journey_features 行数删前删后一致（真实 count 对比）
- [ ] memory_stream 剩余行数 = 66,967（521,460 − 454,493）
- [ ] 归档文件存在且非空，抽验可 pg_restore 列出内容
- [ ] Brain 正常：`/api/brain/context` 200、tick 继续走
- [ ] 脚本 + 测试进 repo，CI 全绿
