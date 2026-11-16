// 读取真实skill分发漂移状态；检测job本体见skill-dist-drift.test.js。
import { describe, it, expect, vi } from 'vitest';
import {
  SKILL_DIST_KEY,
  readSkillDistState,
} from '../skill-dist-report.js';

const H = (c) => String(c).repeat(64).slice(0, 64);

function fakePool(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    query: vi.fn(async (sql, params = []) => (
      store.has(params[0]) ? { rows: [{ value_json: store.get(params[0]) }] } : { rows: [] }
    )),
  };
}

describe('skill分发状态读取与坏数据隔离', () => {
  const okState = (over = {}) => ({
    checked_at: new Date().toISOString(),
    truth: { status: 'ok', count: 3, tree_hash: H('a'), broken: [] },
    machines: [{ id: 'xian-m4', dirs: [{ label: 'claude', status: 'ok' }] }],
    summary: { drifted: [], unverified: [], ok: ['xian-m4'] },
    ...over,
  });

  it('readSkillDistState：读 working_memory，缺失/查询失败/形状不符返回 null（best-effort）', async () => {
    const s = okState();
    expect(await readSkillDistState(fakePool({ [SKILL_DIST_KEY]: s }))).toMatchObject({ truth: { count: 3 } });
    expect(await readSkillDistState(fakePool())).toBeNull();
    expect(await readSkillDistState({ query: async () => { throw new Error('db down'); } })).toBeNull();
  });

  it('value_json 不是本 job 的结果（别的键/夹具）→ 当无数据，不出错误的 AMBER', async () => {
    expect(await readSkillDistState(fakePool({ [SKILL_DIST_KEY]: { leaderboard: [] } }))).toBeNull();
  });
});
