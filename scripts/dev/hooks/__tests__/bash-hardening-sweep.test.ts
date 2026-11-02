import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEV_ROOT = resolve(__dirname, '../..');
const entries = [
  ['hooks/branch-protect.sh', 0],
  ['hooks/bash-guard.sh', 0],
  ['hooks/dev-mode-tool-guard.sh', 0],
  ['hooks/main-repo-write-guard.sh', 0],
  ['hooks/pre-commit', 0],
  ['lib/hook-utils.sh', 0],
] as const;

describe('迁移后真实Hook在Bash空输入边界不发生未定义变量崩溃', () => {
  for (const [entry, expected] of entries) {
    it(`${entry}保留语法与空输入拒绝/放行行为`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'hook-empty-'));
      const script = resolve(DEV_ROOT, entry);
      try {
        const syntax = spawnSync('/bin/bash', ['-n', script], { encoding: 'utf8' });
        expect(syntax.status, syntax.stderr).toBe(0);
        const result = spawnSync('/bin/bash', [script], {
          cwd: dir, input: '', encoding: 'utf8', timeout: 5000,
          env: { ...process.env, HOME: dir, GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), VITEST: '', JEST_WORKER_ID: '' },
        });
        expect(result.status, result.stderr).toBe(expected);
        expect(result.stderr).not.toContain('unbound variable');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
