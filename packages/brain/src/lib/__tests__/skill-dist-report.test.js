/**
 * skill-dist-report：晨报一行 / 日报板块渲染 + 读取（链 bf5088a3 棒8，任务 1141f101）
 * 检测 job 本身见 src/__tests__/skill-dist-drift.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SKILL_DIST_KEY,
  readSkillDistState,
  renderSkillDistLine,
  renderSkillDistSection,
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

describe('渲染：晨报一行 / 日报板块', () => {
  const okState = (over = {}) => ({
    checked_at: new Date().toISOString(),
    truth: { status: 'ok', count: 3, tree_hash: H('a'), broken: [] },
    machines: [{ id: 'xian-m4', dirs: [{ label: 'claude', status: 'ok' }] }],
    summary: { drifted: [], unverified: [], ok: ['xian-m4'] },
    ...over,
  });

  it('无数据（job 从未跑）→ 不出行不出板块', () => {
    expect(renderSkillDistLine(null)).toBeNull();
    expect(renderSkillDistSection(null)).toBe('');
  });

  it('一致：日报出板块但不含 AMBER；晨报无行', () => {
    const s = okState();
    expect(renderSkillDistLine(s)).toBeNull();
    const sec = renderSkillDistSection(s);
    expect(sec).toContain('== skill 分发漂移 ==');
    expect(sec).not.toMatch(/AMBER/);
  });

  it('数据超过 6h 未刷新 → AMBER「检测已过期」（检测本身停了也要响）', () => {
    const s = okState({ checked_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString() });
    expect(renderSkillDistLine(s)).toMatch(/AMBER[^\n]*(过期|未更新)/);
  });

  it('日报板块逐机逐目录列出缺/多/异，点名 skill', () => {
    const s = okState({
      machines: [{ id: 'xian-m4', dirs: [{ label: 'claude', status: 'drift', missing: ['a'], missing_total: 1, extra: ['old'], extra_total: 1, changed: ['b'], changed_total: 1, broken: [], broken_total: 0 }] }],
      summary: { drifted: ['xian-m4'], unverified: [], ok: [] },
    });
    const sec = renderSkillDistSection(s);
    expect(sec).toMatch(/🟡 AMBER/);
    expect(sec).toContain('xian-m4');
    expect(sec).toMatch(/缺[^\n]*a/);
    expect(sec).toMatch(/多[^\n]*old/);
    expect(sec).toMatch(/异[^\n]*b/);
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
