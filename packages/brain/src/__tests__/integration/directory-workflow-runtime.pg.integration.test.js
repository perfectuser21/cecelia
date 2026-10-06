/** 在真实迁移后的测试库上验证 loadDirectorySource 的运行情况 SQL（闹钟总账 + spans + 旧功能状态），只读。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { loadDirectorySource, buildDirectoryRows } from '../../projection/directory-source.js';

let pool;
beforeAll(() => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
});
afterAll(async () => { await pool?.end(); });

describe('流程运行情况（真库）', () => {
  it('每个流程都有一条运行情况，字段齐全且数字非负', async () => {
    const data = await loadDirectorySource(pool);
    const total = (await pool.query('SELECT count(*)::int AS n FROM workflows')).rows[0].n;
    expect(data.workflow_runtime).toHaveLength(total);
    for (const r of data.workflow_runtime) {
      for (const k of ['alarms', 'enabled', 'ran7', 'failed', 'silent', 'spans']) expect(Number(r[k]), k).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.items)).toBe(true);
      expect(r.items.length).toBeLessThanOrEqual(12);
      expect(Number(r.enabled)).toBeLessThanOrEqual(Number(r.alarms));
    }
  });

  it('映射成 Notion 行不抛错，且每个流程行都带 11 个运行情况列、不带「你的标记」', async () => {
    const rows = buildDirectoryRows(await loadDirectorySource(pool), {}).filter(r => r.layer === 'workflows');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      for (const k of ['Activity 数', '定时任务数', '启用任务数', '近7天有跑', '失败任务数', '静默任务数', '步骤级运行次数', '最近运行', '在用吗', '怎么运行', '旧功能状态']) {
        expect(r.properties, k).toHaveProperty(k);
      }
      expect(r.properties).not.toHaveProperty('你的标记');
      expect(['在跑', '有任务近7天没跑', '只登记没运行', '空壳']).toContain(r.properties['在用吗'].select.name);
    }
  });
});
