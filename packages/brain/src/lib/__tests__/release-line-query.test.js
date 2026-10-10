/** 发布线·只读查询（决策 de6dff5d 第 3 步）：缺对象返回 null、参数透传。真库行为见 release-line.pg.integration.test.js。 */
import { describe, it, expect, vi } from 'vitest';
import { getActivityRelease, getProductionRecipe, listReleaseEvents, listProductionRecipes } from '../release-line-query.js';

describe('release-line-query', () => {
  it('Activity 不存在 → null；没有配方 → null', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await getActivityRelease(db, 'a')).toBeNull();
    expect(await getProductionRecipe(db, 'w')).toBeNull();
  });
  it('事件 / 配方历史按 limit 查询、新→旧', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: 2 }, { id: 1 }] })) };
    expect(await listReleaseEvents(db, 'a', { limit: 5 })).toEqual([{ id: 2 }, { id: 1 }]);
    expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY id DESC LIMIT \$2/);
    expect(db.query.mock.calls[0][1]).toEqual(['a', 5]);
    await listProductionRecipes(db, 'w');
    expect(db.query.mock.calls[1][1]).toEqual(['w', 20]);
  });
  it('配方每格补生产版号与最新构建；?commit= 时带该 commit 的构建', async () => {
    const db = { query: vi.fn(async (sql) => (/FROM workflow_production_recipes/.test(sql)
      ? { rows: [{ id: 1, recipe: [{ slot_key: 's', activity_version_id: 'v1' }, { slot_key: 't', activity_version_id: null }] }] }
      : { rows: [{ version_no: 3, latest_build: { id: 'b' }, commit_build_id: 'bc' }] })) };
    const out = await getProductionRecipe(db, 'w', { commit: 'a'.repeat(40) });
    expect(out.recipe).toEqual([
      { slot_key: 's', activity_version_id: 'v1', version_no: 3, latest_build: { id: 'b' }, commit_build_id: 'bc' },
      { slot_key: 't', activity_version_id: null, version_no: null, latest_build: null, commit_build_id: null },
    ]);
  });
});
