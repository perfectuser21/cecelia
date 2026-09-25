/**
 * skill_registry 任务→技能绑定 —— 真 PostgreSQL 验证（链 bf5088a3 棒7，任务 9917a588）。
 *
 * mock 测不到的事只能上真库：
 *   1. 迁移 470 真的加列，回填把 EXECUTOR_SKILL_MAP 全量灌进账本（账本 vs 硬编码零漂移）
 *   2. 回填幂等，且不覆盖已有行的其它列（description/status/location/metadata）
 *   3. 验收：只改账本一行（不改代码）→ 快照过期后新任务解析到新 skill
 *   4. 账本缺映射 → detectSkillBindingDrift 报 missing（晨报 AMBER 的数据源），解析走硬编码兜底
 *
 * 建库→跑全量 migrate.js→用完即删，照 task-governance-guards.pg.integration.test.js 的手法。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { EXECUTOR_SKILL_MAP } from '../../lib/task-type-registry.js';
import {
  ensureSkillBindingsFresh,
  resolveTaskTypeSkill,
  resolveSkillWithLedger,
  detectSkillBindingDrift,
  _resetSkillBindingCacheForTest,
  SKILL_BINDING_TTL_MS,
} from '../../lib/skill-binding-registry.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATION_470 = fileURLToPath(new URL('../../../migrations/470_skill_registry_task_bindings.sql', import.meta.url));

let adminPool;
let pool;
let databaseName;

function quoteIdentifier(value) {
  if (!/^skillbind_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

const resolveLikeExecutor = (taskType) => resolveTaskTypeSkill(taskType, EXECUTOR_SKILL_MAP) || '/dev';

beforeAll(async () => {
  databaseName = `skillbind_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

beforeEach(() => {
  _resetSkillBindingCacheForTest();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe.sequential('迁移 470：加列 + 回填', () => {
  it('skill_registry 有 task_types(text[]) 与 dispatch_command 两列', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'skill_registry' AND column_name IN ('task_types','dispatch_command')
        ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'dispatch_command', data_type: 'text' },
      { column_name: 'task_types', data_type: 'ARRAY' },
    ]);
  });

  it('回填后账本与硬编码零漂移：detect 三类全空，且每个非空硬编码项都能从账本解析', async () => {
    const drift = await detectSkillBindingDrift(pool, EXECUTOR_SKILL_MAP);
    expect(drift).toEqual({ missing: [], mismatched: [], conflicts: [] });
    await ensureSkillBindingsFresh(pool);
    for (const [taskType, cmd] of Object.entries(EXECUTOR_SKILL_MAP)) {
      if (!cmd) continue;
      expect(resolveLikeExecutor(taskType)).toBe(cmd);
    }
  });

  it('回填幂等 + 不覆盖已有行其它列：重放迁移后 description/status/location/metadata 不变', async () => {
    await pool.query(
      `UPDATE skill_registry SET description = '人工维护的描述', location = 'manual-loc',
              metadata = '{"eval_score": 0.9}'::jsonb WHERE name = 'dev'`,
    );
    const before = (await pool.query(`SELECT description, status, location, metadata, task_types FROM skill_registry WHERE name = 'dev'`)).rows[0];
    await pool.query(readFileSync(MIGRATION_470, 'utf8'));
    await pool.query(readFileSync(MIGRATION_470, 'utf8'));
    const after = (await pool.query(`SELECT description, status, location, metadata, task_types FROM skill_registry WHERE name = 'dev'`)).rows[0];
    expect(after.description).toBe('人工维护的描述');
    expect(after.location).toBe('manual-loc');
    expect(after.status).toBe(before.status);
    expect(after.metadata).toEqual({ eval_score: 0.9 });
    expect([...after.task_types].sort()).toEqual([...before.task_types].sort()); // 并集去重，重放不膨胀
  });
});

describe.sequential('验收：改账本映射无需改代码即生效', () => {
  it('把 review 从 code-review 改绑到 code-review-gate → 快照过期后新任务用新 skill', async () => {
    await pool.query(`INSERT INTO skill_registry (name, description, status) VALUES ('code-review-gate', 'g', 'active') ON CONFLICT (name) DO NOTHING`);
    let t = 1_000_000;
    const now = () => t;
    await ensureSkillBindingsFresh(pool, { now });
    expect(resolveLikeExecutor('review')).toBe('/code-review');

    await pool.query(`UPDATE skill_registry SET task_types = array_remove(task_types, 'review') WHERE name = 'code-review'`);
    await pool.query(`UPDATE skill_registry SET task_types = array_append(task_types, 'review') WHERE name = 'code-review-gate'`);

    // TTL 内仍是旧快照（缓存生效，不逐任务查库）
    await ensureSkillBindingsFresh(pool, { now });
    expect(resolveLikeExecutor('review')).toBe('/code-review');
    // 过期后读到新映射
    t += SKILL_BINDING_TTL_MS + 1;
    await ensureSkillBindingsFresh(pool, { now });
    expect(resolveLikeExecutor('review')).toBe('/code-review-gate');

    // skill_override 仍最优先
    const s = await resolveSkillWithLedger(pool, { task_type: 'review', payload: { skill_override: '/mine' } }, resolveLikeExecutor);
    expect(s).toBe('/mine');
  });

  it('账本缺映射 → detect 报 missing（晨报 AMBER），解析走硬编码兜底', async () => {
    await pool.query(`UPDATE skill_registry SET task_types = array_remove(task_types, 'ci_patrol') WHERE name = 'ci-patrol'`);
    const drift = await detectSkillBindingDrift(pool, EXECUTOR_SKILL_MAP);
    expect(drift.missing).toEqual([{ task_type: 'ci_patrol', hardcoded: '/ci-patrol' }]);
    _resetSkillBindingCacheForTest();
    await ensureSkillBindingsFresh(pool);
    expect(resolveLikeExecutor('ci_patrol')).toBe('/ci-patrol');
  });
});
