import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('真实 Vitest 空 changed 允许通过，但真实断言错误仍非零', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quickcheck-real-vitest-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test');
    git('config', 'core.hooksPath', '/dev/null');
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    writeFileSync(join(dir, 'vitest.config.mjs'), 'export default {test:{include:["*.test.js"],pool:"forks",maxWorkers:1,fileParallelism:false}};');
    writeFileSync(join(dir, 'source.js'), 'export const n = 1;');
    git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD').trim();
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    writeFileSync(join(dir, 'source.js'), 'export const n = 2;');
    git('add', '.'); git('commit', '-qm', 'source');
    const command = ['run', '--changed', base, '--passWithNoTests'];
    const env = { ...process.env }; delete env.VITEST; delete env.VITEST_WORKER_ID; delete env.VITEST_POOL_ID;
    const run = () => spawnSync(resolve('node_modules/.bin/vitest'), command, { cwd: dir, encoding: 'utf8', env, timeout: 20000 });
    const empty = run(); expect(empty.status, empty.stdout + empty.stderr).toBe(0); expect(empty.stdout + empty.stderr).toMatch(/No test files found/);
    writeFileSync(join(dir, 'broken.test.js'), 'import {it,expect} from "vitest"; it("real failure",()=>expect(1).toBe(2));');
    git('add', '.'); git('commit', '-qm', 'failing test');
    const failed = run(); expect(failed.status, failed.stdout + failed.stderr).toBe(1); expect(failed.stdout + failed.stderr).toContain('real failure');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 45000);
