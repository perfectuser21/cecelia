/** 发布线·晋级门（决策 de6dff5d 第 3 步）：请求参数校验在开事务前拒绝；真库行为见 release-line.pg.integration.test.js。 */
import { describe, it, expect, vi } from 'vitest';
import { promoteActivity, groupPromote } from '../release-line-gate.js';

const ID = 'c1000000-0000-4000-8000-000000000001';
const noDb = () => ({ query: vi.fn(), connect: vi.fn() });

describe('promoteActivity 参数校验', () => {
  it('缺 actor → 400 ACTOR_REQUIRED，不碰库', async () => {
    const db = noDb();
    await expect(promoteActivity(db, ID, { candidate_version_id: ID })).rejects.toMatchObject({ status: 400, code: 'ACTOR_REQUIRED' });
    expect(db.connect).not.toHaveBeenCalled();
  });
  it('min_runs > max_runs → 400；required_green 越界 → 400；tolerance 越界 → 400', async () => {
    await expect(promoteActivity(noDb(), ID, { actor: 't', min_runs: 9, max_runs: 3 })).rejects.toMatchObject({ status: 400 });
    await expect(promoteActivity(noDb(), ID, { actor: 't', required_green: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(promoteActivity(noDb(), ID, { actor: 't', required_green: 51 })).rejects.toMatchObject({ status: 400 });
    await expect(promoteActivity(noDb(), ID, { actor: 't', tolerance: 2 })).rejects.toMatchObject({ status: 400 });
  });
  it('force 不带 reason → 400 REASON_REQUIRED', async () => {
    await expect(promoteActivity(noDb(), ID, { actor: 't', force: true })).rejects.toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
  });
});

describe('groupPromote 参数校验', () => {
  it('members 为空 / 超过 50 / activity_id 重复或非 uuid → 400', async () => {
    await expect(groupPromote(noDb(), { actor: 't', members: [] })).rejects.toMatchObject({ status: 400 });
    await expect(groupPromote(noDb(), { actor: 't', members: Array.from({ length: 51 }, () => ({ activity_id: ID })) })).rejects.toMatchObject({ status: 400 });
    await expect(groupPromote(noDb(), { actor: 't', members: [{ activity_id: ID }, { activity_id: ID }] })).rejects.toMatchObject({ status: 400 });
    await expect(groupPromote(noDb(), { actor: 't', members: [{ activity_id: 'x' }] })).rejects.toMatchObject({ status: 400 });
  });
});
