# Contract Draft: migration-346-idempotent

task_id: 874c9cc8-8afe-47c5-a3ed-e1dce93abda4
sprint_dir: sprints/07170530-migration-346-idempotent
proposer_round: 1
status: proposed

---

## 背景摘要

346_incidents.sql 使用 `CREATE TABLE IF NOT EXISTS`，当旧结构 incidents 表（缺 fingerprint 列）已存在时跳过建表，但随后的 `CREATE INDEX ON incidents(fingerprint)` 因列不存在爆炸，Brain 5 小时静默崩溃循环。本 sprint 根治三个问题：迁移幂等、Brain 重试上限+Bark 告警、TDD 集成测试。

---

## 功能范围

| FR | 描述 |
|----|------|
| FR-1 | 346 迁移路径 A：旧结构空 incidents 表 → RENAME TO incidents_legacy_pre346 + 重建完整表 |
| FR-2 | 346 迁移路径 B：旧结构非空 incidents 表 → ALTER 补 fingerprint 列（NULL→回填→NOT NULL+UNIQUE） |
| FR-3 | 346 迁移幂等性：第 2 次执行无错误退出（fingerprint 已存在则跳过所有操作） |
| FR-4 | dev/preview 库同雷排查：PR 描述中报告各库 incidents 表 fingerprint 列状态 |
| FR-5 | Brain server.js 迁移失败 3 次后：sendBark + process.exit(1)，禁无上限自重启 |
| FR-6 | TDD：migration-346.integration.test.js，真实 PG，brain-integration CI job |

---

## 实现文件清单

| 文件 | 操作 |
|------|------|
| `packages/brain/migrations/346_incidents.sql` | 改写：DO $$ 条件分支，覆盖路径 A / 路径 B / 幂等跳过 |
| `packages/brain/server.js` | 修改：迁移失败 3 次后调用 `sendBark` 再 `process.exit(1)` |
| `packages/brain/src/__tests__/integration/migration-346.integration.test.js` | 新建：集成测试（路径 A + 幂等断言） |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 路径 A：空旧表改名+重建 | `../../packages/brain/src/__tests__/integration/migration-346.integration.test.js` | BEHAVIOR-1-a: incidents 表 fingerprint 列存在 / BEHAVIOR-1-b: fingerprint 列 NOT NULL / BEHAVIOR-1-c: 旧表已改名为 incidents_legacy_pre346 / BEHAVIOR-1-d: 旧表数据不丢失（0 行）/ [BEHAVIOR-5] 路径 A 后 fingerprint NOT NULL UNIQUE 成立 | → `column "fingerprint" does not exist` 或 `CREATE INDEX` 报错 |
| 幂等性：第 2 次运行无错误 | `../../packages/brain/src/__tests__/integration/migration-346.integration.test.js` | BEHAVIOR-2-a: 第 2 次运行不抛出任何错误 / BEHAVIOR-2-b: 重跑后 fingerprint 列仍存在 / [BEHAVIOR-5] 幂等重跑后 fingerprint NOT NULL UNIQUE 仍成立 | → 第 2 次运行抛出 `column "fingerprint" already exists` 或索引冲突 |
| 路径 B：非空旧表补列回填 | `../../packages/brain/src/__tests__/integration/migration-346.integration.test.js` | BEHAVIOR-3-a: fingerprint 列存在 / BEHAVIOR-3-b: 无 NULL fingerprint（全部回填）/ BEHAVIOR-3-c: 行数不变（原有 2 行不丢失）/ [BEHAVIOR-5] 路径 B 后 fingerprint NOT NULL UNIQUE 成立 | → 现版本跳过 `IF NOT EXISTS`，非空表路径无法触达 |
| Brain 重试上限 + Bark + exit(1) | `../../packages/brain/src/__tests__/integration/migration-346.integration.test.js` | BEHAVIOR-4: mock runMigrations 3 次失败 → sendBark 调用含 [Brain FATAL] + exit(1) | → 现版本无上限循环，sendBark 调用次数为 0 |

**gate-allow 记录**：BEHAVIOR-4 使用 mock runMigrations（验证重试上限行为），其余 BEHAVIOR-1~3 使用真实 PG（brain-integration CI job 提供 DATABASE_URL），禁 mock 迁移执行。

---

## E2E 验收

### 验收场景 1：路径 A（空旧表）

**前置**：测试库存在旧结构 incidents 表（无 fingerprint 列，COUNT=0）

**执行**：调用 346 迁移函数

**断言**：
1. `SELECT column_name FROM information_schema.columns WHERE table_name='incidents' AND column_name='fingerprint'` 返回 1 行
2. `SELECT column_name FROM information_schema.columns WHERE table_name='incidents' AND column_name='fingerprint' AND is_nullable='NO'` 返回 1 行（NOT NULL）
3. `SELECT table_name FROM information_schema.tables WHERE table_name='incidents_legacy_pre346'` 返回 1 行（旧表已改名）
4. `SELECT COUNT(*) FROM incidents_legacy_pre346` 等于原始行数（0 行不丢失）

### 验收场景 2：幂等性

**前置**：场景 1 执行完毕后，incidents 表已含完整结构

**执行**：再次调用 346 迁移函数

**断言**：
1. 函数执行不抛出任何错误（无 exception / rejected promise）
2. `SELECT column_name FROM information_schema.columns WHERE table_name='incidents' AND column_name='fingerprint'` 仍返回 1 行

### 验收场景 3：路径 B（非空旧表，手动验证）

**前置**：构造非空旧结构 incidents 表（无 fingerprint 列，COUNT>0）

**执行**：调用 346 迁移函数

**断言**：
1. `SELECT column_name FROM information_schema.columns WHERE table_name='incidents' AND column_name='fingerprint'` 返回 1 行
2. `SELECT COUNT(*) FROM incidents WHERE fingerprint IS NULL` 返回 0（回填完成）
3. `SELECT COUNT(*) FROM incidents` 等于原始行数（无数据丢失）

### 验收场景 4：Brain 迁移失败上限（单元验证）

**前置**：mock runMigrations 使其每次抛出错误

**执行**：启动 server.js 迁移流程

**断言**：
1. `sendBark` 被调用，title 含 `[Brain FATAL]`，body 含错误摘要和时间戳
2. `process.exit(1)` 被调用
3. 总调用次数 = 3（不超过 3 次重试）

---

## 铁律映射

| Invariant | 覆盖验收场景 |
|-----------|-------------|
| INV-1：fingerprint TEXT NOT NULL UNIQUE | 场景 1 断言 1+2、场景 2 断言 2 |
| INV-2：同库运行两次无错误 | 场景 2 断言 1 |
| INV-3：空表改名不丢数据 | 场景 1 断言 3+4 |
| INV-4：非空表回填后无 NULL | 场景 3 断言 2 |
| INV-5：最多 3 次重试 + exit(1) + Bark | 场景 4 断言 1+2+3 |

---

## 开放问题

1. 路径 B 集成测试：是否在 CI brain-integration job 中也测非空表路径，还是仅 manual 验证？（建议 CI 也覆盖，但需要 fixture 插入数据）
2. sendBark 的 dedupeKey：迁移失败告警是否需要幂等去重键（防止容器反复重启发送重复告警）？
