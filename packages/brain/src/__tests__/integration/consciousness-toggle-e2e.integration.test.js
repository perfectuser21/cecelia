/**
 * Consciousness Toggle HTTP E2E Integration Test
 *
 * 用 supertest + Express app 挂载真实 settings 路由 + 真 PG 做端到端链路：
 *   GET → PATCH → GET → 断言 DB 持久化 + guard cache write-through + toggle 对称。
 * 不装 Playwright（降级 E2E），supertest 足以覆盖 HTTP/DB/cache 三层。
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  initConsciousnessGuard,
  isConsciousnessEnabled,
  _resetCacheForTest,
} from '../../consciousness-guard.js';
import settingsRoutes from '../../routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_240 = path.resolve(__dirname, '../../../migrations/240_consciousness_setting.sql');
const MEMORY_KEY = 'consciousness_enabled';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/settings', settingsRoutes);
  return app;
}

describe('consciousness toggle HTTP E2E (supertest + real PG)', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
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
    await initConsciousnessGuard(pool);
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  afterEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  test('full HTTP chain: GET → PATCH → GET persists + cache + DB', async () => {
    const app = makeApp();

    const r1 = await request(app).get('/api/brain/settings/consciousness');
    expect(r1.status).toBe(200);
    expect(r1.body.enabled).toBe(true);
    expect(r1.body.env_override).toBe(false);

    const r2 = await request(app)
      .patch('/api/brain/settings/consciousness')
      .send({ enabled: false });
    expect(r2.status).toBe(200);
    expect(r2.body.enabled).toBe(false);
    expect(r2.body.last_toggled_at).toBeTruthy();
    const toggledAt = r2.body.last_toggled_at;

    const r3 = await request(app).get('/api/brain/settings/consciousness');
    expect(r3.body.enabled).toBe(false);
    expect(r3.body.last_toggled_at).toBe(toggledAt);

    const db = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    expect(db.rows[0].value_json.enabled).toBe(false);
    expect(db.rows[0].value_json.last_toggled_at).toBe(toggledAt);

    expect(isConsciousnessEnabled()).toBe(false);

    const r4 = await request(app)
      .patch('/api/brain/settings/consciousness')
      .send({ enabled: true });
    expect(r4.body.enabled).toBe(true);
    expect(isConsciousnessEnabled()).toBe(true);
  });
});
