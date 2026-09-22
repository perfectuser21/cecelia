import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotionReq = vi.fn();
const mockGetToken = vi.fn(() => 'tok');
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: mockGetToken }));
vi.mock('../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../projection/commands.js', () => ({ recordProjectionCommand: vi.fn(), applyProjectionCommands: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

describe('notion-gtd-sync 调度', () => {
  beforeEach(() => {
    mockNotionReq.mockReset();
    mockGetToken.mockReset();
    mockGetToken.mockReturnValue('tok');
    vi.resetModules();
  });

  it('QIUMI_SYNC_ENABLED 未开 → 不起循环、不调 Notion', async () => {
    const { ensureGtdSyncLoop } = await import('../notion-gtd-sync.js');
    const setIntervalFn = vi.fn();
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env: {}, setIntervalFn })).toEqual({ started: false, running: false });
    expect(setIntervalFn).not.toHaveBeenCalled();
    expect(mockNotionReq).not.toHaveBeenCalled();
  });

  it('开启 → 只起一次 30s 定时器（幂等），handler 立即返回', async () => {
    const { ensureGtdSyncLoop, gtdSyncJobHandler } = await import('../notion-gtd-sync.js');
    const timer = { unref: vi.fn() };
    const setIntervalFn = vi.fn(() => timer);
    const env = { QIUMI_SYNC_ENABLED: 'true', QIUMI_SYNC_SINCE: '2026-09-23T00:00:00.000Z' };
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn })).toEqual({ started: true, running: true });
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn })).toEqual({ started: false, running: true });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn.mock.calls[0][1]).toBe(30_000);
    expect(timer.unref).toHaveBeenCalled();
    const started = Date.now();
    const out = await gtdSyncJobHandler({ query: vi.fn() }, { env, setIntervalFn });
    expect(Date.now() - started).toBeLessThan(200);
    expect(out).toMatchObject({ loop: 'running' });
  });

  it('开门但缺 QIUMI_SYNC_SINCE → fail-closed 不起循环（窗口只能由切换脚本写死进部署 env）', async () => {
    const { ensureGtdSyncLoop } = await import('../notion-gtd-sync.js');
    const setIntervalFn = vi.fn();
    const env = { QIUMI_SYNC_ENABLED: 'true' };
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn }))
      .toEqual({ started: false, running: false, reason: 'missing_since' });
    expect(setIntervalFn).not.toHaveBeenCalled();
    expect(env.QIUMI_SYNC_SINCE).toBeUndefined(); // 绝不回写 env：并存期窗口不许由进程自己发明
  });

  it('QIUMI_SYNC_SINCE 不是合法 ISO → 同样 fail-closed', async () => {
    const { ensureGtdSyncLoop } = await import('../notion-gtd-sync.js');
    const setIntervalFn = vi.fn();
    const env = { QIUMI_SYNC_ENABLED: 'true', QIUMI_SYNC_SINCE: '2026-09-23 有头模式' };
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn }))
      .toEqual({ started: false, running: false, reason: 'missing_since' });
    expect(setIntervalFn).not.toHaveBeenCalled();
  });

  it('定时回调吞掉本轮异常：getToken 抛 → 回调不 reject、lastRun 记录 error、不调 Notion', async () => {
    const { ensureGtdSyncLoop, gtdSyncJobHandler } = await import('../notion-gtd-sync.js');
    mockGetToken.mockImplementation(() => { throw new Error('NOTION_TOKEN 未配'); });
    let tick;
    const setIntervalFn = vi.fn((cb) => { tick = cb; return { unref: vi.fn() }; });
    const env = { QIUMI_SYNC_ENABLED: 'true', QIUMI_SYNC_SINCE: '2026-09-23T00:00:00.000Z' };
    ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn });
    await expect(tick()).resolves.toBeUndefined();
    const out = await gtdSyncJobHandler({ query: vi.fn() }, { env, setIntervalFn });
    for (const step of ['zhToEn', 'enToZh', 'ingest', 'stops', 'push']) {
      expect(out.lastRun[step]).toEqual({ error: 'notion_token_missing' });
    }
    expect(mockNotionReq).not.toHaveBeenCalled();
  });

  it('runGtdSyncOnce 顺序：zh→en, en→zh, 入账, 急停, 回写；单步失败不阻断后续', async () => {
    const mod = await import('../notion-gtd-sync.js');
    const deps = {
      syncZhToEn: vi.fn().mockRejectedValue(new Error('notion down')),
      syncEnToZh: vi.fn().mockResolvedValue({ created: 0, skipped: 0 }),
      pullMarked: vi.fn().mockResolvedValue({ ingested: 1, skipped: 0 }),
      applyOwnerStops: vi.fn().mockResolvedValue({ cancelled: 0, held: 0, resumed: 0, ignored: [] }),
      pushQiumiStatus: vi.fn().mockResolvedValue({ pushed: 1, skippedHuman: 0, skippedNoMap: 0 }),
    };
    const r = await mod.runGtdSyncOnce({ query: vi.fn() }, { token: 'tok', env: {}, ...deps });
    expect(r.zhToEn).toMatchObject({ error: 'notion down' });
    expect(r.ingest).toEqual({ ingested: 1, skipped: 0 });
    expect(r.push.pushed).toBe(1);
    const order = [deps.syncZhToEn, deps.syncEnToZh, deps.pullMarked, deps.applyOwnerStops, deps.pushQiumiStatus]
      .map((f) => f.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('scheduler-jobs 注册了 notion-gtd-sync 且在 SERIAL_JOBS', async () => {
    const { JOBS, SERIAL_JOBS } = await import('../scheduler-jobs.js');
    const job = JOBS.find((j) => j.name === 'notion-gtd-sync');
    expect(job).toBeTruthy();
    expect(job.needsPool).toBe(true);
    expect(SERIAL_JOBS.map((j) => j.name)).toContain('notion-gtd-sync');
  });

  it('并存守卫：syncZhToEn 绝不处理任务号非空的行（变异钉住二次校验）', async () => {
    const { syncZhToEn } = await import('../notion-gtd-sync.js');
    mockNotionReq.mockResolvedValueOnce({ results: [{
      id: '11111111-2222-3333-4444-555555555555', created_time: '2026-09-23T00:10:00.000Z',
      properties: { '名称': { title: [{ plain_text: 'x' }] }, '状态': { status: { name: '委派' } },
        'OpenClaw任务号': { rich_text: [{ plain_text: 'dept-dev-abc' }] }, '归档': { checkbox: false } },
    }] });
    const r = await syncZhToEn({ query: vi.fn() }, 'tok', { notionReq: mockNotionReq });
    expect(r).toEqual({ created: 0, skipped: 1 });
    expect(mockNotionReq).toHaveBeenCalledTimes(1);
  });
});
