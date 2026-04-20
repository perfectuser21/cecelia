import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * v17.0.0: Stop Hook 多 worktree session 路由验证
 *
 * 构造：临时 git repo + 2 个 worktree，各写不同 owner_session 的 .dev-lock。
 * 模拟 Claude Code 通过 stdin JSON 传不同 session_id，验证 stop.sh 只路由到匹配的 .dev-lock。
 *
 * 之前 bug：stop.sh 用 break 2 找第一个 .dev-lock 就路由，不区分 session。
 * 修复：v17.0.0 按 $CLAUDE_HOOK_SESSION_ID（从 stdin JSON 读）精确匹配 owner_session。
 */

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const STOP_SH = join(REPO_ROOT, 'hooks/stop.sh');

describe('Stop Hook 多 worktree session 路由（v17.0.0）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stophook-routing-'));
    // 创主仓库 + git config（CI runner 无全局配置）
    execSync(`git init -q -b main "${tmpDir}"`);
    execSync(`git -C "${tmpDir}" config user.email test@test.com`);
    execSync(`git -C "${tmpDir}" config user.name test`);
    execSync(`cd "${tmpDir}" && git commit --allow-empty -q -m init`);
    // 2 个 worktree，不同 branch
    execSync(`cd "${tmpDir}" && git worktree add -q "${tmpDir}/wt-A" -b cp-wt-A`);
    execSync(`cd "${tmpDir}" && git worktree add -q "${tmpDir}/wt-B" -b cp-wt-B`);
    // 2 个 .dev-lock，不同 owner_session
    writeFileSync(
      join(tmpDir, 'wt-A', '.dev-lock.cp-wt-A'),
      'dev\nbranch: cp-wt-A\nsession_id: headed-a\nowner_session: uuid-AAAA\ntty: not a tty\n',
    );
    writeFileSync(
      join(tmpDir, 'wt-B', '.dev-lock.cp-wt-B'),
      'dev\nbranch: cp-wt-B\nsession_id: headed-b\nowner_session: uuid-BBBB\ntty: not a tty\n',
    );
    // hooks/ 子目录装 stop.sh 副本 + fake stop-dev.sh，让 SCRIPT_DIR 自然解析
    mkdirSync(join(tmpDir, 'hooks'), { recursive: true });
    const realStopSh = execSync(`cat "${STOP_SH}"`, { encoding: 'utf8' });
    writeFileSync(join(tmpDir, 'hooks', 'stop.sh'), realStopSh);
    execSync(`chmod +x "${tmpDir}/hooks/stop.sh"`);
    writeFileSync(
      join(tmpDir, 'hooks', 'stop-dev.sh'),
      `#!/usr/bin/env bash
echo "ROUTED_TO_STOP_DEV"
echo "CLAUDE_HOOK_SESSION_ID=\${CLAUDE_HOOK_SESSION_ID:-}"
exit 0
`,
    );
    execSync(`chmod +x "${tmpDir}/hooks/stop-dev.sh"`);
  });

  afterEach(() => {
    // 清理 worktree
    try { execSync(`cd "${tmpDir}" && git worktree remove -f wt-A`); } catch {}
    try { execSync(`cd "${tmpDir}" && git worktree remove -f wt-B`); } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runStopWithSession(sessionId: string): { exitCode: number; stdout: string; stderr: string } {
    const stdin = sessionId
      ? JSON.stringify({ session_id: sessionId, transcript_path: '/tmp/x', cwd: tmpDir, hook_event_name: 'Stop', stop_hook_active: false })
      : '';
    // stop.sh v17.0.0 支持 CLAUDE_HOOK_STDIN_JSON_OVERRIDE env 作为 test 逃生（spawn stdin 不稳定）
    try {
      const out = execSync(
        `bash "${join(tmpDir, 'hooks', 'stop.sh')}" 2>&1`,
        {
          cwd: tmpDir,
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_HOOK_STDIN_JSON_OVERRIDE: stdin },
        },
      );
      return { exitCode: 0, stdout: out, stderr: '' };
    } catch (e: any) {
      return { exitCode: e.status ?? -1, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '' };
    }
  }

  it('session_id=uuid-AAAA → 只匹配 wt-A 的 .dev-lock → 路由到 stop-dev.sh', () => {
    const { exitCode, stdout } = runStopWithSession('uuid-AAAA');
    expect(stdout).toContain('ROUTED_TO_STOP_DEV');
    expect(stdout).toContain('CLAUDE_HOOK_SESSION_ID=uuid-AAAA');
    expect(exitCode).toBe(0);
  });

  it('session_id=uuid-BBBB → 只匹配 wt-B 的 .dev-lock → 路由到 stop-dev.sh', () => {
    const { exitCode, stdout } = runStopWithSession('uuid-BBBB');
    expect(stdout).toContain('ROUTED_TO_STOP_DEV');
    expect(stdout).toContain('CLAUDE_HOOK_SESSION_ID=uuid-BBBB');
    expect(exitCode).toBe(0);
  });

  it('session_id=uuid-UNKNOWN（不匹配任何 .dev-lock）→ exit 0 不路由（当前 session 不 own /dev）', () => {
    const { exitCode, stdout } = runStopWithSession('uuid-UNKNOWN');
    expect(stdout).not.toContain('ROUTED_TO_STOP_DEV');
    expect(exitCode).toBe(0);
  });

  it('无 session_id（空 stdin，interactive 老模式兼容）→ fallback 到 break-2 路由第一个 .dev-lock', () => {
    const { exitCode, stdout } = runStopWithSession('');
    expect(stdout).toContain('ROUTED_TO_STOP_DEV'); // 老行为：找到就路由
    expect(exitCode).toBe(0);
  });
});
