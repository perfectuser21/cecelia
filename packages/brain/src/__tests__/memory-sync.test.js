import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// 已退役的 Claude auto-memory 同步不得再次被旧回滚 tick 接入。
describe('Claude auto-memory 同步退役', () => {
  it('旧回滚 tick 不导入或调用已退役同步器', () => {
    const runner = readFileSync(new URL('../tick-runner.js', import.meta.url), 'utf8');
    expect(runner).not.toMatch(/memorySyncIfNeeded|\.\/memory-sync\.js/);
  });

  it('不再包含读取本机 Claude auto-memory 的同步实现', () => {
    expect(existsSync(new URL('../memory-sync.js', import.meta.url))).toBe(false);
  });
});
