/**
 * 桥接器子进程超时收尸（任务 7951bd36）：claude -p 会无视 SIGTERM 一直挂着，
 * 09-28 实查 126 个「每日深度综合」进程挂了最长 3 天。超时后必须升级到 SIGKILL。
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { terminateChild } = require('../../scripts/lib/child-kill.cjs');

function fakeChild({ diesOn = [] } = {}) {
  const c = new EventEmitter();
  c.exitCode = null; c.signalCode = null;
  c.kill = vi.fn((sig) => { if (diesOn.includes(sig)) { c.signalCode = sig; c.emit('exit', null, sig); } return true; });
  return c;
}

describe('terminateChild', () => {
  it('先 SIGTERM；宽限期后还活着 → SIGKILL', () => {
    vi.useFakeTimers();
    const c = fakeChild({ diesOn: ['SIGKILL'] });
    terminateChild(c, { graceMs: 5000 });
    expect(c.kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(5000);
    expect(c.kill).toHaveBeenCalledWith('SIGKILL');
    vi.useRealTimers();
  });

  it('SIGTERM 就退出了 → 不再补 SIGKILL', () => {
    vi.useFakeTimers();
    const c = fakeChild({ diesOn: ['SIGTERM'] });
    terminateChild(c, { graceMs: 5000 });
    vi.advanceTimersByTime(5000);
    expect(c.kill).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
