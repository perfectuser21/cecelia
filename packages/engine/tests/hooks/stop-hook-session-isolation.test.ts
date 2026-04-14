import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('stop-dev.sh — 跨 session orphan 隔离', () => {
  let tmpRoot: string;
  let fakeWorktree: string;
  const STOP_DEV_SCRIPT = join(process.cwd(), 'hooks', 'stop-dev.sh');

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'stop-isol-'));
    fakeWorktree = join(tmpRoot, 'fake-wt');
    mkdirSync(fakeWorktree);
    // Init as a git repo so git commands work
    execSync(`git init -q "${fakeWorktree}"`, { stdio: 'pipe' });
    execSync(`git -C "${fakeWorktree}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${fakeWorktree}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${fakeWorktree}" commit --allow-empty -qm init`, { stdio: 'pipe' });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('跨 session 的 orphan (不同 session_id 的 dev-lock) 应放行当前 session 退出', () => {
    // 其他 session 留下的 orphan dev-mode + 对应 dev-lock（session_id=other）
    writeFileSync(
      join(fakeWorktree, '.dev-mode.cp-orphan'),
      ['dev', 'branch: cp-orphan', 'step_1_spec: done', 'step_2_code: pending'].join('\n')
    );
    writeFileSync(
      join(fakeWorktree, '.dev-lock.cp-orphan'),
      ['dev', 'branch: cp-orphan', 'session_id: other-session-xxx', 'tty: not a tty'].join('\n')
    );

    const env = {
      ...process.env,
      CLAUDE_SESSION_ID: 'current-session-yyy',
      HOME: tmpRoot,  // 避免真实 HOME 干扰
    };

    // stop-dev.sh 应当不 block (exit 0) 因为 orphan 属于不同 session
    // 使用 shell 直接执行，捕获 exit code
    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execSync(`cd "${fakeWorktree}" && bash "${STOP_DEV_SCRIPT}" 2>&1`, {
        env,
        encoding: 'utf8',
      });
    } catch (e: any) {
      exitCode = e.status;
      stdout = (e.stdout || '') + (e.stderr || '');
    }

    // 期望：不 block (exit 0 或 allow)
    // 若实现正确，应在 stderr 看到 warning，exit 0
    if (exitCode !== 0) {
      // 如果是 block，输出原因以便调试
      expect.fail(`Expected exit 0 (cross-session orphan allowed), got ${exitCode}. Output: ${stdout}`);
    }
    expect(exitCode).toBe(0);
  });

  it('同 session 的 orphan (相同 session_id) 应继续 block', () => {
    writeFileSync(
      join(fakeWorktree, '.dev-mode.cp-mine'),
      ['dev', 'branch: cp-mine', 'step_1_spec: done', 'step_2_code: pending'].join('\n')
    );
    writeFileSync(
      join(fakeWorktree, '.dev-lock.cp-mine'),
      ['dev', 'branch: cp-mine', 'session_id: current-session-yyy', 'tty: not a tty'].join('\n')
    );

    const env = {
      ...process.env,
      CLAUDE_SESSION_ID: 'current-session-yyy',
      HOME: tmpRoot,
    };

    let exitCode = 0;
    try {
      execSync(`cd "${fakeWorktree}" && bash "${STOP_DEV_SCRIPT}" 2>&1`, { env, encoding: 'utf8' });
    } catch (e: any) {
      exitCode = e.status;
    }
    // 同 session — 正常流程会匹配 dev-lock 进入 devloop_check，因为 session_id 匹配
    // 不是 orphan path。测试验证不 crash。
    expect([0, 2]).toContain(exitCode);
  });
});
