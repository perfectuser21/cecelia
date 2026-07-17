# Sprint PRD: migration-346-idempotent

task_id: 874c9cc8-8afe-47c5-a3ed-e1dce93abda4
journey_type: fix
target_environment: local_api
sprint_dir: sprints/07170530-migration-346-idempotent

---

## 背景

07-17 晨实证：staging 库存在旧结构 incidents 表（无 fingerprint 列）。
346 迁移的 `CREATE TABLE IF NOT EXISTS` 跳过建表，但随后建索引引用 fingerprint 列时爆炸，
Brain 崩溃循环 5 小时无人知晓（金丝雀考场因此塌）。
管家止血：两库空旧表改名 incidents_legacy_pre346。
根治目标：迁移自身幂等 + 扩大 dev/preview 库同雷排查 + Brain 启动崩溃循环加上限。

---

## 问题分析

**根因 1**：`346_incidents.sql` 使用 `CREATE TABLE IF NOT EXISTS`，当旧结构表（缺 fingerprint 列）已存在时跳过建表，随后 `CREATE INDEX ON incidents(fingerprint)` 报 column not exist，整条迁移失败。

**根因 2**：`server.js` 中迁移失败重试逻辑：3 次失败后 `process.exit(1)`，但容器重启策略触发无限重启，5 小时无 Bark 告警，形成静默崩溃循环。

---

## 功能需求（FR）

### FR-1：346 迁移路径 A（incidents 表存在且为空 + 缺 fingerprint 列）
- 检测条件：`information_schema.columns` 判断 incidents 表存在 AND fingerprint 列不存在
- 空表判断：`SELECT COUNT(*) FROM incidents` = 0
- 执行：`ALTER TABLE incidents RENAME TO incidents_legacy_pre346`，再 `CREATE TABLE incidents`（完整结构含 fingerprint）

### FR-2：346 迁移路径 B（incidents 表存在且非空 + 缺 fingerprint 列）
- 检测条件：incidents 表存在 AND fingerprint 列不存在 AND COUNT(*) > 0
- 执行：`ALTER TABLE incidents ADD COLUMN fingerprint TEXT`（先允许 NULL），回填占位值（`gen_random_uuid()::text`），再 `ALTER COLUMN fingerprint SET NOT NULL`，加 UNIQUE 约束

### FR-3：346 迁移幂等性
- 路径 A 和路径 B 均可重复执行（第 2 次运行时 fingerprint 列已存在，跳过所有操作）
- 已有完整结构表：直接跳过，不报错

### FR-4：dev/preview 库同雷排查
- PR 描述中报告 `cecelia_dev` / `cecelia_preview_*` 各库 incidents 表结构状态
- 通过 `psql` 列出并检查 fingerprint 列是否存在

### FR-5：Brain 启动迁移失败上限 + Bark 告警
- `server.js` 迁移重试 3 次后：发送 Bark 告警（含错误摘要），然后 `process.exit(1)`
- 容器重启策略负责重启；不允许进程自身无限循环

### FR-6：失败测试先行（TDD）
- 在 `packages/brain/src/__tests__/integration/` 新建 `migration-346.integration.test.js`
- 用真实 PG（brain-integration CI job），禁 mock 迁移执行
- fixture：在测试库建旧结构 incidents 表（无 fingerprint 列），插入 0 行（路径 A）
- 断言：现版本 346 迁移执行后 incidents 表含 fingerprint 列
- 断言：幂等重跑（第 2 次运行）通过且无报错

---

## 非功能需求（NFR）

- 迁移文件修改后，`CREATE TABLE IF NOT EXISTS` 改为显式检测 + 条件分支（DO $$ BEGIN ... END $$）
- 迁移文件行数限制：不超过 80 行（当前 24 行，新增条件分支后估算 ~60 行）
- Bark 告警格式：`[Brain FATAL] Migration failed after 3 attempts: <err.message>` + 时间戳
- 测试文件使用 vitest，走 `brain-integration` job（PostgreSQL service container）
- 不引入 mock，必须对真实 PG 执行

---

## Invariant 约束

- **INV-1**：迁移后 incidents 表必须含 fingerprint TEXT NOT NULL UNIQUE 列
- **INV-2**：346 迁移在同一库运行两次，第二次必须无错误退出（幂等）
- **INV-3**：旧结构空表路径下，旧表改名为 incidents_legacy_pre346，不丢数据
- **INV-4**：旧结构非空表路径下，现有行的 fingerprint 占位值不为 NULL（约束升级前回填完成）
- **INV-5**：Brain server.js 迁移最多重试 3 次，失败后必须 process.exit(1) + Bark 告警，不允许无上限循环

---

## 累积 FR

| FR | 描述 | 来源 |
|----|------|------|
| FR-1 | 346 迁移路径 A（空旧表 rename + 重建） | PrepPRD |
| FR-2 | 346 迁移路径 B（非空旧表 ALTER 补列） | PrepPRD |
| FR-3 | 346 迁移幂等性（两次运行均通过） | PrepPRD |
| FR-4 | dev/preview 库同雷排查并在 PR 中报告 | PrepPRD |
| FR-5 | Brain 启动迁移失败上限 + Bark 告警 | PrepPRD |
| FR-6 | TDD：failing test 先行，真实 PG，brain-integration job | PrepPRD |

---

## 验收标准（E2E 断言）

1. `migration-346.integration.test.js`：fixture 旧结构表（无 fingerprint）→ 执行 346 → `information_schema.columns WHERE table_name='incidents' AND column_name='fingerprint'` 返回 1 行
2. 幂等断言：再次执行 346 迁移函数，无抛出错误
3. server.js 单元/集成：模拟迁移连续失败 3 次 → Bark notifier 被调用 + process.exit(1) 触发
4. PR 描述包含 cecelia_dev / cecelia_preview_* 库 incidents 表结构扫描结果

---

## 实现文件清单

| 文件 | 操作 |
|------|------|
| `packages/brain/migrations/346_incidents.sql` | 改写：加 DO $$ 条件分支（路径 A/B/幂等跳过） |
| `packages/brain/server.js` | 修改：迁移失败 3 次后加 Bark 告警再 exit |
| `packages/brain/src/__tests__/integration/migration-346.integration.test.js` | 新建：TDD failing test |

---

## 排期

单 Sprint，estimate: 4h
- T0：写 failing test（30min）
- T1：改写 346 SQL（60min）
- T2：改 server.js Bark 告警（30min）
- T3：dev/preview 库扫描 + PR 报告（30min）
- T4：验证 CI green + 幂等（60min）
