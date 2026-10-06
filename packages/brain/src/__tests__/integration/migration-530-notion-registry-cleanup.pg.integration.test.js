/** 迁移 530 的行为：在已迁移到最新的 CI 测试库里核对注册表状态；只读查询。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { findUnregisteredNotionTables } from '../../lib/notion-projection-registry.js';

let pool;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
});
afterAll(async () => { await pool?.end(); });

const rows = async (sql, params) => (await pool.query(sql, params)).rows;

describe('迁移 530：Notion 注册表清理', () => {
  it('四张表上已停用的旧库登记已清掉，且这四张表仍有现行登记', async () => {
    const archived = await rows("SELECT brain_table FROM notion_projection_map WHERE status='archived' AND brain_table IN ('activities','activity_cells','okr_projects','tasks')");
    expect(archived).toEqual([]);
    for (const table of ['activities', 'activity_cells', 'okr_projects', 'tasks']) {
      const live = await rows("SELECT 1 FROM notion_projection_map WHERE brain_table=$1 AND status<>'archived'", [table]);
      expect(live.length, table).toBeGreaterThan(0);
    }
  });

  it('旧树 Feature 镜像已停推但仍登记（journey_features 带 notion_id 列）', async () => {
    const r = await rows("SELECT status, direction FROM notion_projection_map WHERE brain_table='journey_features'");
    expect(r).toEqual([{ status: 'archived', direction: 'none' }]);
  });

  it('备份表留存被删与被改的登记行', async () => {
    const n = (await rows('SELECT count(*)::int AS n FROM migration_530_notion_map_backup'))[0].n;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('registry_coverage：带 notion_id 列的表没有未登记的', async () => {
    expect(await findUnregisteredNotionTables(pool)).toEqual([]);
  });
});
