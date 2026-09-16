import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { scheduleLegacyNotionPush } from '../legacy-notion-push-scheduler.js';
import { runNotionPushSync, runNotionTaskPull } from '../notion-push-sync.js';

vi.mock('../notion-push-sync.js', () => ({
  runNotionPushSync: vi.fn().mockResolvedValue(undefined),
  runNotionTaskPull: vi.fn().mockResolvedValue(undefined),
}));

describe('legacy Notion push scheduler', () => {
  it('默认不创建旧 Workspace 写入定时器，只有显式 true 才启用', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const setIntervalFn = vi.fn(() => ({ unref: vi.fn() }));
    const run = vi.fn().mockResolvedValue(undefined);
    const logger = { log: vi.fn(), warn: vi.fn() };

    const disabled = scheduleLegacyNotionPush(pool, {
      env: {}, setIntervalFn, run, logger,
    });
    expect(disabled).toEqual({ enabled: false, timer: null });
    expect(setIntervalFn).not.toHaveBeenCalled();

    const enabled = scheduleLegacyNotionPush(pool, {
      env: { NOTION_LEGACY_PUSH_ENABLED: 'true' },
      setIntervalFn,
      run,
      logger,
    });
    expect(enabled.enabled).toBe(true);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    await setIntervalFn.mock.calls[0][0]();
    expect(run).toHaveBeenCalledWith(pool);
  });

  it('server.js 必须接线 scheduleLegacyNotionPush——调度入口孤儿化即红（2026-09-08/09-16 先例）', () => {
    const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(src).toContain("import('./src/legacy-notion-push-scheduler.js')");
    expect(src).toMatch(/scheduleLegacyNotionPush\(pool\)/);
  });

  it('默认 run 并联 push 与 pull——pull 被摘出默认链即红（2026-09-14 并联拍板）', async () => {
    const pool = { query: vi.fn() };
    const setIntervalFn = vi.fn(() => ({ unref: vi.fn() }));
    const logger = { log: vi.fn(), warn: vi.fn() };

    scheduleLegacyNotionPush(pool, {
      env: { NOTION_LEGACY_PUSH_ENABLED: 'true' },
      setIntervalFn,
      logger,
    });
    await setIntervalFn.mock.calls[0][0]();
    expect(runNotionPushSync).toHaveBeenCalledWith(pool);
    expect(runNotionTaskPull).toHaveBeenCalledWith(pool);
  });
});
