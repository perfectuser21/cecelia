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

  it('把 CI 的 DB_PASSWORD 映射为 PostgreSQL CLI 识别的 PGPASSWORD', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'quiet-command-env-'));
    const marker = join(workDir, 'pgpassword-forwarded');
    const oldDbPassword = process.env.DB_PASSWORD;
    const oldPgPassword = process.env.PGPASSWORD;
    process.env.DB_PASSWORD = 'ci-db-secret';
    delete process.env.PGPASSWORD;
    try {
      runQuietCommand(process.execPath, [
        '-e',
        "if (process.env.PGPASSWORD !== 'ci-db-secret') process.exit(2); require('fs').writeFileSync(process.argv[1], process.env.PGPASSWORD)",
        marker,
      ]);
      expect(readFileSync(marker, 'utf8')).toBe('ci-db-secret');
    } finally {
      if (oldDbPassword === undefined) delete process.env.DB_PASSWORD;
      else process.env.DB_PASSWORD = oldDbPassword;
      if (oldPgPassword === undefined) delete process.env.PGPASSWORD;
      else process.env.PGPASSWORD = oldPgPassword;
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
