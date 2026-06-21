import { describe, it, expect, vi } from 'vitest';
import { isDurableEnabled, bootDurable } from '../dbos-runtime.js';

describe('dbos-runtime 门控', () => {
  it('默认（无 env）返回 false', () => {
    delete process.env.DBOS_DURABLE_ENABLED;
    expect(isDurableEnabled()).toBe(false);
  });
  it('DBOS_DURABLE_ENABLED=true 才 true', () => {
    process.env.DBOS_DURABLE_ENABLED = 'true';
    expect(isDurableEnabled()).toBe(true);
    process.env.DBOS_DURABLE_ENABLED = 'false';
    expect(isDurableEnabled()).toBe(false);
    delete process.env.DBOS_DURABLE_ENABLED;
  });
});

describe('bootDurable（server.js 接线逻辑，flag门控+degrade）', () => {
  it('flag 关：不调用 init，返回 false', async () => {
    delete process.env.DBOS_DURABLE_ENABLED;
    const init = vi.fn().mockResolvedValue(undefined);
    const started = await bootDurable({ init });
    expect(init).not.toHaveBeenCalled();
    expect(started).toBe(false);
  });

  it('flag 开 + init 成功：调用 init，返回 true', async () => {
    process.env.DBOS_DURABLE_ENABLED = 'true';
    const init = vi.fn().mockResolvedValue(undefined);
    const started = await bootDurable({ init });
    expect(init).toHaveBeenCalledTimes(1);
    expect(started).toBe(true);
    delete process.env.DBOS_DURABLE_ENABLED;
  });

  it('flag 开 + init throw：degrade 不抛、返回 false（brain 继续启动）', async () => {
    process.env.DBOS_DURABLE_ENABLED = 'true';
    const init = vi.fn().mockRejectedValue(new Error('DBOSInitializationError'));
    let threw = false;
    let started;
    try {
      started = await bootDurable({ init });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false); // 绝不阻断启动
    expect(started).toBe(false);
    delete process.env.DBOS_DURABLE_ENABLED;
  });
});
