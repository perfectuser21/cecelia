# 2026-04-25 schema 补全 callback_queue.retry_count + key_results.progress_pct

## 背景

Brain 启动连续报：
- `[health-monitor] callback_queue_stats query failed: column 'retry_count' does not exist`
- `[tick] KR health check failed: column g.progress_pct does not exist`

两个 silently degrade，影响 Layer2Health 输出与 KR Verifier 健康面板。

## 根因

- `packages/brain/src/health-monitor.js:124` 查询 `callback_queue.retry_count`，但 `callback_queue` 表无该列。
- `packages/brain/src/kr-verifier.js:126` 与 `kr3-progress-scheduler.js:46` 查询 `key_results.progress_pct`，但 `key_results` 表也无该列。

实际 DB schema（已确认）：
- `callback_queue` 仅有 `attempt`、`exit_code`、`failure_class` 等列。
- `key_results` 有 `progress` (integer)、`current_value` (numeric)，无 `progress_pct`。

## 设计

### 改动 1: 新建 migration

PRD 指定 `233_*.sql`，但 233 已被 `233_fix_thalamus_provider.sql` 占用（migrations 已到 244）。改用下一个可用编号 **245**。

文件：`packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql`

```sql
-- Migration 245: 补 callback_queue.retry_count + key_results.progress_pct
-- 修 Brain 启动 health-monitor + kr-verifier 的 silently-degrade 报错。

ALTER TABLE callback_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_callback_queue_retry_count
  ON callback_queue(retry_count) WHERE retry_count > 0;

ALTER TABLE key_results ADD COLUMN IF NOT EXISTS progress_pct DECIMAL(5,2) DEFAULT 0.0;
```

### 改动 2: 新建测试

文件：`packages/brain/src/__tests__/migration-245.test.js`

参考 `migration-041.test.js` 模板：用 `information_schema.columns` 验证两列存在 + 类型/默认值正确。

### 改动 3: 本地 apply migration

跑 `node packages/brain/migrations/run-migrations.cjs`（或手动 psql）让本地 DB 落地，确保 Brain 启动不再报错。

## 不做

- 不动 `current_value`/`progress` 等已有列。
- 不写回填脚本（DEFAULT 0.0 已覆盖）。
- 不改 `health-monitor.js`/`kr-verifier.js`（schema 补完后查询自然通）。

## 成功标准（DoD）

- [ARTIFACT] `packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql` 存在
- [ARTIFACT] `packages/brain/src/__tests__/migration-245.test.js` 存在
- [BEHAVIOR] `cd packages/brain && npm test -- migration-245` 全绿（tests/migration-245.test.js）
- [BEHAVIOR] migration 落地后 `psql cecelia -c "\d callback_queue" | grep retry_count` 命中（manual:node 校验）

## 风险

- Migration 编号 233 → 245：与 PRD 不一致，但 233 已占用，必须改号；记入 commit message 解释。
- 加列 + 索引在百万行表上有锁风险；callback_queue 量级小（短期任务回执），加 `IF NOT EXISTS` 幂等。
