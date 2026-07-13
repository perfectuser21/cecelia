# Migration 341 search_path 事故修复 — 设计

## 背景

2026-07-13 夜间，PR #3847（cp-07131334-zenithjoy-schema，migration 341）在未合并、CI 未过的情况下被 headless dev task 对生产库真实执行，其中一行 `ALTER DATABASE cecelia SET search_path = zenithjoy, public;` 是数据库级别全局设置，导致 Brain 自己裸写的 `tasks(goal_id)` 优先解析到 ZenithJoy 同名但结构不同的 `zenithjoy.tasks` 表，Brain 生产容器 crash-loop。已手动回滚生产库状态（search_path 改回 public，5 张裸表移回 public schema）。CI 里 `brain-integration`/`real-env-smoke` 两个 job 也因同一行报错（`get_database_oid` — CI 隔离库名不是 `cecelia`，ALTER DATABASE 硬编码库名进一步暴露该语句的脆弱性）。

## 目标

1. migration 341 不再包含任何数据库级别的全局副作用语句
2. ZenithJoy 的 better-auth（5 张裸表 user/session/account/verification/operator_sessions）能在表被移到 `zenithjoy` schema 后继续正常工作，但方式改为 ZenithJoy **自己连接层**的 search_path 设置，而不是数据库级别
3. 加一条永久 CI 守卫：任何 `packages/brain/migrations/*.sql` 文件出现 `ALTER DATABASE` 一律拦截，防止同类事故复发
4. 修掉 PR #3847 现有全部 CI 失败项，使其可以正常合并

## 架构

**Cecelia 侧（当前 worktree，PR #3847 分支）**：
- 修改 `packages/brain/migrations/341_zenithjoy_schema_move.sql`：删除 `ALTER DATABASE cecelia SET search_path = zenithjoy, public;` 一行，只保留 5 张表的 `ALTER TABLE ... SET SCHEMA zenithjoy`
- 新增 `packages/brain/src/__tests__/migration-341.test.js`：读取 SQL 文件断言（不连接真实 DB，避免 CI flaky）
  - 断言 341 文件不含 `ALTER DATABASE`
  - 断言 5 张表的 `SET SCHEMA zenithjoy` 语句都在
  - 断言迁移幂等（`DO $$` + `IF EXISTS`）
  - 全局守卫：扫描 `packages/brain/migrations/` 目录下所有 `.sql` 文件，任何一个含 `ALTER DATABASE` 就失败
- 新增 `packages/brain/scripts/smoke/zenithjoy-schema-migration-smoke.sh`：满足 `lint-feature-has-smoke` 要求，做同等的文件内容断言（真环境冒烟，不连接生产库）
- 两次 commit（TDD 纪律）：commit 1 = 新增 failing test（此时 341 文件还含 ALTER DATABASE，测试应报红）；commit 2 = 修 341 文件 + smoke.sh，测试转绿

**ZenithJoy 侧（另一 repo `/Users/administrator/perfect21/zenithjoy`，另开 PR）**：
- 修改 `apps/api/src/db/connection.ts`：给 `new Pool({...})` 配置加一项 `options: '-c search_path=zenithjoy,public'`
- 这是 **PostgreSQL 连接级别**的 session 参数（通过 startup packet 传递），只对 ZenithJoy 自己发起的这些连接生效，不影响数据库全局默认值，因此不会影响 Brain 的连接
- 新增测试：`apps/api/src/db/__tests__/connection.test.ts`（或该repo现有测试目录约定），断言 Pool 配置对象里含正确的 `options` 字段（不依赖真实连接，纯配置断言）

**生产验证顺序（PR 合并后，人工/脚本执行，不在 CI 里）**：
1. 先在 `cecelia_test` 库上跑一遍修正后的 migration 341，确认没有 ALTER DATABASE 副作用、5 张表正确落在 zenithjoy schema
2. 确认 Brain 用 `cecelia_test` 连接跑一次 health check 正常（无 goal_id 报错）
3. 再对生产 `cecelia` 库执行修正后的 migration
4. 生产 Brain 健康检查 + ZenithJoy `/api/auth/get-session` 健康检查都过
5. 解锁 Brain Initiative 0935f962 的 Task1（标记完成）+ Task2（解除 blocked）
6. 更新 Notion P0 issue `ad16e103` 为已修复，附 PR 链接

## 测试策略

- **Unit（Cecelia）**：SQL 文件内容断言，不连接 DB，稳定不 flaky，CI 秒级跑完
- **Unit（ZenithJoy）**：Pool 配置对象断言，不建立真实连接
- **Integration（CI 自带）**：`brain-integration`/`real-env-smoke` 两个既有 job 会在隔离测试库上真实跑一遍全部 migrations（含修正后的 341），验证不再报 `get_database_oid` 或 `goal_id` 错误
- **手动生产验证**：按上方"生产验证顺序"，先测试库再生产库，每步都有可观察的健康检查结果

## 不包含

- 不在本次处理 Task2（ZenithJoy tasks/cecelia_events 跨库直连改走 API）——那是 Initiative 里独立的下一个 Task
- 不处理 sprint_features/properties 等孤儿表清理——不影响本次事故修复范围
