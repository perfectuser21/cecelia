import { describe, it, expect, vi } from 'vitest';
import { isDurableEnabled, bootDurable, initDurable } from '../dbos-runtime.js';

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

describe('initDurable I2/I3：isInitialized 守卫 + launch 失败释放 sysPool', () => {
  it('I3：launch reject 时 sysPool.end() 被调（不泄漏连接），错误向上抛', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const makePool = vi.fn(() => ({ end }));
    const launch = vi.fn().mockRejectedValue(new Error('boom'));
    let caught;
    try {
      await initDurable({ _makePool: makePool, _launch: launch, _setConfig: () => {} });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(end).toHaveBeenCalledTimes(1); // sysPool 被释放
  });

  it('I2：已 initialized（isInitialized 真）→ 直接 return，不 setConfig/不 launch', async () => {
    const launch = vi.fn();
    const setConfig = vi.fn();
    const makePool = vi.fn();
    await initDurable({ _isInitialized: () => true, _launch: launch, _setConfig: setConfig, _makePool: makePool });
    expect(launch).not.toHaveBeenCalled();
    expect(setConfig).not.toHaveBeenCalled();
    expect(makePool).not.toHaveBeenCalled();
  });
});
