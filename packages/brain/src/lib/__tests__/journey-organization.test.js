import { expect, it, vi } from 'vitest';
import { readJourneyOrganization } from '../journey-organization.js';

it('未知对象与已登记但未归属的对象保持可区分；对象身份始终参数化', async () => {
  const unknown = { journey_id: 'id', source: 'unknown', effective_area: null, gaps: ['area_unknown'] };
  const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ organization: unknown }] });
  const id = "x' OR true --";
  expect(await readJourneyOrganization({ query }, id)).toBeUndefined();
  expect(await readJourneyOrganization({ query }, 'id')).toEqual(unknown);
  expect(query.mock.calls[0][0]).not.toContain(id); expect(query.mock.calls[0][1]).toEqual([id]);
  expect(query.mock.calls[1][1]).toEqual(['id']);
});
it('读取失败不能伪装成没有组织归属', async () => {
  await expect(readJourneyOrganization({ query: vi.fn().mockRejectedValue(new Error('断线')) }, 'id')).rejects.toThrow('断线');
});
