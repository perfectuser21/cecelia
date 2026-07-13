import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOOK = path.resolve(__dirname, '../../hooks/main-repo-write-guard.sh');

interface Env {
  base: string;
  mainRepo: string;
  worktree: string;
}

function createEnv(name: string): Env {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `main-repo-guard-${name}-`));
  const mainRepo = path.join(base, 'main');
  fs.mkdirSync(mainRepo, { recursive: true });
  execFileSync('git', ['init', '-q', mainRepo]);
  execFileSync('git', ['-C', mainRepo, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', mainRepo, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(mainRepo, 'README.md'), 'init');
  execFileSync('git', ['-C', mainRepo, 'add', '.']);
  execFileSync('git', ['-C', mainRepo, 'commit', '-q', '-m', 'init']);
  const worktree = path.join(base, 'wt');
  execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', '-b', 'session-test', worktree]);
  return { base, mainRepo, worktree };
}

function destroyEnv(env: Env): void {
  try {
    execFileSync('git', ['-C', env.mainRepo, 'worktree', 'remove', env.worktree, '--force']);
  } catch {
    // ignore
  }
  fs.rmSync(env.base, { recursive: true, force: true });
}

function run(cwd: string, input: Record<string, unknown>): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync('/bin/bash', [HOOK], {
      cwd,
      env: { ...process.env, HOOK_INPUT: JSON.stringify(input) },
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    return { exitCode: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

describe('main-repo-write-guard.sh', () => {
  let env: Env;

  beforeAll(() => {
    env = createEnv('basic');
  });

  afterAll(() => {
    destroyEnv(env);
  });

  it('主仓 + Edit → block', () => {
    const r = run(env.mainRepo, { tool_name: 'Edit', cwd: env.mainRepo, tool_input: {} });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain('"decision": "block"');
  });

  it('主仓 + Write → block', () => {
    const r = run(env.mainRepo, { tool_name: 'Write', cwd: env.mainRepo, tool_input: {} });
    expect(r.exitCode).toBe(2);
  });

  it('主仓 + Bash git commit → block', () => {
    const r = run(env.mainRepo, {
      tool_name: 'Bash',
      cwd: env.mainRepo,
      tool_input: { command: 'git commit -m "x"' },
    });
    expect(r.exitCode).toBe(2);
  });

  it('主仓 + Bash git add → block', () => {
    const r = run(env.mainRepo, {
      tool_name: 'Bash',
      cwd: env.mainRepo,
      tool_input: { command: 'git add foo.txt' },
    });
    expect(r.exitCode).toBe(2);
  });

  it('主仓 + 只读 Read → 放行', () => {
    const r = run(env.mainRepo, { tool_name: 'Read', cwd: env.mainRepo, tool_input: {} });
    expect(r.exitCode).toBe(0);
  });

  it('主仓 + Bash git status → 放行', () => {
    const r = run(env.mainRepo, {
      tool_name: 'Bash',
      cwd: env.mainRepo,
      tool_input: { command: 'git status' },
    });
    expect(r.exitCode).toBe(0);
  });

  it('worktree 内 + Edit → 放行', () => {
    const r = run(env.worktree, { tool_name: 'Edit', cwd: env.worktree, tool_input: {} });
    expect(r.exitCode).toBe(0);
  });

  it('worktree 内 + Bash git commit → 放行', () => {
    const r = run(env.worktree, {
      tool_name: 'Bash',
      cwd: env.worktree,
      tool_input: { command: 'git commit -m "x"' },
    });
    expect(r.exitCode).toBe(0);
  });
});
