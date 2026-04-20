/**
 * Consciousness Toggle 真 PG Integration Test
 *
 * 补单元测试 mock pool 盲区：上次 CI 挂在 working_memory.value vs value_json 列名，
 * 单元测试 mock pool 通过了但真 PG schema 不通。本 test 在 CI brain-integration
 * 的 postgres service container 里跑真 SQL，覆盖：
 *   1. migration 240 的 schema（value_json 列）
 *   2. initConsciousnessGuard 从 DB 加载
 *   3. setConsciousnessEnabled 双写 cache + DB
 *   4. toggle 来回切换的一致性
 *   5. env override escape hatch
 *
 * 运行环境：CI brain-integration job（真实 PostgreSQL 服务）
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    // 确保 migration 240 已应用（幂等 INSERT ON CONFLICT DO NOTHING）
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM working_memory WHERE key = $1', [MEMORY_KEY]);
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
    _resetCacheForTest();
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  afterEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  test('migration 240 writes the correct schema (value_json column)', async () => {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
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

  test('initConsciousnessGuard really reads DB (not fallback-to-true)', async () => {
    // 先直接写 enabled=false 进 DB，绕过 setConsciousnessEnabled 的 cache 双写
    await pool.query(
      `UPDATE working_memory SET value_json = $1::jsonb, updated_at = NOW() WHERE key = $2`,
      [JSON.stringify({ enabled: false, last_toggled_at: '2026-01-01T00:00:00Z' }), MEMORY_KEY]
    );
    _resetCacheForTest();

    // 现在 init 必须真的从 DB 读到 false；若 SELECT 列名写错走 catch 分支，会 fallback 到 true，此 test 就爆
    await initConsciousnessGuard(pool);
    expect(isConsciousnessEnabled()).toBe(false);
  });

  test('setConsciousnessEnabled(false) write-through to both cache and DB', async () => {
    await initConsciousnessGuard(pool);
    const status = await setConsciousnessEnabled(pool, false);

    expect(status.enabled).toBe(false);
    expect(status.last_toggled_at).toBeTruthy();
    expect(isConsciousnessEnabled()).toBe(false);

    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
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
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    expect(result.rows[0].value_json.enabled).toBe(true);
  });

  test('env override beats memory (escape hatch)', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, true);

    process.env.CONSCIOUSNESS_ENABLED = 'false';
    expect(isConsciousnessEnabled()).toBe(false);

    delete process.env.CONSCIOUSNESS_ENABLED;
    await setConsciousnessEnabled(pool, false);
    expect(isConsciousnessEnabled()).toBe(false);

    process.env.CONSCIOUSNESS_ENABLED = 'true';
    expect(isConsciousnessEnabled()).toBe(true);
  });
});
