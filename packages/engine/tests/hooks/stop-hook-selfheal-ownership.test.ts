import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const STOP_DEV = join(process.cwd(), 'hooks', 'stop-dev.sh');

describe('stop-dev.sh v16.8.0 — self-heal 所有权验证', () => {
  let tmpRoot: string;
  let mainRepo: string;
  let worktreeDir: string;
  const BRANCH = 'cp-test-ownership';
  const CURRENT_SID = 'current-session-abc';

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'heal-own-'));
    mainRepo = join(tmpRoot, 'main-repo');
    worktreeDir = join(tmpRoot, 'worktree');
    mkdirSync(mainRepo);
    execSync(`git init -q "${mainRepo}"`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" commit --allow-empty -qm init`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" worktree add -b ${BRANCH} "${worktreeDir}"`, { stdio: 'pipe' });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  const runStopDev = () => {
    try {
      const out = execSync(`cd "${mainRepo}" && bash "${STOP_DEV}" 2>&1`, {
        env: { ...process.env, CLAUDE_SESSION_ID: CURRENT_SID },
        encoding: 'utf8',
      });
      return { exitCode: 0, output: out };
    } catch (e: any) {
      return { exitCode: e.status || 0, output: (e.stdout || '') + (e.stderr || '') };
    }
  };

  it('own-session: dev-mode 含 owner_session 等于当前 -> 愈合', () => {
    writeFileSync(
      join(worktreeDir, `.dev-mode.${BRANCH}`),
      ['dev', `branch: ${BRANCH}`, `owner_session: ${CURRENT_SID}`, 'step_2_code: pending'].join('\n')
    );
    const { output } = runStopDev();
    expect(output).toMatch(/dev-lock 自愈重建/);
    expect(existsSync(join(worktreeDir, `.dev-lock.${BRANCH}`))).toBe(true);
  });

  it('other-session: dev-mode 含 owner_session 等于其他 session -> 不愈合', () => {
    writeFileSync(
      join(worktreeDir, `.dev-mode.${BRANCH}`),
      ['dev', `branch: ${BRANCH}`, 'owner_session: OTHER-session-xyz', 'step_2_code: pending'].join('\n')
    );
    const { output } = runStopDev();
    expect(output).not.toMatch(/dev-lock 自愈重建/);
    expect(existsSync(join(worktreeDir, `.dev-lock.${BRANCH}`))).toBe(false);
  });

  it('no-owner + HEAD 匹配: 无 owner_session 但主仓库 HEAD == branch -> 愈合(兼容)', () => {
    // 先删除 worktree，再切主仓库 HEAD 到同一分支（模拟单仓库场景）
    execSync(`git -C "${mainRepo}" worktree remove --force "${worktreeDir}"`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" checkout ${BRANCH}`, { stdio: 'pipe' });
    // 在主仓库放 dev-mode (no owner_session, no session_id)
    writeFileSync(
      join(mainRepo, `.dev-mode.${BRANCH}`),
      ['dev', `branch: ${BRANCH}`, 'step_2_code: pending'].join('\n')
    );
    const { output } = runStopDev();
    // 主仓库 HEAD == branch, no owner = 降级到 HEAD 匹配 -> 愈合
    expect(output).toMatch(/dev-lock 自愈重建/);
  });

  it('no-owner + HEAD 不匹配: 无 owner_session 且 HEAD != branch -> 不愈合', () => {
    // 主仓库 HEAD 保持 main (默认)
    writeFileSync(
      join(worktreeDir, `.dev-mode.${BRANCH}`),
      ['dev', `branch: ${BRANCH}`, 'step_2_code: pending'].join('\n')
    );
    const { output } = runStopDev();
    // 无 owner, main HEAD != branch -> 不愈合
    expect(output).not.toMatch(/dev-lock 自愈重建/);
    expect(existsSync(join(worktreeDir, `.dev-lock.${BRANCH}`))).toBe(false);
  });

  it('session_id 匹配: 兼容老格式 (session_id 等于当前) -> 愈合', () => {
    writeFileSync(
      join(worktreeDir, `.dev-mode.${BRANCH}`),
      ['dev', `branch: ${BRANCH}`, `session_id: ${CURRENT_SID}`, 'step_2_code: pending'].join('\n')
    );
    const { output } = runStopDev();
    expect(output).toMatch(/dev-lock 自愈重建/);
  });
});
