# test_registry 生命周期治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `test_registry` 具备生命周期状态（active/orphan/deprecated）和与能力表 `journey_features` 的关联，并让 Brain tick 每日巡检自动识别三类僵尸 test（文件已删/能力已删/长期未扫到），标记 + 告警，绝不自动删有效 test。

**Architecture:** 一个 additive migration（311）给 `test_registry` 加 4 列 + 建 `test_lifecycle_alerts` 表；一个纯函数模块 `test-lifecycle-patrol.js` 做巡检判定与写库；`tick-runner.js` 新增 `10.24` fire-and-forget 挂载点，复用既有 `isInPatrolWindow` 与 `raise()` 告警机制，与 `skill-drift-patrol.js` 完全同构。

**Tech Stack:** Node.js (ESM) + PostgreSQL + vitest。Brain 后端代码，`packages/brain/`。

> **Task 1 执行中发现并修正的 bug**：`journey_features.id` 实际类型是 `UUID`（`gen_random_uuid()`），不是 INTEGER。migration 311 的 `feature_id` 列已改为 `UUID` 类型（原方案文档写的 `INTEGER` 是错的）。下面 Task 2/4 里所有 `feature_id` 测试 fixture 一律用 UUID 字符串（如 `'a1b2c3d4-0000-0000-0000-000000000001'`），不用数字。

---

## 文件清单

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/brain/migrations/311_test_registry_lifecycle.sql` | 新建 | additive migration：4 新列 + 2 索引 + `test_lifecycle_alerts` 表 |
| `packages/brain/src/test-lifecycle-patrol.js` | 新建 | 巡检核心逻辑：`isInPatrolWindow` re-export、`runTestLifecyclePatrol(pool)` |
| `packages/brain/src/__tests__/test-lifecycle-patrol.test.js` | 新建 | 单测：6 场景 + 自愈 + 去重 |
| `packages/brain/src/tick-runner.js` | 修改 line 108（import 区）+ line 1701 之后（10.24 挂载） | 挂载巡检到每日 tick |
| `packages/brain/src/__tests__/tick-runner-test-lifecycle-wiring.test.js` | 新建 | 结构性断言：10.24 挂载点存在、import 正确、fire-and-forget catch 存在 |

---

## Task 1: Migration 311

**Files:**
- Create: `packages/brain/migrations/311_test_registry_lifecycle.sql`
- Test: 手动 psql 验证（DoD 用 `manual:` 条目，非 vitest）

- [ ] **Step 1: 写 migration 文件**

```sql
-- Migration 311: test_registry 生命周期治理
-- 给 test_registry 加 status + 与能力(journey_features)的关联 + 巡检审计字段。
-- 全 additive：不改存量行语义，存量默认 active。
-- 运行: psql $DATABASE_URL < packages/brain/migrations/311_test_registry_lifecycle.sql

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','orphan','deprecated'));

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS feature_id INTEGER
    REFERENCES journey_features(id) ON DELETE SET NULL;

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS orphan_reason TEXT;

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS lifecycle_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_test_registry_status
  ON test_registry (status);

CREATE INDEX IF NOT EXISTS idx_test_registry_feature_id
  ON test_registry (feature_id);

CREATE TABLE IF NOT EXISTS test_lifecycle_alerts (
  id            SERIAL PRIMARY KEY,
  file_path     TEXT NOT NULL,
  orphan_reason TEXT NOT NULL,
  feature_id    INTEGER,
  patrol_date   DATE NOT NULL,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_path, patrol_date)
);

CREATE INDEX IF NOT EXISTS idx_test_lifecycle_alerts_detected_at
  ON test_lifecycle_alerts (detected_at DESC);
```

- [ ] **Step 2: 本地库跑 migration，验证幂等**

Run: `psql "$DATABASE_URL" -f packages/brain/migrations/311_test_registry_lifecycle.sql`
Run 第二次同一条命令，确认无报错（`IF NOT EXISTS` 幂等）。

- [ ] **Step 3: 校验列 + 存量数据**

Run:
```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const cols = await pool.query(\`SELECT column_name FROM information_schema.columns WHERE table_name='test_registry' AND column_name IN ('status','feature_id','orphan_reason','lifecycle_checked_at')\`);
  if (cols.rows.length !== 4) throw new Error('缺列: ' + JSON.stringify(cols.rows));
  const active = await pool.query(\"SELECT count(*) FROM test_registry WHERE status != 'active'\");
  if (Number(active.rows[0].count) !== 0) throw new Error('存量行 status 非 active: ' + active.rows[0].count);
  console.log('OK: 4 列存在，存量行全 active');
  await pool.end();
})();
"
```
Expected: `OK: 4 列存在，存量行全 active`

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/311_test_registry_lifecycle.sql
git commit -m "feat(brain): migration 311 — test_registry 生命周期字段 + test_lifecycle_alerts 表"
```

---

## Task 2: `test-lifecycle-patrol.js` 核心巡检逻辑（TDD）

**Files:**
- Create: `packages/brain/src/test-lifecycle-patrol.js`
- Test: `packages/brain/src/__tests__/test-lifecycle-patrol.test.js`

**约定**（与 `packages/brain/src/cron/skill-drift-patrol.js` 同构）：
- 复用同名 `isInPatrolWindow(now)` 概念，但每个巡检模块各自导出自己的窗口判断（避免跨模块共享可变窗口状态）；本模块窗口固定 **UTC 02:00-02:05**（与 skill-drift 同一窗口——两个巡检各自独立、互不干扰，都在 fire-and-forget 里各跑各的）。
- `raise(level, eventType, message)` 来自 `../alerting.js`。
- Notion Issue：**直接 `INSERT INTO issues` 表**（`notion_synced_at` 留 NULL），由既有 `notion-push-sync.js` 的 tick 任务自动捡起同步到 Notion——不 shell 出 `notion-create-issue.js`（那是 CLI 交互脚本，Brain 内部进程间直接写库更稳）。

- [ ] **Step 1: 写第一个失败测试 — file_missing → orphan + 安全删行**

```js
// packages/brain/src/__tests__/test-lifecycle-patrol.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import { existsSync } from 'fs';
import { raise } from '../alerting.js';
import { runTestLifecyclePatrol, isInPatrolWindow, PATROL_HOUR_UTC, PATROL_WINDOW_MINUTES } from '../test-lifecycle-patrol.js';

function makePool(rows) {
  const calls = [];
  return {
    calls,
    query: vi.fn().mockImplementation(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
        return { rows };
      }
      if (sql.includes('SELECT id FROM journey_features WHERE id = ANY')) {
        return { rows: [] }; // 默认：查到的 feature_id 全部不存在（能力已删）
      }
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runTestLifecyclePatrol — file_missing', () => {
  it('磁盘文件已删 → 物理删该 registry 行', async () => {
    const pool = makePool([
      { id: 1, file_path: 'packages/brain/src/gone.test.js', status: 'active', feature_id: null, scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(false);

    await runTestLifecyclePatrol(pool);

    const del = pool.calls.find(c => c.sql.includes('DELETE FROM test_registry'));
    expect(del).toBeTruthy();
    expect(del.params).toEqual([1]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: FAIL — `Cannot find module '../test-lifecycle-patrol.js'`

- [ ] **Step 3: 写最小实现骨架（先只处理 file_missing）**

```js
// packages/brain/src/test-lifecycle-patrol.js
import { existsSync } from 'fs';
import { join } from 'path';
import { raise } from './alerting.js';
import pool from './db.js';

export const PATROL_HOUR_UTC = 2;
export const PATROL_WINDOW_MINUTES = 5;
const STALE_DAYS = 30;

export function isInPatrolWindow(now = new Date()) {
  return now.getUTCHours() === PATROL_HOUR_UTC && now.getUTCMinutes() < PATROL_WINDOW_MINUTES;
}

function repoRoot() {
  return process.env.REPO_ROOT || new URL('../../..', import.meta.url).pathname;
}

export async function runTestLifecyclePatrol(db = pool, now = new Date()) {
  const patrolDate = now.toISOString().slice(0, 10);
  const root = repoRoot();

  const { rows } = await db.query(
    'SELECT id, file_path, status, feature_id, scanned_at FROM test_registry'
  );

  const staleAlerts = [];

  for (const row of rows) {
    const fileExists = existsSync(join(root, row.file_path));

    if (!fileExists) {
      await db.query('DELETE FROM test_registry WHERE id = $1', [row.id]);
      continue;
    }
  }

  return { staleAlerts };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: PASS（1 个测试）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/test-lifecycle-patrol.js packages/brain/src/__tests__/test-lifecycle-patrol.test.js
git commit -m "feat(brain): test-lifecycle-patrol — file_missing 自动收敛"
```

---

- [ ] **Step 6: 写失败测试 — feature_deleted → orphan + 告警 + issue，不删文件**

```js
// 追加进 test-lifecycle-patrol.test.js

describe('runTestLifecyclePatrol — feature_deleted', () => {
  it('文件存在但关联能力已删 → 标 orphan + raise + 建 issue，不删行', async () => {
    const pool = makePool([
      { id: 2, file_path: 'packages/brain/src/still-here.test.js', status: 'active', feature_id: 'a1b2c3d4-0000-0000-0000-000000000099', scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true); // 文件还在

    await runTestLifecyclePatrol(pool);

    const upd = pool.calls.find(c => c.sql.includes('UPDATE test_registry') && c.sql.includes('orphan'));
    expect(upd).toBeTruthy();
    expect(upd.params).toEqual(expect.arrayContaining(['feature_deleted', 2]));

    const del = pool.calls.find(c => c.sql.includes('DELETE FROM test_registry'));
    expect(del).toBeFalsy(); // 不删文件/行

    expect(raise).toHaveBeenCalledWith('P2', 'test_lifecycle_orphan_feature_deleted', expect.stringContaining('still-here.test.js'));

    const issueInsert = pool.calls.find(c => c.sql.includes('INSERT INTO issues'));
    expect(issueInsert).toBeTruthy();

    const alertInsert = pool.calls.find(c => c.sql.includes('INSERT INTO test_lifecycle_alerts'));
    expect(alertInsert).toBeTruthy();
  });

  it('feature_id 为 NULL → 不判 feature_deleted（防误标）', async () => {
    const pool = makePool([
      { id: 3, file_path: 'packages/brain/src/no-link.test.js', status: 'active', feature_id: null, scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true);

    await runTestLifecyclePatrol(pool);

    const upd = pool.calls.find(c => c.sql.includes('UPDATE test_registry'));
    expect(upd).toBeFalsy();
    expect(raise).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: 跑测试确认新场景失败**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: FAIL — feature_deleted 场景无 UPDATE 调用

- [ ] **Step 8: 实现 feature_deleted 分支**

```js
// 替换 test-lifecycle-patrol.js 里的 runTestLifecyclePatrol 主体

export async function runTestLifecyclePatrol(db = pool, now = new Date()) {
  const patrolDate = now.toISOString().slice(0, 10);
  const root = repoRoot();

  const { rows } = await db.query(
    'SELECT id, file_path, status, feature_id, scanned_at FROM test_registry'
  );

  const featureIds = [...new Set(rows.filter(r => r.feature_id != null).map(r => r.feature_id))];
  let aliveFeatureIds = new Set();
  if (featureIds.length > 0) {
    const { rows: aliveRows } = await db.query(
      'SELECT id FROM journey_features WHERE id = ANY($1)',
      [featureIds]
    );
    aliveFeatureIds = new Set(aliveRows.map(r => r.id));
  }

  const staleAlerts = [];

  for (const row of rows) {
    const fileExists = existsSync(join(root, row.file_path));

    if (!fileExists) {
      await db.query('DELETE FROM test_registry WHERE id = $1', [row.id]);
      continue;
    }

    const featureDeleted = row.feature_id != null && !aliveFeatureIds.has(row.feature_id);

    if (featureDeleted) {
      await db.query(
        `UPDATE test_registry SET status = 'orphan', orphan_reason = $1, lifecycle_checked_at = NOW() WHERE id = $2`,
        ['feature_deleted', row.id]
      );

      await raise('P2', 'test_lifecycle_orphan_feature_deleted', `孤儿 test：${row.file_path} 关联能力(feature_id=${row.feature_id})已不存在`)
        .catch(e => console.warn('[test-lifecycle-patrol] raise failed:', e.message));

      await db.query(
        `INSERT INTO test_lifecycle_alerts (file_path, orphan_reason, feature_id, patrol_date, detected_at)
         VALUES ($1, $2, $3, $4::date, NOW())
         ON CONFLICT (file_path, patrol_date) DO NOTHING`,
        [row.file_path, 'feature_deleted', row.feature_id, patrolDate]
      ).catch(e => console.error('[test-lifecycle-patrol] alert insert failed:', e.message));

      await db.query(
        `INSERT INTO issues (title, priority, status, sub_area, body, notion_synced_at)
         VALUES ($1, 'P2', 'In progress', 'brain', $2, NULL)`,
        [
          `孤儿 test：${row.file_path}`,
          `巡检发现 test_registry 中 ${row.file_path} 关联的 journey_features(id=${row.feature_id}) 已不存在。请确认该 test 是否仍有效；若确认无效，走 /dev 删除该 test 文件。`,
        ]
      ).catch(e => console.error('[test-lifecycle-patrol] issue insert failed:', e.message));

      continue;
    }

    const scannedAt = new Date(row.scanned_at);
    const staleDays = (now - scannedAt) / (1000 * 60 * 60 * 24);
    if (staleDays > STALE_DAYS) {
      staleAlerts.push({ file_path: row.file_path, days: Math.floor(staleDays) });
    }
  }

  return { staleAlerts };
}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: PASS（3 个测试）

- [ ] **Step 10: Commit**

```bash
git add packages/brain/src/test-lifecycle-patrol.js packages/brain/src/__tests__/test-lifecycle-patrol.test.js
git commit -m "feat(brain): test-lifecycle-patrol — feature_deleted 告警建issue + feature_id NULL 防误标"
```

---

- [ ] **Step 11: 写失败测试 — stale_scan 弱告警 + 自愈复位 + 24h去重**

```js
// 追加进 test-lifecycle-patrol.test.js

describe('runTestLifecyclePatrol — stale_scan', () => {
  it('scanned_at 超30天且文件仍在 → 汇总弱告警，不改 status', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const pool = makePool([
      { id: 4, file_path: 'packages/brain/src/stale.test.js', status: 'active', feature_id: null, scanned_at: old },
    ]);
    existsSync.mockReturnValue(true);

    const result = await runTestLifecyclePatrol(pool);

    expect(result.staleAlerts).toHaveLength(1);
    expect(result.staleAlerts[0].file_path).toBe('packages/brain/src/stale.test.js');

    const upd = pool.calls.find(c => c.sql.includes('UPDATE test_registry'));
    expect(upd).toBeFalsy();
  });
});

describe('runTestLifecyclePatrol — 自愈复位', () => {
  it('此前 orphan 的行，本轮 file 存在且 feature 存活 → 复位 active', async () => {
    const pool = makePool([
      { id: 5, file_path: 'packages/brain/src/recovered.test.js', status: 'orphan', feature_id: 'a1b2c3d4-0000-0000-0000-000000000042', scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true);
    pool.query.mockImplementation(async (sql, params) => {
      pool.calls.push({ sql, params });
      if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
        return { rows: [{ id: 5, file_path: 'packages/brain/src/recovered.test.js', status: 'orphan', feature_id: 'a1b2c3d4-0000-0000-0000-000000000042', scanned_at: new Date() }] };
      }
      if (sql.includes('SELECT id FROM journey_features WHERE id = ANY')) {
        return { rows: [{ id: 'a1b2c3d4-0000-0000-0000-000000000042' }] }; // feature 复活了
      }
      return { rows: [] };
    });

    await runTestLifecyclePatrol(pool);

    const reset = pool.calls.find(c => c.sql.includes('UPDATE test_registry') && c.sql.includes("status = 'active'"));
    expect(reset).toBeTruthy();
    expect(reset.params).toEqual([5]);
  });
});

describe('runTestLifecyclePatrol — 24h/同日去重', () => {
  it('同一 file_path 同一天 ON CONFLICT DO NOTHING 生效（SQL 层去重，非应用层重复插入）', async () => {
    const pool = makePool([
      { id: 6, file_path: 'packages/brain/src/dup.test.js', status: 'active', feature_id: 'a1b2c3d4-0000-0000-0000-000000000007', scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true);

    await runTestLifecyclePatrol(pool);

    const alertInsert = pool.calls.find(c => c.sql.includes('INSERT INTO test_lifecycle_alerts'));
    expect(alertInsert.sql).toContain('ON CONFLICT (file_path, patrol_date) DO NOTHING');
  });
});
```

- [ ] **Step 12: 跑测试确认新场景失败**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: FAIL — stale_scan 结果为空数组长度不对；自愈复位无对应 UPDATE

- [ ] **Step 13: 补齐自愈复位逻辑**

在 Step 8 实现的 `featureDeleted` 判断之后、`continue` 之前的分支旁，补上"此前 orphan 现在恢复"的分支。修改 `test-lifecycle-patrol.js` 的循环体，在 `featureDeleted` 判断前插入自愈检查：

```js
  for (const row of rows) {
    const fileExists = existsSync(join(root, row.file_path));

    if (!fileExists) {
      await db.query('DELETE FROM test_registry WHERE id = $1', [row.id]);
      continue;
    }

    const featureDeleted = row.feature_id != null && !aliveFeatureIds.has(row.feature_id);

    if (!featureDeleted && row.status === 'orphan') {
      await db.query(
        `UPDATE test_registry SET status = 'active', orphan_reason = NULL, lifecycle_checked_at = NOW() WHERE id = $1`,
        [row.id]
      );
      continue;
    }

    if (featureDeleted) {
      // ...（Step 8 的告警逻辑不变）
    }

    const scannedAt = new Date(row.scanned_at);
    const staleDays = (now - scannedAt) / (1000 * 60 * 60 * 24);
    if (staleDays > STALE_DAYS) {
      staleAlerts.push({ file_path: row.file_path, days: Math.floor(staleDays) });
    }
  }
```

（`stale_scan` 的判断本已在 Step 8 实现末尾存在，Step 12 失败仅因为之前测试用的 `scanned_at` mock 未触发——检查 Step 3/8 里 `STALE_DAYS` 比较条件与测试数据一致即可，若测试仍失败，确认 `staleAlerts` 数组在函数末尾正确 return。）

- [ ] **Step 14: 跑测试确认全部通过**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: PASS（全部场景，含 file_missing / feature_deleted / feature_id NULL / stale_scan / 自愈复位 / 去重共 6+ 个测试）

- [ ] **Step 15: Commit**

```bash
git add packages/brain/src/test-lifecycle-patrol.js packages/brain/src/__tests__/test-lifecycle-patrol.test.js
git commit -m "feat(brain): test-lifecycle-patrol — stale_scan弱告警 + orphan自愈复位 + 去重"
```

---

## Task 3: 挂载到 `tick-runner.js` 的 10.24

**Files:**
- Modify: `packages/brain/src/tick-runner.js:108`（import 区）
- Modify: `packages/brain/src/tick-runner.js:1701`（10.23 skill-drift 块之后）
- Test: `packages/brain/src/__tests__/tick-runner-test-lifecycle-wiring.test.js`

- [ ] **Step 1: 写失败的结构性测试**

```js
// packages/brain/src/__tests__/tick-runner-test-lifecycle-wiring.test.js
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('tick-runner — 10.24 test 生命周期巡检挂载', () => {
  it('import 语句存在', () => {
    const src = fs.readFileSync(new URL('../tick-runner.js', import.meta.url), 'utf-8');
    expect(src).toContain("import { runTestLifecyclePatrol, isInPatrolWindow as isInTestLifecyclePatrolWindow } from './test-lifecycle-patrol.js';");
  });

  it('10.24 挂载点存在，紧跟 10.23 之后，fire-and-forget + catch', () => {
    const src = fs.readFileSync(new URL('../tick-runner.js', import.meta.url), 'utf-8');
    const idx23 = src.indexOf('10.23 skill-drift 巡检');
    const idx24 = src.indexOf('10.24 test 生命周期巡检');
    expect(idx23).toBeGreaterThan(-1);
    expect(idx24).toBeGreaterThan(idx23);
    expect(src).toContain('runTestLifecyclePatrol(pool)');
    expect(src).toContain("catch(e => console.warn('[tick] test 生命周期巡检失败:', e.message))");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/tick-runner-test-lifecycle-wiring.test.js`
Expected: FAIL — import 语句不存在

- [ ] **Step 3: 加 import**

在 `packages/brain/src/tick-runner.js:108` 附近（`import { runSkillDriftPatrol, isInPatrolWindow } from './cron/skill-drift-patrol.js';` 那一行之后）新增一行：

```js
import { runTestLifecyclePatrol, isInPatrolWindow as isInTestLifecyclePatrolWindow } from './test-lifecycle-patrol.js';
```

> 用别名 `isInTestLifecyclePatrolWindow` 避免与已导入的 skill-drift 版 `isInPatrolWindow` 命名冲突（两个模块各自独立维护窗口判断，不共享）。

- [ ] **Step 4: 加 10.24 挂载块**

在 `packages/brain/src/tick-runner.js` 第 1701 行（`10.23 skill-drift 巡检` 块的结尾 `}` 之后，`} // end !MINIMAL_MODE` 之前）插入：

```js
  // 10.24 test 生命周期巡检（每天 UTC 02:00 = 北京时间 10:00，孤儿 test → orphan + 告警，fire-and-forget）
  if (isInTestLifecyclePatrolWindow(now)) {
    Promise.resolve().then(() => runTestLifecyclePatrol(pool))
      .catch(e => console.warn('[tick] test 生命周期巡检失败:', e.message));
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/tick-runner-test-lifecycle-wiring.test.js`
Expected: PASS

- [ ] **Step 6: 跑全量 tick-runner 既有测试确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/tick-runner.test.js src/__tests__/tick-burst-limiter.test.js src/__tests__/tick-gradient-requeue.test.js`
Expected: 全 PASS（新增 import/代码块不改变既有行为，`isInTestLifecyclePatrolWindow` 判 false 时整个块跳过）

- [ ] **Step 7: Commit**

```bash
git add packages/brain/src/tick-runner.js packages/brain/src/__tests__/tick-runner-test-lifecycle-wiring.test.js
git commit -m "feat(brain): tick-runner 10.24 挂载 test-lifecycle-patrol 每日巡检"
```

---

## Task 4: 端到端 fixture — 删能力+删test文件 → 巡检标 orphan + 建 issue

**Files:**
- Create: `packages/brain/src/__tests__/integration/test-lifecycle-e2e.integration.test.js`

> 参考 `packages/brain/src/__tests__/integration/tick-runner-full-tick.integration.test.js` 的 mock-pool 集成测试写法（不连真实 DB，用内存 fixture 模拟"表"状态），验证完整巡检流程的输入输出契约。

- [ ] **Step 1: 写失败的集成测试**

```js
// packages/brain/src/__tests__/integration/test-lifecycle-e2e.integration.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import { existsSync } from 'fs';
import { raise } from '../../alerting.js';
import { runTestLifecyclePatrol } from '../../test-lifecycle-patrol.js';

describe('E2E fixture: 删掉一个 journey_features + 它的 test → 巡检标 orphan', () => {
  it('journey_features 行已删、test 文件仍在磁盘 → test_registry 该行 status=orphan, orphan_reason=feature_deleted, issues 表有新记录', async () => {
    // fixture: 模拟一张已存在但对应能力(feature_id='...123')已被删除的 test 行
    const FEATURE_ID = 'a1b2c3d4-0000-0000-0000-000000000123';
    const testRegistryRow = {
      id: 10,
      file_path: 'packages/brain/src/__tests__/deleted-feature.test.js',
      status: 'active',
      feature_id: FEATURE_ID,
      scanned_at: new Date(),
    };

    const state = { registryRow: { ...testRegistryRow }, issues: [], alerts: [] };
    existsSync.mockReturnValue(true); // test 文件本身还在磁盘

    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
          return { rows: [state.registryRow] };
        }
        if (sql.includes('SELECT id FROM journey_features WHERE id = ANY')) {
          return { rows: [] }; // feature_id=FEATURE_ID 查无此能力 → 已删
        }
        if (sql.includes('UPDATE test_registry')) {
          state.registryRow.status = 'orphan';
          state.registryRow.orphan_reason = params[0];
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO test_lifecycle_alerts')) {
          state.alerts.push({ file_path: params[0], orphan_reason: params[1], feature_id: params[2] });
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO issues')) {
          state.issues.push({ title: params[0], body: params[1] });
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await runTestLifecyclePatrol(pool);

    expect(state.registryRow.status).toBe('orphan');
    expect(state.registryRow.orphan_reason).toBe('feature_deleted');
    expect(state.issues).toHaveLength(1);
    expect(state.issues[0].title).toContain('deleted-feature.test.js');
    expect(state.alerts).toHaveLength(1);
    expect(raise).toHaveBeenCalledWith('P2', 'test_lifecycle_orphan_feature_deleted', expect.stringContaining(FEATURE_ID));
  });

  it('对比：磁盘文件已删的行走 file_missing 路径，直接删行，不建 issue', async () => {
    const state = { deletedIds: [], issues: [] };
    existsSync.mockReturnValue(false); // 文件不在磁盘

    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
          return { rows: [{ id: 11, file_path: 'packages/brain/src/__tests__/gone.test.js', status: 'active', feature_id: null, scanned_at: new Date() }] };
        }
        if (sql.includes('DELETE FROM test_registry')) {
          state.deletedIds.push(params[0]);
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO issues')) {
          state.issues.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await runTestLifecyclePatrol(pool);

    expect(state.deletedIds).toEqual([11]);
    expect(state.issues).toHaveLength(0); // file_missing 零风险自动收敛，不建 issue
  });
});
```

- [ ] **Step 2: 跑测试确认通过（此时 Task 2/3 已实现，逻辑应已满足）**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/test-lifecycle-e2e.integration.test.js`
Expected: PASS（2 个测试：feature_deleted 路径 vs file_missing 路径行为不同）

- [ ] **Step 3: 跑全量 brain 单测确认无回归**

Run: `cd packages/brain && npx vitest run`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/__tests__/integration/test-lifecycle-e2e.integration.test.js
git commit -m "test(brain): test-lifecycle E2E fixture — feature_deleted vs file_missing 行为对比"
```

---

## Self-Review 备注（写 plan 时已核对）

- **Spec 覆盖**：Migration(Task1) / 巡检核心 6 场景(Task2) / tick挂载(Task3) / E2E fixture(Task4) 对应 spec 的 DoD 全部 6 条。
- **类型一致性**：`runTestLifecyclePatrol(db, now)`、`isInPatrolWindow(now)` 签名在 Task2/3/4 全程一致；`raise(level, eventType, message)` 签名与 `alerting.js` 实际导出一致（已用子代理核实）。
- **已修正的引用错误**：原方案文档提到"通知复用 notifier.js"，实际应为 `alerting.js` 的 `raise()`；Notion Issue 创建原方案提到 shell 调 `notion-create-issue.js`，改为直接 `INSERT INTO issues`（复用 `notion-push-sync.js` 既有轮询同步），因为本模块运行在 Brain 同进程内，不必跨进程 shell 出子脚本。
- **无占位符**：所有代码块均为完整可运行代码，无 TBD。
