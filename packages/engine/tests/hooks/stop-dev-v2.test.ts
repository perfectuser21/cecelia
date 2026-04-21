/**
 * tests/hooks/stop-dev-v2.test.ts
 *
 * 测试 stop-dev-v2.sh 的 7 个契约行为
 * 契约定义: docs/superpowers/specs/2026-04-21-stop-dev-v2-cwd-as-key-design.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const HOOK = resolve(__dirname, '../../hooks/stop-dev-v2.sh');
const BLOCK_PATTERN = /"decision"\s*:\s*"block"/;

function runHook(opts: {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('bash', [HOOK], {
    cwd: opts.cwd ?? '/tmp',
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.stdin ?? '',
    encoding: 'utf-8',
    timeout: 10000,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function makeGitDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'stop-dev-v2-'));
  const run = (cmd: string) => execSync(cmd, { cwd: d });
  run('git init -q');
  run('git config user.email t@e.com');
  run('git config user.name t');
  writeFileSync(join(d, 'README.md'), '#');
  run('git add . && git commit -q -m init');
  return d;
}

describe('stop-dev-v2.sh 契约行为', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeGitDir();
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('契约 1: CECELIA_STOP_HOOK_BYPASS=1 → exit 0', () => {
    const r = runHook({ env: { CECELIA_STOP_HOOK_BYPASS: '1' } });
    expect(r.status).toBe(0);
  });

  it('契约 2: CLAUDE_HOOK_CWD 空 + $PWD 非 git → exit 0', () => {
    const nonGit = mkdtempSync(join(tmpdir(), 'stop-dev-v2-nongit-'));
    try {
      const r = runHook({ cwd: nonGit });
      expect(r.status).toBe(0);
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it('契约 3: cwd=主仓库（branch=main 分支名一致） → exit 0', () => {
    spawnSync('bash', ['-c', 'git branch -m main || true'], { cwd: dir });
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(0);
  });

  it('契约 4: cp-* 分支但无 .dev-mode → exit 0', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(0);
  });

  it('契约 5: .dev-mode 首行 branch=xxx（等号格式） → exit 2 fail-closed', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    writeFileSync(
      join(dir, '.dev-mode.cp-test-branch'),
      'branch=cp-test-branch\ntask=test\nagent=a\ncreated_at=2026-04-21\n',
    );
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('格式异常');
  });

  it('契约 6: .dev-mode 标准格式 + step_2_code=pending → exit 2 block', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    writeFileSync(
      join(dir, '.dev-mode.cp-test-branch'),
      'dev\nbranch: cp-test-branch\nstep_1_spec: done\nstep_2_code: pending\n',
    );
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(BLOCK_PATTERN);
    expect(r.stdout).not.toContain('格式异常');
  });

  it('契约 7: .dev-mode 首行 dev 但缺 branch 字段 → exit 2 透传', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    writeFileSync(
      join(dir, '.dev-mode.cp-test-branch'),
      'dev\nstep_1_spec: pending\n',
    );
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(BLOCK_PATTERN);
    expect(r.stdout).not.toContain('格式异常');
  });
});
