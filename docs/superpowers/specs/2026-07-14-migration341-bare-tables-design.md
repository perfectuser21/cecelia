# Design: 补做 migration 341 — 5张裸表归位 zenithjoy schema + 同步到独立库

## 背景

`schema_version` 记录 341 已完成，但实际 5 张 Better Auth 裸表（`user`/`session`/`account`/`verification`/`operator_sessions`）仍在 `cecelia` 库 `public` schema，独立 `zenithjoy` 库里没有这 5 张表。用户已拍板方案(a)：补做迁移，让实际状态追上记录状态。决策记录 `92b45f80`。

## 目标

1. `cecelia` 库：5 张表从 `public` 移入 `zenithjoy` schema（数据原地不动，FK 按 OID 自动跟随）
2. 独立 `zenithjoy` 库：新增这 5 张表的数据副本
3. 全程可回滚（迁移前 `pg_dump` 全量备份）

## 方案

新增一个一次性运维脚本 `scripts/migrate-341-bare-tables.sh`，遵循 `scripts/zenithjoy-db-compare.sh` 的既有代码风格（bash + psql，同目录）：

```
Step 1: pg_dump 备份 cecelia 库 5 张表到本地文件（scratch 目录，不进 repo）
Step 2: 用 psql 手动执行 packages/brain/migrations/341_zenithjoy_schema_move.sql
        （文件已幂等，DO $$ 块判断表是否已在 zenithjoy schema）
Step 3: pg_dump -n zenithjoy -t 'zenithjoy.<table>' 从 cecelia 库导出这5张表（此时已在zenithjoy schema下）
Step 4: psql 导入独立 zenithjoy 库
Step 5: 行数比对（cecelia.zenithjoy.<table> vs zenithjoy.zenithjoy.<table>），不一致则报错退出非0
```

脚本不在 CI 里跑（是一次性生产运维动作，不是回归测试），但要配一条**守卫**：迁移后追加到 `scripts/zenithjoy-db-compare.sh` 的 `TABLES` 数组里，让这5张表纳入已有的每日双写验证巡检，形成"对种类、在对环境跑、被人巡检"的环境类守卫（migration 是一次性操作，不适合逻辑类 CI test）。

## 错误处理

- pg_dump 失败 → 脚本 `set -euo pipefail` 直接退出，不执行后续步骤
- 迁移 SQL 执行失败 → DO 块内 IF EXISTS 判断防止重复执行报错；若真报错，5张表数据未受影响（ALTER TABLE SET SCHEMA 是原子操作）
- 行数比对不一致 → 脚本报错退出，保留两边数据供人工排查，不自动重试/自动删除

## 测试策略

- Manual：迁移后立即在脚本内做行数比对断言，不一致直接失败退出
- 无 unit test（这是一次性数据迁移操作，非可复用逻辑）；守卫是加入 `zenithjoy-db-compare.sh` 的日常巡检

## 范围外

- 不改 ZenithJoy 后端连接配置（已有 `search_path=zenithjoy,public`，见 migration 文件注释）
- 不涉及 ZenithJoy prod `DATABASE_NAME` 切换（仍在双写验证期，截止 2026-07-16，另有任务负责）
