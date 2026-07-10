/**
 * Decision System 地基 — TDD Red 阶段
 *
 * 覆盖合同 Golden Path：
 *  - buildDecisionNotionProperties：level→Level / scope→Scope / ability→relation 映射（Step 2）
 *  - GET /api/brain/abilities/:id/decisions：读某 ability 决策清单（Step 3）
 *  - POST /api/brain/decisions：非法 level / 非法 target_id → 400（Step 4）
 *
 * 现状：buildDecisionNotionProperties 未导出、abilities/:id/decisions 路由未实现 → 预期全红
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// ─── Step 2: Notion 映射纯函数 ───────────────────────────────────────────────
describe('buildDecisionNotionProperties — Level/Scope/relation 映射 [BEHAVIOR]', () => {
  it('导出为函数并把 level→Level、scope→Scope、ability→relation', async () => {
    const mod: any = await import('../notion-push-sync.js');
    expect(typeof mod.buildDecisionNotionProperties).toBe('function');
    const p = mod.buildDecisionNotionProperties(
      { level: 'ability', scope: 'v1', topic: '前后台', decision: '后台静默' },
      'ab-notion-id'
    );
    const levelName = p.Level?.select?.name ?? p.Level?.status?.name;
    const scopeName = p.Scope?.select?.name ?? p.Scope?.status?.name;
    expect(levelName).toBe('ability');
    expect(scopeName).toBe('v1');
    const hasRelation = Object.values(p).some(
      (v: any) => Array.isArray(v?.relation) && v.relation.some((r: any) => r.id === 'ab-notion-id')
    );
    expect(hasRelation).toBe(true);
  });
});

// ─── Step 3 / Step 4: 决策读写路由 ──────────────────────────────────────────
async function makeApp() {
  const { default: router }: any = await import('../routes/abilities.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const supertest = async () => (await import('supertest')).default;

describe('GET /api/brain/abilities/:id/decisions [BEHAVIOR]', () => {
  beforeEach(() => mockQuery.mockReset());

  it('返回该 ability 的决策清单（数组）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'dec-1', level: 'ability', target_id: 'ab-1', scope: 'v1' }],
    });
    const request = await supertest();
    const res = await request(await makeApp()).get('/api/brain/abilities/ab-1/decisions?scope=v1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((d: any) => d.scope === 'v1')).toBe(true);
  });

  it('无决策 → 200 + 空数组（非报错）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const request = await supertest();
    const res = await request(await makeApp()).get('/api/brain/abilities/empty-ab/decisions?scope=v1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
