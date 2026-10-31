import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query } }));
// Both cascade-list and radius-client stay real. Only HTTP and SQL leave process.
import { getCascadeList } from '../../../packages/brain/src/cascade-list.js';

const changedFiles = ['src/changed.js'];
const radiusData = {
  affected_features: [{ feature_id: 'feature-1', name: '测试能力', promises: [{ journey_name: '测试流程' }] }],
  affected_tests: ['tests/runnable.test.js', 'L3:真机'],
  freshness: { stale: false, generated_at: '2026-07-18T00:00:00Z' },
};
const fallbackCells = [
  { assertion_ref: 'tests/fallback.test.js', na_reason: null },
  { assertion_ref: 'manual:node check.js', na_reason: null },
  { assertion_ref: 'L3:真机', na_reason: null },
  { assertion_ref: null, na_reason: null },
];
let warn;
beforeEach(() => {
  vi.useFakeTimers();
  query.mockReset().mockResolvedValue({ rows: fallbackCells });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function assertFallback(result) {
  expect(result.source).toBe('journey_step_links');
  expect(result.radius_result).toBeNull();
  expect(result.cells).toEqual(fallbackCells);
  expect(result.report).toMatchObject({ total: 4, runnable_count: 2, nightly_pending_count: 1, unregistered_count: 1 });
  expect(result.report.runnable_cells).toEqual(fallbackCells.slice(0, 2));
  expect(query).toHaveBeenCalledOnce();
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('FROM activity_cells');
  expect(sql).toContain('jf.unit_test_path = ANY($1::text[])');
  expect(params).toEqual([['src/changed.js']]);
  expect(warn).toHaveBeenCalledWith('[WARN][rerun-gate] radius unavailable or stale — falling back to journey_step_links');
}

describe('真实 radius-client → cascade-list 联动', () => {
  it('新鲜图结果映射为清单及可运行报告，不查询 DB 或报警', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => radiusData }));
    const result = await getCascadeList(changedFiles);
    expect(result.source).toBe('radius');
    expect(result.radius_result).toEqual(radiusData);
    expect(result.cells).toEqual([
      { assertion_ref: 'tests/runnable.test.js', na_reason: null },
      { assertion_ref: 'L3:真机', na_reason: null },
    ]);
    expect(result.report).toMatchObject({ total: 2, runnable_count: 1, nightly_pending_count: 1, unregistered_count: 0 });
    expect(query).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('图结果没有受影响测试时返回空清单，不误回退格子', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ affected_features: [], affected_tests: [], freshness: { stale: false } }) }));
    const result = await getCascadeList(changedFiles);
    expect(result.cells).toEqual([]);
    expect(result.report.total).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('网络失败后查询实际 activity_cells 回退，并返回其报告与 WARN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    assertFallback(await getCascadeList(changedFiles));
  });

  it('stale 图数据不得混入结果，必须走 DB 回退与 WARN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...radiusData, freshness: { stale: true } }) }));
    assertFallback(await getCascadeList(changedFiles));
  });

  it('HTTP 503 后走 DB 回退与 WARN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    assertFallback(await getCascadeList(changedFiles));
  });

  it('满 3000ms 才取消 HTTP，并通过 DB 回退返回结果', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
    })));
    const pending = getCascadeList(changedFiles);
    await vi.advanceTimersByTimeAsync(2999);
    expect(query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    assertFallback(await pending);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('回退 DB 失败时向调用者传播，不伪造成功空结果', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(getCascadeList(changedFiles)).rejects.toThrow('database unavailable');
  });
});
