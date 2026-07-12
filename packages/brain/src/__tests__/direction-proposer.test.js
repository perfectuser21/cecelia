// packages/brain/src/__tests__/direction-proposer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInDirectionProposerWindow,
  alreadyProposedThisWeek,
  collectKrGaps,
  collectExhaustedLines,
  getDirectCandidates,
  proposeCandidates,
  insertCandidates,
  writeGapPanorama,
  maybeRunDirectionProposer,
} from '../direction-proposer.js';

beforeEach(() => vi.clearAllMocks());

// 便捷：按 SQL 片段路由的 mock pool
function mockPool(routes) {
  return {
    query: vi.fn(async (sql, params) => {
      for (const [pattern, result] of routes) {
        if (sql.includes(pattern)) return typeof result === 'function' ? result(sql, params) : result;
      }
      return { rows: [] };
    }),
  };
}

describe('isInDirectionProposerWindow — UTC 周日 21:30-21:35 = 北京周一 05:30-05:35', () => {
  it('周日 UTC 21:29 → false', () => {
    // 2026-07-12 是周日
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 29)))).toBe(false);
  });
  it('周日 UTC 21:30 → true', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 30)))).toBe(true);
  });
  it('周日 UTC 21:34 → true', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 34)))).toBe(true);
  });
  it('周日 UTC 21:35 → false', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 35)))).toBe(false);
  });
  it('周一 UTC 21:30（北京周二）→ false', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 13, 21, 30)))).toBe(false);
  });
});

describe('alreadyProposedThisWeek — working_memory gp_gap_panorama 20h 内已更新 → true', () => {
  it('有记录 → true，SQL 含 gp_gap_panorama/20 hours', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    await expect(alreadyProposedThisWeek(pool)).resolves.toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/gp_gap_panorama/);
    expect(sql).toMatch(/20 hours/);
  });
  it('无记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(alreadyProposedThisWeek(pool)).resolves.toBe(false);
  });
});

describe('collectKrGaps — 四类缺口 reason', () => {
  it('无 target_abilities → no_target_abilities', async () => {
    const pool = mockPool([
      ['FROM key_results', { rows: [{ id: 'kr-1', title: 'KR一', metadata: {} }] }],
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-1', kr_title: 'KR一', reason: 'no_target_abilities' }]);
  });
  it('引用失联（含非 UUID）→ missing_refs', async () => {
    const abilityId = '11111111-1111-1111-1111-111111111111';
    const pool = mockPool([
      ['FROM key_results', { rows: [{ id: 'kr-2', title: 'KR二', metadata: { target_abilities: [abilityId, 'not-a-uuid'] } }] }],
      ['FROM journey_features', { rows: [] }], // abilityId 查无此人
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-2', kr_title: 'KR二', reason: 'missing_refs' }]);
  });
  it('存在 thin ability → thin_ability', async () => {
    const abilityId = '22222222-2222-2222-2222-222222222222';
    const pool = mockPool([
      ['FROM key_results', { rows: [{ id: 'kr-3', title: 'KR三', metadata: { target_abilities: [abilityId] } }] }],
      ['FROM journey_features', { rows: [{ id: abilityId, thickness: 'thin', open: '0' }] }],
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-3', kr_title: 'KR三', reason: 'thin_ability' }]);
  });
  it('advancement 未完 → advancement_incomplete；全部完好 → 无缺口', async () => {
    const a1 = '33333333-3333-3333-3333-333333333333';
    const a2 = '44444444-4444-4444-4444-444444444444';
    const pool = mockPool([
      ['FROM key_results', { rows: [
        { id: 'kr-4', title: 'KR四', metadata: { target_abilities: [a1] } },
        { id: 'kr-5', title: 'KR五', metadata: { target_abilities: [a2] } },
      ] }],
      ['FROM journey_features', (sql, params) => {
        if (params[0][0] === a1) return { rows: [{ id: a1, thickness: 'medium', open: '2' }] };
        return { rows: [{ id: a2, thickness: 'thick', open: '0' }] };
      }],
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-4', kr_title: 'KR四', reason: 'advancement_incomplete' }]);
  });
});

describe('collectExhaustedLines — active line 无 todo/doing 推进项 → 耗尽', () => {
  it('返回 id+name，SQL 含 NOT EXISTS/todo', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'j-1', name: '发布线' }] }) };
    await expect(collectExhaustedLines(pool)).resolves.toEqual([{ journey_id: 'j-1', journey_name: '发布线' }]);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/todo/);
  });
});

describe('getDirectCandidates — 直投池（alex_direct/capture_triage 的 candidate）', () => {
  it('SQL 过滤 status=candidate + source 白名单', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'gp-1', title: '直投', one_liner: 'x', kr_id: null, journey_id: null }] }) };
    const rows = await getDirectCandidates(pool);
    expect(rows).toHaveLength(1);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/alex_direct/);
    expect(sql).toMatch(/capture_triage/);
  });
});

describe('proposeCandidates — 一次 LLM 汇总 + 降级', () => {
  const inputs = {
    gaps: [{ kr_id: 'kr-1', kr_title: 'KR一', reason: 'no_target_abilities' }],
    exhausted: [{ journey_id: 'j-1', journey_name: '发布线' }],
    direct: [],
  };
  it('LLM 返回合法 JSON → 解析 candidates', async () => {
    const llm = vi.fn().mockResolvedValue({ text: '{"candidates":[{"title":"新GP","one_liner":"一句话","kr_id":"kr-1","journey_id":null,"est_scale":"约1周"}]}' });
    const r = await proposeCandidates(llm, inputs);
    expect(r.llmFailed).toBe(false);
    expect(r.candidates).toEqual([{ title: '新GP', one_liner: '一句话', kr_id: 'kr-1', journey_id: null, est_scale: '约1周' }]);
    expect(llm).toHaveBeenCalledTimes(1);
  });
  it('LLM 抛错 → 降级空候选 + llmFailed', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('boom'));
    const r = await proposeCandidates(llm, inputs);
    expect(r).toEqual({ candidates: [], llmFailed: true });
  });
  it('LLM 输出不可解析 → 降级', async () => {
    const llm = vi.fn().mockResolvedValue({ text: '我觉得挺好' });
    const r = await proposeCandidates(llm, inputs);
    expect(r).toEqual({ candidates: [], llmFailed: true });
  });
  it('无缺口无耗尽 → 不调 LLM，直接空', async () => {
    const llm = vi.fn();
    const r = await proposeCandidates(llm, { gaps: [], exhausted: [], direct: [] });
    expect(r).toEqual({ candidates: [], llmFailed: false });
    expect(llm).not.toHaveBeenCalled();
  });
});

describe('insertCandidates — 写 golden_paths(candidate, strategist) + 防重复', () => {
  it('新 title → INSERT source=strategist；重复活跃 title → skip', async () => {
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('SELECT 1 FROM golden_paths')) {
          return params[0] === '重复GP' ? { rows: [{ '?column?': 1 }] } : { rows: [] };
        }
        return { rows: [{ id: 'new-gp' }] };
      }),
    };
    const r = await insertCandidates(pool, [
      { title: '新GP', one_liner: 'x', kr_id: null, journey_id: null, est_scale: null },
      { title: '重复GP', one_liner: 'y', kr_id: null, journey_id: null, est_scale: null },
    ]);
    expect(r.inserted).toHaveLength(1);
    expect(r.skippedDuplicates).toBe(1);
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO golden_paths'));
    expect(insertCall[0]).toMatch(/strategist/);
  });
  it('非法 UUID 的 kr_id/journey_id 置 null 防炸批', async () => {
    const pool = {
      query: vi.fn(async (sql) =>
        sql.includes('SELECT 1 FROM golden_paths') ? { rows: [] } : { rows: [{ id: 'new-gp' }] }),
    };
    await insertCandidates(pool, [{ title: 'GP', one_liner: 'x', kr_id: 'kr-1（非UUID）', journey_id: 'bad', est_scale: null }]);
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO golden_paths'));
    expect(insertCall[1][3]).toBeNull(); // kr_id
    expect(insertCall[1][2]).toBeNull(); // journey_id
  });
  it('单条 INSERT 失败不阻断其他条', async () => {
    let n = 0;
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('SELECT 1 FROM golden_paths')) return { rows: [] };
        n += 1;
        if (n === 1) throw new Error('fk violation');
        return { rows: [{ id: 'gp-ok' }] };
      }),
    };
    const r = await insertCandidates(pool, [
      { title: 'A', one_liner: 'x', kr_id: null, journey_id: null, est_scale: null },
      { title: 'B', one_liner: 'y', kr_id: null, journey_id: null, est_scale: null },
    ]);
    expect(r.inserted).toHaveLength(1);
    expect(r.failed).toBe(1);
  });
});

describe('writeGapPanorama — 并行约定 key=gp_gap_panorama', () => {
  it('upsert working_memory，gaps 只留未覆盖的', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const gaps = [
      { kr_id: 'kr-1', kr_title: 'KR一', reason: 'no_target_abilities' },
      { kr_id: 'kr-2', kr_title: 'KR二', reason: 'thin_ability' },
    ];
    await writeGapPanorama(pool, gaps, new Set(['kr-1']));
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/working_memory/);
    expect(sql).toMatch(/ON CONFLICT/);
    expect(params[0]).toBe('gp_gap_panorama');
    const value = JSON.parse(params[1]);
    expect(value.generated_at).toBeTruthy();
    expect(value.gaps).toEqual([{ kr_id: 'kr-2', kr_title: 'KR二', reason: 'thin_ability' }]);
  });
});

describe('maybeRunDirectionProposer — 主入口', () => {
  const inWindow = new Date(Date.UTC(2026, 6, 12, 21, 31));
  it('窗口外不触发', async () => {
    const pool = { query: vi.fn() };
    const r = await maybeRunDirectionProposer(pool, { now: new Date(Date.UTC(2026, 6, 12, 20, 0)) });
    expect(r.triggered).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('20h 内已跑 → skip', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    const r = await maybeRunDirectionProposer(pool, { now: inWindow });
    expect(r).toMatchObject({ triggered: true, skipped: true });
  });
  it('happy path：聚合→LLM→写候选→写全景', async () => {
    const abilityId = '55555555-5555-5555-5555-555555555555';
    const pool = mockPool([
      ['gp_gap_panorama', { rows: [] }],
      ['FROM key_results', { rows: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'KR一', metadata: { target_abilities: [abilityId] } }] }],
      // 注意顺序：collectExhaustedLines 的子查询也含 FROM journey_features，NOT EXISTS 必须排前面先匹配
      ['NOT EXISTS', { rows: [] }],
      ['FROM journey_features', { rows: [{ id: abilityId, thickness: 'thin', open: '0' }] }],
      ['SELECT 1 FROM golden_paths', { rows: [] }],
      ['INSERT INTO golden_paths', { rows: [{ id: 'gp-new' }] }],
      ["source IN ('alex_direct', 'capture_triage')", { rows: [] }],
    ]);
    const llm = vi.fn().mockResolvedValue({ text: '{"candidates":[{"title":"补厚GP","one_liner":"x","kr_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","journey_id":null,"est_scale":"1周"}]}' });
    const r = await maybeRunDirectionProposer(pool, { now: inWindow, llm });
    expect(r).toMatchObject({ triggered: true, proposed: 1, gapsTotal: 1, gapsUncovered: 0, llmFailed: false });
    const upsert = pool.query.mock.calls.find(([sql]) => sql.includes('ON CONFLICT'));
    expect(JSON.parse(upsert[1][1]).gaps).toEqual([]);
  });
});
