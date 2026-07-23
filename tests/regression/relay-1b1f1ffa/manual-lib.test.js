// manual-lib.test.js [BEHAVIOR] — 动态手测命令不能被子进程输出撑爆缓冲区
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runQuietCommand } from './manual/_lib.mjs';

describe('runQuietCommand [BEHAVIOR]', () => {
  it('忽略超过 Node 默认 maxBuffer 的输出并正常完成', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'quiet-command-'));
    const marker = join(workDir, 'completed');
    try {
      runQuietCommand(process.execPath, [
        '-e',
        "process.stdout.write('x'.repeat(2 * 1024 * 1024)); require('fs').writeFileSync(process.argv[1], 'completed')",
        marker,
      ]);
      expect(readFileSync(marker, 'utf8')).toBe('completed');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
