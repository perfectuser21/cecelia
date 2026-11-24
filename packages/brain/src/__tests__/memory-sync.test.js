import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

// 已退役的 Claude auto-memory 同步不得恢复。
describe('Claude auto-memory 同步退役', () => {
  it('不再包含读取本机 Claude auto-memory 的同步实现', () => {
    expect(existsSync(new URL('../memory-sync.js', import.meta.url))).toBe(false);
  });
});
