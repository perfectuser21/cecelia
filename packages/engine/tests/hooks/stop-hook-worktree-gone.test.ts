import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const STOP_DEV_SCRIPT = join(process.cwd(), 'hooks', 'stop-dev.sh');

describe('stop-dev.sh — worktree 消失自动清理', () => {
  let tmpRoot: string;
  let mainRepo: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'stop-wtgone-'));
    mainRepo = join(tmpRoot, 'main-repo');
    mkdirSync(mainRepo);
    execSync(`git init -q "${mainRepo}"`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" commit --allow-empty -qm init`, { stdio: 'pipe' });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('主仓库残留 .dev-mode 但该分支无对应 worktree 时应自动清理', () => {
    // 模拟：主仓库有 .dev-mode.cp-gone（worktree 已被外部删除）
    const orphanDevMode = join(mainRepo, '.dev-mode.cp-gone');
    writeFileSync(
      orphanDevMode,
      ['dev', 'branch: cp-gone', 'step_1_spec: done', 'step_2_code: pending'].join('\n')
    );

    const env = {
      ...process.env,
      CLAUDE_SESSION_ID: 'current-session',
      HOME: tmpRoot,
    };

    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execSync(`cd "${mainRepo}" && bash "${STOP_DEV_SCRIPT}" 2>&1`, {
        env,
        encoding: 'utf8',
      });
    } catch (e: any) {
      exitCode = e.status;
      stdout = (e.stdout || '') + (e.stderr || '');
    }

    // 期望：不 block，自动清理
    expect(exitCode).toBe(0);
    // 孤儿文件应被删除
    expect(existsSync(orphanDevMode)).toBe(false);
  });
});
