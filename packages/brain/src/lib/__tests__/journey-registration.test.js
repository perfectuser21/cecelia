import { expect, it, vi } from 'vitest';
import { registerJourney } from '../journey-registration.js';

it.each([
  null, [], { name: '', journey_type: 'user_facing' },
  { name: '能力', journey_type: 'invalid' },
  { name: '能力', journey_type: 'user_facing', parent_journey_id: 'bad' },
  { name: '能力', journey_type: 'user_facing', area_id: {} },
  { name: '能力', journey_type: 'user_facing', steps: ['合法', null] },
])('非法登记请求在申请数据库连接前拒绝：%j', async body => {
  const pool = { connect: vi.fn() };
  await expect(registerJourney(pool, body)).rejects.toMatchObject({ status: 400 });
  expect(pool.connect).not.toHaveBeenCalled();
});
it('失败后回滚并释放连接，不吞数据库错误', async () => {
  const error = Object.assign(new Error('数据库不可用'), { code: '08006' });
  const query = vi.fn().mockResolvedValue({ rows: [] });
  query.mockImplementation(async sql => { if (sql.startsWith('LOCK')) throw error; return { rows: [] }; });
  const release = vi.fn();
  await expect(registerJourney({ connect: async () => ({ query, release }) }, { name: '能力', journey_type: 'user_facing' })).rejects.toBe(error);
  expect(query).toHaveBeenCalledWith('ROLLBACK'); expect(release).toHaveBeenCalledOnce();
  expect(error.status).toBe(500);
});
