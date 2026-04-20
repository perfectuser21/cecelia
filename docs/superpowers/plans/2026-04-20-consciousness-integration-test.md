# Consciousness Toggle Integration Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Single task.

**Goal:** 新建一个 integration test file 覆盖 consciousness toggle 的真 PG 链路，防 `value_json` 类列名 bug 回归。

**Architecture:** 复用 `packages/brain/src/__tests__/integration/*.integration.test.js` 的 pattern（真 pg.Pool + beforeAll/beforeEach/afterAll），CI 的 `brain-integration` job 自动扫 `integration/` 目录。

**Tech Stack:** Vitest / pg / Node ESM

**Spec:** `docs/superpowers/specs/2026-04-20-consciousness-integration-test-design.md`

---

## File Structure

**新建**：
- `packages/brain/src/__tests__/integration/consciousness-toggle.integration.test.js`（唯一新文件）

**修改**：无（CI、vitest config、源码都不动）

---

## Task 1: 写 integration test + 本地跑通 + 手工防回归验证

**Files:**
- Create: `packages/brain/src/__tests__/integration/consciousness-toggle.integration.test.js`

- [ ] **Step 1: 先 Read 一个现有 integration test 确认 DB_DEFAULTS pattern**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-integration-test
head -40 packages/brain/src/__tests__/integration/golden-path.integration.test.js
grep -rn "DB_DEFAULTS" packages/brain/src/ 2>&1 | head -5
```

重点记录：
- `DB_DEFAULTS` 来自哪个文件（可能是 `../../db-config.js` 或 `../db-config.js`）
- `beforeAll` / `beforeEach` / `afterAll` 的具体构造
- 如何跑 migration（可能直接读 SQL 文件 + pool.query，或调 `migrate.js` 的 export）

- [ ] **Step 2: 写完整 integration test 文件**

Create `packages/brain/src/__tests__/integration/consciousness-toggle.integration.test.js`。基于 Step 1 观察到的 pattern 调整 import 路径，下面是参考模板（import 路径按真实 pattern 改）：

```js
import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 复用 db-config 的连接参数（按 golden-path 实际 import 路径调整）
import { DB_DEFAULTS } from '../../db-config.js';

import {
  initConsciousnessGuard,
  setConsciousnessEnabled,
  isConsciousnessEnabled,
  _resetCacheForTest,
} from '../../consciousness-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_240 = path.resolve(__dirname, '../../../migrations/240_consciousness_setting.sql');
const MEMORY_KEY = 'consciousness_enabled';

describe('consciousness-toggle integration (real PG)', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
    // 确保 migration 240 已应用（幂等）
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // 清 memory key + 重跑 migration 恢复 seed
    await pool.query(`DELETE FROM working_memory WHERE key = $1`, [MEMORY_KEY]);
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
    _resetCacheForTest();
  });

  afterEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  test('migration 240 writes the correct schema (value_json column)', async () => {
    const result = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`,
      [MEMORY_KEY]
    );
    expect(result.rows.length).toBe(1);
    const val = result.rows[0].value_json;
    expect(val).toBeTruthy();
    expect(val.enabled).toBe(true);
    expect(val.last_toggled_at).toBeNull();
  });

  test('initConsciousnessGuard loads enabled=true from DB', async () => {
    await initConsciousnessGuard(pool);
    expect(isConsciousnessEnabled()).toBe(true);
  });

  test('setConsciousnessEnabled(false) write-through to both cache and DB', async () => {
    await initConsciousnessGuard(pool);
    const status = await setConsciousnessEnabled(pool, false);

    expect(status.enabled).toBe(false);
    expect(status.last_toggled_at).toBeTruthy();
    expect(isConsciousnessEnabled()).toBe(false);

    // 验证 DB 也落盘
    const result = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`,
      [MEMORY_KEY]
    );
    expect(result.rows[0].value_json.enabled).toBe(false);
    expect(result.rows[0].value_json.last_toggled_at).toBeTruthy();
  });

  test('toggle round-trip: true → false → true, cache & DB stay consistent', async () => {
    await initConsciousnessGuard(pool);
    expect(isConsciousnessEnabled()).toBe(true);

    await setConsciousnessEnabled(pool, false);
    expect(isConsciousnessEnabled()).toBe(false);

    await setConsciousnessEnabled(pool, true);
    expect(isConsciousnessEnabled()).toBe(true);

    const result = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`,
      [MEMORY_KEY]
    );
    expect(result.rows[0].value_json.enabled).toBe(true);
  });

  test('env override beats memory (escape hatch)', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, true);

    // memory = true, env = 'false' → 应返 false
    process.env.CONSCIOUSNESS_ENABLED = 'false';
    expect(isConsciousnessEnabled()).toBe(false);

    // 反向：memory = false, env = 'true' → 应返 true
    delete process.env.CONSCIOUSNESS_ENABLED;
    await setConsciousnessEnabled(pool, false);
    expect(isConsciousnessEnabled()).toBe(false);

    process.env.CONSCIOUSNESS_ENABLED = 'true';
    expect(isConsciousnessEnabled()).toBe(true);
  });
});
```

**关键**：Step 1 观察到 `DB_DEFAULTS` 的真实 import 路径后，必须调整顶部 import（可能是 `../../../db-config.js` 或类似）。

- [ ] **Step 3: 本地跑测试（连 localhost cecelia DB）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-integration-test/packages/brain
# 如果本地 PG 已有 cecelia DB，直接跑
npx vitest run src/__tests__/integration/consciousness-toggle.integration.test.js 2>&1 | tail -15
```
Expected: `5 tests passed`

如果连 DB 失败（无本地 cecelia DB），跳过本地验证，相信 CI。报告 BLOCKED_DB 并继续 commit + push（CI 会真跑）。

- [ ] **Step 4: 防回归验证（手工，可选但强推荐）**

```bash
# 临时把 consciousness-guard.js 里某一处 value_json 改成 value
sed -i '' 's/value_json FROM working_memory WHERE/value FROM working_memory WHERE/' packages/brain/src/consciousness-guard.js
npx vitest run src/__tests__/integration/consciousness-toggle.integration.test.js 2>&1 | tail -5
# Expected: tests 失败（报 column "value" does not exist）
# 恢复
git checkout packages/brain/src/consciousness-guard.js
npx vitest run src/__tests__/integration/consciousness-toggle.integration.test.js 2>&1 | tail -5
# Expected: 5 tests passed
```

如果 Step 4 验证失败（test 没爆红），说明 test 粒度太粗，需加更强的 schema 断言。

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-integration-test
git add packages/brain/src/__tests__/integration/consciousness-toggle.integration.test.js
git commit -m "$(cat <<'EOF'
test(brain): add consciousness toggle integration test (real PG)

- 5 tests: migration schema / init load / write-through / toggle round-trip / env override
- 用真 PG（CI brain-integration 的 postgres service container）
- 补单元测试 mock pool 的盲区（上次 CI 挂在 value vs value_json 列名）
- 防同类回归：临时把 value_json 改 value 时 test 会爆红

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- [x] Spec §Test clinical 5 个覆盖：migration schema ✓ / init load ✓ / write-through ✓ / toggle ✓ / env override ✓
- [x] DoD 1（≥3 tests）→ 5 tests ✓
- [x] DoD 2（本地 npx vitest 通过）→ Step 3 ✓
- [x] DoD 3（CI 自动扫）→ Spec 已验证 integration/ 目录自动扫 ✓
- [x] DoD 4（防回归验证）→ Step 4 ✓
- [x] DoD 5（不 bump 版本）→ 不改 package.json ✓
- [x] DoD 6（<300 行）→ 新文件约 120 行 + plan 文档 200 行，总 PR <350 行 ✓
- [x] 无 placeholder / 完整测试代码 / import 路径 Step 1 确认后修正

---

Plan 完成，进 subagent-driven-development。
