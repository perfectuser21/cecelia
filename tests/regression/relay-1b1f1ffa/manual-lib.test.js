// manual-lib.test.js [BEHAVIOR] — 动态手测命令不能被子进程输出撑爆缓冲区
import { describe, it, expect } from 'vitest';
import { runQuietCommand } from './manual/_lib.mjs';

describe('runQuietCommand [BEHAVIOR]', () => {
  it('忽略超过 Node 默认 maxBuffer 的输出并正常完成', () => {
    expect(() => runQuietCommand(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"],
    )).not.toThrow();
  });
});
