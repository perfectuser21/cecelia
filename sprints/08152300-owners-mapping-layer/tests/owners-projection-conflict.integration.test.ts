import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
// TDD Red（真 PG，CI brain-integration job 执行；禁 mock 被改的边）：
// 覆盖 owners-reader ↔ fact_snapshot_headers、projector ↔ map_projection_nodes/edges、
// map-read-service ↔ active projection 三条边——全部真 Postgres，不 stub。
// 目标模块尚未实现 → 本测试红。
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { projectOwnersForScope } from '../../../packages/brain/src/lib/owners-projection.js';
import { readHealth, readNode } from '../../../packages/brain/src/lib/map-read-service.js';

// 测试隔离：走 db-config DB_DEFAULTS，禁连生产库
let pool;

beforeAll(async () => {
  const { default: pg } = await import('pg');
  pool = new pg.Pool(DB_DEFAULTS);
});

afterAll(async () => {
  await pool?.end();
});

describe('OWNERS 投影冲突即报 [BEHAVIOR]', () => {
  it('双重声明路径进 owners.conflicts 且不投影到任一 capability（proven-to-fire 真 PG）', async () => {
    const client = await pool.connect();
    try {
      // 注入同一路径的两条冲突 OWNERS 声明（真库 fact_snapshot_headers kind=owners + owners 声明存储）
      await projectOwnersForScope(client, {
        scopeKey: 'cecelia',
        declarations: [
          { dir: 'packages/brain/src/map', capability: 'cecelia/MJ5' },
          { dir: 'packages/brain/src/map', capability: 'cecelia/F0' },
        ],
      });
      const health = await readHealth(client, { scopeKey: 'cecelia', now: new Date() });
      const conflict = health.owners.conflicts.find((c) => c.path === 'packages/brain/src/map');
      expect(conflict).toBeTruthy();
      expect(conflict.reason).toBe('multiple_declarations');
      expect(health.owners.status).toBe('degraded');

      // 冲突路径不投影：MJ5 与 F0 的 owned_artifacts 都不含该目录下事实
      const mj5 = await readNode(client, { scopeKey: 'cecelia', nodeKey: 'MJ5', now: new Date() });
      const leaked = (mj5.owned_artifacts || [])
        .some((a) => String(a.stable_ref).startsWith('packages/brain/src/map/'));
      expect(leaked).toBe(false);
    } finally {
      client.release();
    }
  });
});
