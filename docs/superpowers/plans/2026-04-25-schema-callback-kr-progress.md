# Schema 补全 callback_queue.retry_count + key_results.progress_pct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加 2 列让 Brain 启动 health-monitor + KR 报告不再 silently degrade。

**Architecture:** 新建 migration 245 加 `callback_queue.retry_count` 与 `key_results.progress_pct` + 部分索引；新增 vitest 验 schema；本地 apply migration。

**Tech Stack:** PostgreSQL + Node.js (pg) + vitest。

---

### Task 1: 新建 migration 245

**Files:**
- Create: `packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql`

- [ ] **Step 1: 写 migration**

```sql
-- Migration 245: 补 callback_queue.retry_count + key_results.progress_pct
-- 目的：修 health-monitor.js 与 kr-verifier.js 启动报错（silently degrade）。

ALTER TABLE callback_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_callback_queue_retry_count
  ON callback_queue(retry_count) WHERE retry_count > 0;

ALTER TABLE key_results ADD COLUMN IF NOT EXISTS progress_pct DECIMAL(5,2) DEFAULT 0.0;
```

- [ ] **Step 2: 本地 apply**

```bash
psql cecelia -f packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql
```

Expected: `ALTER TABLE` 两次 + `CREATE INDEX` 一次（首跑）或 NOTICE skip（重跑），exit 0。

- [ ] **Step 3: 验列存在**

```bash
psql cecelia -c "\d callback_queue" | grep retry_count
psql cecelia -c "\d key_results"   | grep progress_pct
```

Expected: 各命中一行。

---

### Task 2: 新建 vitest 验 schema

**Files:**
- Create: `packages/brain/src/__tests__/migration-245.test.js`

- [ ] **Step 1: 写测试（参考 migration-041.test.js 模板）**

```javascript
/**
 * Migration 245 Tests
 * Verifies callback_queue.retry_count + key_results.progress_pct columns exist.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
});

describe('migration 245: callback_queue.retry_count + key_results.progress_pct', () => {
  it('callback_queue.retry_count column exists with INTEGER type and default 0', async () => {
    const result = await pool.query(`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'callback_queue'
        AND column_name = 'retry_count'
    `);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('integer');
    expect(result.rows[0].column_default).toBe('0');
  });

  it('idx_callback_queue_retry_count partial index exists', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'callback_queue'
        AND indexname = 'idx_callback_queue_retry_count'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('key_results.progress_pct column exists with NUMERIC type and default 0.0', async () => {
    const result = await pool.query(`
      SELECT data_type, numeric_precision, numeric_scale, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'key_results'
        AND column_name = 'progress_pct'
    `);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('numeric');
    expect(result.rows[0].numeric_precision).toBe(5);
    expect(result.rows[0].numeric_scale).toBe(2);
    // column_default may be '0.0' or '0' depending on PG normalization
    expect(String(result.rows[0].column_default)).toMatch(/^0(\.0+)?$/);
  });

  it('health-monitor query against callback_queue.retry_count succeeds', async () => {
    // 模拟 health-monitor.js:124 的查询
    const result = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM callback_queue
      WHERE retry_count >= 3
        AND processed_at IS NULL
    `);
    expect(result.rows).toHaveLength(1);
    expect(typeof parseInt(result.rows[0].cnt, 10)).toBe('number');
  });

  it('kr-verifier query against key_results.progress_pct succeeds', async () => {
    // 模拟 kr-verifier.js:126 的查询
    const result = await pool.query(`
      SELECT id, title, progress_pct
      FROM key_results
      LIMIT 1
    `);
    expect(Array.isArray(result.rows)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd packages/brain && npx vitest run src/__tests__/migration-245.test.js
```

Expected: 5 passed。

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql \
        packages/brain/src/__tests__/migration-245.test.js
git commit -m "feat(brain): 补 schema callback_queue.retry_count + key_results.progress_pct"
```

---

### Task 3: 写 Learning + DoD 标记

**Files:**
- Create: `docs/learnings/cp-0425185115-schema-callback-kr-progress.md`

- [ ] **Step 1: 写 Learning**

```markdown
# cp-0425185115-schema-callback-kr-progress

## 现象
Brain 启动连续报：
- `[health-monitor] callback_queue_stats query failed: column 'retry_count' does not exist`
- `[tick] KR health check failed: column g.progress_pct does not exist`
两个 silently degrade，影响 Layer2Health 与 KR Verifier 健康面板。

## 根本原因
代码先于 schema 上线：
- `health-monitor.js:124` 用 `callback_queue.retry_count`，但表只有 `attempt`。
- `kr-verifier.js:126` 用 `key_results.progress_pct`，但表只有 `progress` (integer) 与 `current_value` (numeric)。
迁移文件被遗漏，整个查询块被 try/catch 吞掉报错（silently degrade）。

## 下次预防
- [ ] 新增列查询时，PR 必须同时含 ALTER TABLE migration 文件。
- [ ] 凡 try/catch 吞 schema 错的代码段，PR 模板需勾选"是否含对应 migration"。
- [ ] migration 编号冲突时（PRD 233 已被占）即时改号并在 commit message 注明。
```

- [ ] **Step 2: 勾选 DoD**

无 PRD/DoD 文件需更新（任务 PRD 在 Brain DB，PR description 中复述并自勾）。

- [ ] **Step 3: Commit Learning**

```bash
git add docs/learnings/cp-0425185115-schema-callback-kr-progress.md
git commit -m "docs(learning): cp-0425185115-schema-callback-kr-progress"
```

---

### Task 4: Push + 创建 PR

- [ ] **Step 1: Push**

```bash
git push -u origin cp-0425185115-schema-callback-kr-progress
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create --title "feat(brain): 补 schema callback_queue.retry_count + key_results.progress_pct" \
  --body "<内含 PRD 复述、DoD 自勾、Learning 引用、Brain task id>"
```

- [ ] **Step 3: Foreground 阻塞等 CI**

```bash
PR=$(gh pr view --json number -q .number)
until [[ $(gh pr checks "$PR" 2>/dev/null | grep -cE 'pending|queued') -eq 0 ]]; do
  sleep 30
done
gh pr checks "$PR"
```

Expected: 全部 pass。

---

## Self-Review

1. **Spec coverage**: spec 三条改动 → Task 1 (migration) + Task 2 (test) + Task 1 step 2 (本地 apply)。三条 DoD（migration 文件、vitest 全绿、列查询通）全覆盖。
2. **Placeholder scan**: 无 TBD/TODO；测试代码完整；命令完整。
3. **Type consistency**: `retry_count` INTEGER / `progress_pct` DECIMAL(5,2) 在 migration、测试、Learning 中一致。
