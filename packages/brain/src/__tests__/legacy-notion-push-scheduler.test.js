import { describe, expect, it, vi } from 'vitest';
import { scheduleLegacyNotionPush } from '../legacy-notion-push-scheduler.js';

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
});
