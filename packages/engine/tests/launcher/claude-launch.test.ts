import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const LAUNCHER = resolve(__dirname, '../../../../scripts/claude-launch.sh');

describe('Phase 7.1 claude-launch.sh', () => {
  let mockDir: string;

  beforeAll(() => {
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-test-'));
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(mockClaude, `#!/usr/bin/env bash
echo "CLAUDE_SESSION_ID=$CLAUDE_SESSION_ID"
echo "ARGS=$*"
`);
    chmodSync(mockClaude, 0o755);
  });

  afterAll(() => {
    rmSync(mockDir, { recursive: true, force: true });
  });

  it('launcher 脚本存在且可执行', () => {
    expect(existsSync(LAUNCHER)).toBe(true);
    const mode = statSync(LAUNCHER).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('有 env 时继承 CLAUDE_SESSION_ID 并传 --session-id', () => {
    // launcher 优先用 CLAUDE_CODE_EXECPATH，必须 unset 才能让 PATH 里 mock claude 生效
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: 'inherited-test-uuid',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --help`, { shell: '/bin/bash', env }).toString();
    expect(out).toContain('CLAUDE_SESSION_ID=inherited-test-uuid');
    expect(out).toContain('--session-id inherited-test-uuid');
    expect(out).toContain('--help');
  });

  it('无 env 时生成符合 UUID 格式的 session_id', () => {
    const env = { ...process.env, PATH: `${mockDir}:${process.env.PATH}`, CECELIA_NO_AUTO_WORKTREE: '1' };
    delete env.CLAUDE_SESSION_ID;
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --help`, { shell: '/bin/bash', env }).toString();
    const m = out.match(/CLAUDE_SESSION_ID=([a-f0-9-]+)/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(out).toContain(`--session-id ${m![1]}`);
  });

  it('透传额外参数给 claude', () => {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: 'fixed',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" -p test-prompt --dangerously-skip-permissions`, { shell: '/bin/bash', env }).toString();
    expect(out).toContain('-p test-prompt');
    expect(out).toContain('--dangerously-skip-permissions');
    expect(out).toContain('--session-id fixed');
  });
});

describe('Phase 7.7 claude-launch.sh 自动 worktree — --dry-run 契约', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'claude-launch-mainrepo-'));
    execSync('git init -q', { cwd: repoDir });
    execSync('git config user.email test@test.com', { cwd: repoDir });
    execSync('git config user.name Test', { cwd: repoDir });
    writeFileSync(join(repoDir, 'README.md'), 'x');
    execSync('git add . && git commit -q -m init', { cwd: repoDir });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('主仓根 + 交互模式 → dry-run 输出含 worktree 建立步骤', () => {
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: repoDir, env }).toString();
    expect(out).toContain('worktree add');
  });

  it('headless（-p）→ dry-run 输出不含 worktree 建立步骤', () => {
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run -p "hi"`, { cwd: repoDir, env }).toString();
    expect(out).not.toContain('worktree add');
  });

  it('CECELIA_NO_AUTO_WORKTREE=1 → dry-run 输出不含 worktree 建立步骤', () => {
    const env: Record<string, string> = {
      ...process.env,
      CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: repoDir, env }).toString();
    expect(out).not.toContain('worktree add');
  });

  it('cwd 已在 worktree 内 → dry-run 输出不含 worktree 建立步骤', () => {
    const wtDir = join(repoDir, '..', 'precreated-wt');
    execSync(`git worktree add -q -b precreated "${wtDir}"`, { cwd: repoDir });
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: wtDir, env }).toString();
    expect(out).not.toContain('worktree add');
    execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir });
  });
});
