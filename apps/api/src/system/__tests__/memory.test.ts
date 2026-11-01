import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSystemApiFixture, type SystemApiFixture } from './helpers/system-api-fixture.js';

interface MemoryBody {
  success: boolean;
  stats: unknown;
  schema: unknown;
  count: number;
  entries: Array<{ key: string }> & {
    filter_test_1: { value: unknown };
    filter_test_3: { value: unknown };
  };
}
let api: SystemApiFixture<MemoryBody>;
beforeAll(async () => { api = await createSystemApiFixture<MemoryBody>(); });
afterAll(async () => { await api?.close(); });
beforeEach(async () => {
  await api.reset();
  for (const [layer, category, key, n] of [
    ['working', 'context', 'filter_test_1', 1],
    ['working', 'state', 'filter_test_2', 2],
    ['longterm', 'preference', 'filter_test_3', 3],
  ]) await api.pool.query('INSERT INTO memory_entries (layer,category,key,value) VALUES ($1,$2,$3,$4)', [layer, category, key, JSON.stringify({ n })]);
});

async function stored(key: string) {
  return (await api.pool.query('SELECT * FROM memory_entries WHERE key=$1', [key])).rows;
}

describe('Memory Schema API — 本人 scratch PG + 独立 HTTP', () => {
  it('stats 返回真实计数及三层 schema', async () => {
    const response = await api.request('/memory/stats');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.stats).toEqual({ total: 3, byLayer: { working: 2, longterm: 1 }, byCategory: { context: 1, state: 1, preference: 1 }, expired: 0 });
    expect(data.schema).toEqual({ layers: ['episodic', 'working', 'longterm'], categories: { episodic: ['event', 'decision'], working: ['context', 'state'], longterm: ['preference', 'lesson', 'pattern'] } });
  });

  it('写入 working context 并在真实数据库读回内容及来源', async () => {
    const response = await api.json('/memory', { layer: 'working', category: 'context', key: 'working-write', value: { active: true }, source: 'system' });
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toMatchObject({ success: true, entry: { layer: 'working', category: 'context', key: 'working-write', value: { active: true }, source: 'system' } });
    expect(await stored('working-write')).toMatchObject([{ layer: 'working', value: { active: true }, source: 'system' }]);
  });

  it('写入 longterm lesson 并持久化 inference confidence', async () => {
    const response = await api.json('/memory', { layer: 'longterm', category: 'lesson', key: 'longterm-write', value: { learned: '检查边界' }, source: 'inference', confidence: 0.85 });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, entry: { layer: 'longterm', confidence: 0.85 } });
    expect(await stored('longterm-write')).toMatchObject([{ category: 'lesson', value: { learned: '检查边界' }, source: 'inference', confidence: 0.85 }]);
  });

  it('拒绝 working 层的 preference 分类，且不产生数据库记录', async () => {
    const response = await api.json('/memory', { layer: 'working', category: 'preference', key: 'invalid-category', value: {} });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, errors: ['category "preference" not allowed in layer "working". Allowed: context, state'] });
    expect(await stored('invalid-category')).toEqual([]);
  });

  it('拒绝非法层，且不产生数据库记录', async () => {
    const response = await api.json('/memory', { layer: 'invalid_layer', category: 'context', key: 'invalid-layer', value: {} });
    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
    expect(await stored('invalid-layer')).toEqual([]);
  });

  it('按 layer 筛选必须返回两条 working 记录', async () => {
    const data = await (await api.request('/memory?layer=working')).json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);
    expect(data.entries.map((entry: { key: string }) => entry.key).sort()).toEqual(['filter_test_1', 'filter_test_2']);
  });

  it('按 category 筛选必须仅返回 context 记录', async () => {
    const data = await (await api.request('/memory?category=context')).json();
    expect(data.success).toBe(true);
    expect(data.entries).toMatchObject([{ key: 'filter_test_1', layer: 'working', category: 'context' }]);
    expect(data.count).toBe(1);
  });

  it('layer 与 category 组合筛选只返回 longterm preference', async () => {
    const data = await (await api.request('/memory?layer=longterm&category=preference')).json();
    expect(data.success).toBe(true);
    expect(data.entries).toMatchObject([{ key: 'filter_test_3', layer: 'longterm', category: 'preference' }]);
    expect(data.count).toBe(1);
  });

  it('按 key 读取实际写入的 JSON 值', async () => {
    expect((await api.json('/memory', { layer: 'working', category: 'context', key: 'read-test', value: { readable: true } })).status).toBe(201);
    const response = await api.request('/memory/read-test');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, entry: { key: 'read-test', value: { readable: true } } });
  });

  it('不存在的 key 返回 404', async () => {
    const response = await api.request('/memory/nonexistent');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it('batch 仅返回请求的两条记录及各自 JSON 值', async () => {
    const response = await api.json('/memory/batch', { keys: ['filter_test_1', 'filter_test_3', 'missing-key'] });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);
    expect(Object.keys(data.entries).sort()).toEqual(['filter_test_1', 'filter_test_3']);
    expect(data.entries.filter_test_1.value).toEqual({ n: 1 });
    expect(data.entries.filter_test_3.value).toEqual({ n: 3 });
  });

  it('DELETE 真正删除记录，随后 HTTP 与 SQL 均查不到', async () => {
    expect((await api.json('/memory', { layer: 'episodic', category: 'event', key: 'delete-test', value: { deletable: true } })).status).toBe(201);
    const response = await api.request('/memory/delete-test', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, deleted: 'delete-test' });
    expect((await api.request('/memory/delete-test')).status).toBe(404);
    expect(await stored('delete-test')).toEqual([]);
  });
});
