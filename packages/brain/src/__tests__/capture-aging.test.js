import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const START = new Date('2026-01-01T00:00:00.000Z');
const LOCAL_WEBHOOK = 'http://127.0.0.1:9/capture-aging-test';
const ZERO = {
  overdue_captures: 0, overdue_atoms: 0, retried: 0,
  parked_by_aging: 0, stuck_parked: 0,
};

function mixedResponses() {
  return [
    { rows: [{ id: 'c1', content: 'capture one' }, { id: 'c2', content: 'capture two' }] },
    { rows: [{ id: 'a1', content: 'atom one' }] },
    { rows: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
    { rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }] },
    { rows: [{ id: 's1' }] },
  ];
}

function mixedPool() {
  const responses = mixedResponses();
  return { query: vi.fn().mockImplementation(async () => responses.shift()) };
}

async function loadAging() {
  vi.resetModules();
  return import('../capture-aging.js');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv('FEISHU_CAPTURE_AGING_WEBHOOK', '');
  vi.stubEnv('FEISHU_SKILL_EVAL_WEBHOOK', '');
  vi.stubEnv('CECELIA_CAPTURE_AGING_INTERVAL_MS', '60000');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runCaptureAging：真实实现的查询边界与计数', () => {
  it('分别累计五个查询的返回行，避免计数归零、串位或漏执行兜底分支', async () => {
    const { runCaptureAging } = await loadAging();
    const pool = mixedPool();
    expect(await runCaptureAging(pool)).toEqual({
      overdue_captures: 2, overdue_atoms: 1, retried: 4,
      parked_by_aging: 3, stuck_parked: 1,
    });
    expect(pool.query).toHaveBeenCalledTimes(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('停车与重试查询都接收阈值3，并分别使用达到上限与未达上限的边界', async () => {
    const { runCaptureAging } = await loadAging();
    const pool = mixedPool();
    await runCaptureAging(pool);
    expect(pool.query.mock.calls[2][1]).toEqual([3]);
    expect(pool.query.mock.calls[2][0]).toMatch(/retry_count >= \$1/);
    expect(pool.query.mock.calls[2][0]).toContain('[aging:max_retry_parked]');
    expect(pool.query.mock.calls[3][1]).toEqual([3]);
    expect(pool.query.mock.calls[3][0]).toMatch(/retry_count < \$1/);
    expect(pool.query.mock.calls[3][0]).toMatch(/ai_reason = NULL, retry_count = retry_count \+ 1/);
  });

  // F6永久回归：任务96a00f17，决策efa578b8、4c595c84；保留三标签兜底与结果语义。
  it('[F6修复-回归] aging step5 必须清零 no_journey/low_confidence/gate_fail stuck atoms', async () => {
    const { runCaptureAging } = await loadAging();
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/UPDATE capture_atoms/.test(sql) && sql.includes('[triage:no_journey%')
        && sql.includes('[triage:low_confidence%') && sql.includes('[triage:gate_fail%')) {
        expect(sql).toMatch(/status = 'parked'/);
        expect(sql).toMatch(/WHERE status = 'pending_review'/);
        return { rows: [{ id: 'stuck-1' }, { id: 'stuck-2' }] };
      }
      return { rows: [] };
    }) };
    expect(await runCaptureAging(pool)).toEqual({
      overdue_captures: 0, overdue_atoms: 0, retried: 0, parked_by_aging: 0, stuck_parked: 2,
    });
    expect(pool.query).toHaveBeenCalledTimes(5);
  });

  it('[F6修复-回归] aging step5 无匹配时返回数字0，同时所有其他计数为0且不告警', async () => {
    const { runCaptureAging } = await loadAging();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    expect(await runCaptureAging(pool)).toEqual(ZERO);
    expect(pool.query).toHaveBeenCalledTimes(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [0, { overdue_captures: 0, overdue_atoms: 0, retried: 0, parked_by_aging: 0, stuck_parked: 0 }],
    [1, { overdue_captures: 2, overdue_atoms: 0, retried: 0, parked_by_aging: 0, stuck_parked: 0 }],
    [2, { overdue_captures: 2, overdue_atoms: 1, retried: 0, parked_by_aging: 0, stuck_parked: 0 }],
    [3, { overdue_captures: 2, overdue_atoms: 1, retried: 0, parked_by_aging: 3, stuck_parked: 0 }],
    [4, { overdue_captures: 2, overdue_atoms: 1, retried: 4, parked_by_aging: 3, stuck_parked: 0 }],
  ])('查询%s失败时停止后续查询，吞错并返回失败前已取得的计数', async (failedIndex, expected) => {
    const { runCaptureAging } = await loadAging();
    const responses = mixedResponses();
    const pool = { query: vi.fn().mockImplementation(async () => {
      if (pool.query.mock.calls.length === failedIndex + 1) throw new Error('database unavailable');
      return responses.shift();
    }) };
    expect(await runCaptureAging(pool)).toEqual(expected);
    expect(pool.query).toHaveBeenCalledTimes(failedIndex + 1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('database unavailable'));
  });
});

describe('runCaptureAging：告警只经过本机fetch替身', () => {
  it('两类超期分别发送计数，主Webhook优先于后备地址', async () => {
    vi.stubEnv('FEISHU_CAPTURE_AGING_WEBHOOK', LOCAL_WEBHOOK);
    vi.stubEnv('FEISHU_SKILL_EVAL_WEBHOOK', 'http://127.0.0.1:9/fallback-test');
    const { runCaptureAging } = await loadAging();
    await runCaptureAging(mixedPool());
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.map(([url]) => url)).toEqual([LOCAL_WEBHOOK, LOCAL_WEBHOOK]);
    expect(calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(calls[0][1].body)).toMatchObject({
      msg_type: 'text', content: { text: expect.stringContaining('2 条 capture 超 7 天') },
    });
    expect(JSON.parse(calls[1][1].body)).toMatchObject({
      msg_type: 'text', content: { text: expect.stringContaining('1 条 capture_atom 超 7 天') },
    });
  });

  it('主Webhook为空时使用后备地址', async () => {
    vi.stubEnv('FEISHU_SKILL_EVAL_WEBHOOK', LOCAL_WEBHOOK);
    const { runCaptureAging } = await loadAging();
    await runCaptureAging(mixedPool());
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([LOCAL_WEBHOOK, LOCAL_WEBHOOK]);
  });

  it.each(['http-error', 'network-error'])('告警%s不阻断后续查询与计数', async (failure) => {
    vi.stubEnv('FEISHU_CAPTURE_AGING_WEBHOOK', LOCAL_WEBHOOK);
    if (failure === 'http-error') vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 });
    else vi.mocked(fetch).mockRejectedValue(new Error('local fetch failure'));
    const { runCaptureAging } = await loadAging();
    const pool = mixedPool();
    expect(await runCaptureAging(pool)).toEqual({
      overdue_captures: 2, overdue_atoms: 1, retried: 4, parked_by_aging: 3, stuck_parked: 1,
    });
    expect(pool.query).toHaveBeenCalledTimes(5);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(
      failure === 'http-error' ? '503' : 'local fetch failure',
    ));
  });
});

describe('runCaptureAging：间隔与reset', () => {
  it('自定义间隔前跳过、恰到60秒恢复，reset立即重新放行', async () => {
    const { runCaptureAging, __resetCaptureAgingForTest } = await loadAging();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await runCaptureAging(pool);
    pool.query.mockClear();
    vi.setSystemTime(new Date(START.getTime() + 59999));
    expect(await runCaptureAging(pool)).toEqual({
      skipped: true, overdue_captures: 0, overdue_atoms: 0, retried: 0, parked_by_aging: 0,
    });
    expect(pool.query).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(START.getTime() + 60000));
    expect(await runCaptureAging(pool)).toEqual(ZERO);
    expect(pool.query).toHaveBeenCalledTimes(5);
    __resetCaptureAgingForTest();
    expect(await runCaptureAging(pool)).toEqual(ZERO);
    expect(pool.query).toHaveBeenCalledTimes(10);
  });

  it('未覆盖间隔时默认一小时，查询失败也占用本轮间隔', async () => {
    vi.stubEnv('CECELIA_CAPTURE_AGING_INTERVAL_MS', '');
    const { runCaptureAging } = await loadAging();
    const pool = { query: vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue({ rows: [] }) };
    expect(await runCaptureAging(pool)).toEqual(ZERO);
    pool.query.mockClear();
    vi.setSystemTime(new Date(START.getTime() + 3599999));
    expect(await runCaptureAging(pool)).toHaveProperty('skipped', true);
    expect(pool.query).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(START.getTime() + 3600000));
    expect(await runCaptureAging(pool)).toEqual(ZERO);
    expect(pool.query).toHaveBeenCalledTimes(5);
  });
});
