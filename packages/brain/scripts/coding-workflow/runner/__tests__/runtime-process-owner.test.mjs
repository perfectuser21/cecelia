import { it, expect } from 'vitest';
import { signalOwned } from '../runtime-process.mjs';
const row = (pid, ppid, pgid, start) => ({ pid, ppid, pgid, start });
it('210秒宽限后PID已复用：不能给新会话发信号，也不能杀复用的进程组', () => {
  const owned = new Map([[101, 'first'], [102, 'old-child']]);
  const snapshot = [row(101, 1, 101, 'replacement'), row(102, 1, 102, 'new-child')];
  const signals = [];
  const lost = signalOwned(101, owned, snapshot, 'SIGKILL', (pid, sig) => signals.push([pid, sig]));
  expect(signals).toEqual([]); expect(lost).toBe(true);
});
it('仍属原会话的进程组和独立组后代可收割，不碰旁人', () => {
  const owned = new Map([[101, 'first'], [102, 'child'], [103, 'detached']]);
  const snapshot = [row(101, 1, 101, 'first'), row(102, 101, 101, 'child'), row(103, 1, 103, 'detached'), row(200, 1, 200, 'other')];
  const signals = [];
  expect(signalOwned(101, owned, snapshot, 'SIGTERM', (pid, sig) => signals.push([pid, sig]))).toBe(false);
  expect(signals).toEqual([[-101, 'SIGTERM'], [103, 'SIGTERM']]);
});
it('原组长退出后只凭仍匹配的已知组员证明组归属', () => {
  const owned = new Map([[101, 'first'], [102, 'child']]);
  const signals = [];
  signalOwned(101, owned, [row(102, 1, 101, 'child')], 'SIGKILL', (pid, sig) => signals.push([pid, sig]));
  expect(signals).toEqual([[-101, 'SIGKILL']]);
});
