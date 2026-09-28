# 设计：大脑库 A 类 37 张空表清理 + capture-atoms event 分支修正

- 决策：28674999（主理人拍板 A 类直接删）、9ecb9628（bug-fix）
- Brain 任务：6227b8c1
- 清单与备份：`~/db-backups/brain-empty-tables-20260928/`（empty-tables-review.md、brain-76-empty-tables.sql）

## 目标
1. 删除 A 类 37 张空表及 5 个依赖视图。它们在 packages/brain、apps/api、scripts 中没有任何 SQL 读写（逐表 git grep 核实），部分来自拆库前 ZenithJoy、早期删掉的功能、迁移改名备份。
2. 修 `routes/capture-atoms.js` 的 `event` 分支：它向 `events`（实为网页分析表）插入不存在的 name/notes/area_id 列，一触发即 500。历史 0 条 event 类原子，唯一入口是人工复核改判。

## 方案（选定）
- 迁移 `480_drop_empty_tables_class_a.sql`：
  1. 安全闸：DO 块逐表 `to_regclass` 存在才 `count(*)`，任一非空 `RAISE EXCEPTION`，整个迁移回滚——审计后若有表被写入，拒绝删除。
  2. `DROP VIEW IF EXISTS` 5 个视图。
  3. 单条 `DROP TABLE IF EXISTS <37 张>`，**不用 CASCADE**（组内外键一条语句内一起删；若出现清单外依赖，迁移失败而非静默连带删除）。
  4. 登记 schema_version 480。
- 回滚 `rollback/480_...down.sql`：由生产 `pg_dump -s` 生成的 37 表 + 5 视图原样 DDL，删 schema_version 480。
- capture-atoms：删除 `event` case；`routeAtomToTarget` 对未知 target_type 抛带 `statusCode=400` 的错误，confirm 路由映射为 400（原来是 500）。
- 不改 selfcheck `EXPECTED_SCHEMA_VERSION`（仍 430，自检是下限）；不碰版本五件套，条目走 `changes/` 碎片。

备选（未选）：CASCADE 一把删——会静默带走清单外依赖；只删表不加闸——审计与合并之间若有写入会丢数据。

## 测试策略
- unit：`migration-480-...test.js` 静态断言 37 表全在 DROP、无 CASCADE、有非空闸、5 视图、schema_version、回滚含 37 个 CREATE TABLE。
- unit（regression，先红后绿）：capture-atoms confirm `target_type=event` → 400，且不发出任何 `INSERT INTO events`。
- 实库：cecelia_test 上 up → down → up 重放。
