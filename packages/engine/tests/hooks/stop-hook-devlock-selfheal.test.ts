import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const STOP_DEV = join(process.cwd(), 'hooks', 'stop-dev.sh');

describe('stop-dev.sh — dev-lock 自愈机制', () => {
  let tmpRoot: string;
  let wt: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'devlock-heal-'));
    wt = join(tmpRoot, 'wt');
    mkdirSync(wt);
    execSync(`git init -q "${wt}"`, { stdio: 'pipe' });
    execSync(`git -C "${wt}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${wt}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${wt}" commit --allow-empty -qm init`, { stdio: 'pipe' });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  const runStopDev = (env: Record<string, string>) => {
    try {
      const out = execSync(`cd "${wt}" && bash "${STOP_DEV}" 2>&1`, {
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      return { exitCode: 0, output: out };
    } catch (e: any) {
      return {
        exitCode: e.status || 0,
        output: (e.stdout || '') + (e.stderr || ''),
      };
    }
  };

  it('场景 1: dev-lock 存在 → 走原逻辑（不自愈）', () => {
    const branch = 'cp-test-existing';
    writeFileSync(
      join(wt, `.dev-mode.${branch}`),
      ['dev', `branch: ${branch}`, 'step_1_spec: done', 'step_2_code: pending'].join('\n')
    );
    writeFileSync(
      join(wt, `.dev-lock.${branch}`),
      ['dev', `branch: ${branch}`, 'session_id: existing-session', 'tty: none'].join('\n')
    );

    const { exitCode, output } = runStopDev({ CLAUDE_SESSION_ID: 'current-session' });

    // 不应出现自愈日志
    expect(output).not.toMatch(/dev-lock 自愈重建/);
  });

  it('场景 2: dev-lock 缺失 + CLAUDE_SESSION_ID 有值 + 当前分支匹配 → 自愈重建', () => {
    const branch = 'cp-test-heal';
    // 切到该分支让 HEAD 匹配 dev-mode branch（自愈条件 3）
    execSync(`git -C "${wt}" checkout -q -b ${branch}`, { stdio: 'pipe' });
    writeFileSync(
      join(wt, `.dev-mode.${branch}`),
      ['dev', `branch: ${branch}`, 'step_1_spec: done', 'step_2_code: pending'].join('\n')
    );
    // 故意不写 dev-lock

    const { exitCode, output } = runStopDev({ CLAUDE_SESSION_ID: 'current-session-yyy' });

    // 应出现自愈日志
    expect(output).toMatch(/dev-lock 自愈重建/);

    // dev-lock 应被重建
    const lockFile = join(wt, `.dev-lock.${branch}`);
    expect(existsSync(lockFile)).toBe(true);
    const lockContent = readFileSync(lockFile, 'utf8');
    expect(lockContent).toMatch(/^dev$/m);
    expect(lockContent).toContain('session_id: current-session-yyy');
    expect(lockContent).toContain('recovered: true');
  });

  it('场景 3: dev-mode 首行不是 dev → 不自愈（防误识别）', () => {
    const branch = 'cp-test-notdev';
    writeFileSync(
      join(wt, `.dev-mode.${branch}`),
      ['random-first-line', `branch: ${branch}`, 'step_2_code: pending'].join('\n')
    );

    const { exitCode, output } = runStopDev({ CLAUDE_SESSION_ID: 'current-session' });

    // 不应自愈
    expect(output).not.toMatch(/dev-lock 自愈重建/);
    // dev-lock 不应被创建
    expect(existsSync(join(wt, `.dev-lock.${branch}`))).toBe(false);
  });
});
