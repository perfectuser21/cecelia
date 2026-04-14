import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const STOP_DEV = join(process.cwd(), 'hooks', 'stop-dev.sh');

// v16.8.0 更新: self-heal 加入所有权验证，只愈合能证明属于当前 session 的 dev-mode
// 跨分支场景 (main HEAD != worktree branch) 现在必须有 owner_session 才能自愈
describe('stop-dev.sh v16.8.0 — self-heal 跨分支（main 仓库 session 治愈 worktree dev-mode）', () => {
  let tmpRoot: string;
  let mainRepo: string;
  let worktreeDir: string;
  const BRANCH_IN_WT = 'cp-test-crossheal';

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'xheal-'));
    mainRepo = join(tmpRoot, 'main-repo');
    worktreeDir = join(tmpRoot, 'worktree');

    // main repo init
    mkdirSync(mainRepo);
    execSync(`git init -q "${mainRepo}"`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${mainRepo}" commit --allow-empty -qm init`, { stdio: 'pipe' });

    // create a real worktree
    execSync(`git -C "${mainRepo}" worktree add -b ${BRANCH_IN_WT} "${worktreeDir}"`, { stdio: 'pipe' });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  const runStopDev = (cwd: string, env: Record<string, string>) => {
    try {
      const out = execSync(`cd "${cwd}" && bash "${STOP_DEV}" 2>&1`, {
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      return { exitCode: 0, output: out };
    } catch (e: any) {
      return { exitCode: e.status || 0, output: (e.stdout || '') + (e.stderr || '') };
    }
  };

  it('场景: main 仓库 session (HEAD=main), worktree dev-mode 含 owner_session 匹配 -> 应被自愈', () => {
    // v16.8.0: 必须有 owner_session 才能跨分支自愈（dev-mode 由 01-spec.md 写入时自动带 owner_session）
    writeFileSync(
      join(worktreeDir, `.dev-mode.${BRANCH_IN_WT}`),
      ['dev', `branch: ${BRANCH_IN_WT}`, 'owner_session: main-session', 'step_1_spec: done', 'step_2_code: pending'].join('\n')
    );
    // main repo HEAD is main, worktree HEAD is cp-test-crossheal
    const { output } = runStopDev(mainRepo, {
      CLAUDE_SESSION_ID: 'main-session',
    });
    // owner_session 匹配 -> 应自愈 worktree 里的 dev-mode
    expect(output).toMatch(/dev-lock 自愈重建/);
    // dev-lock 应出现在 worktree 里
    const lockFile = join(worktreeDir, `.dev-lock.${BRANCH_IN_WT}`);
    expect(existsSync(lockFile)).toBe(true);
    const lockContent = readFileSync(lockFile, 'utf8');
    expect(lockContent).toContain('session_id: main-session');
    expect(lockContent).toContain('recovered: true');
  });

  it('场景: main 仓库 session (HEAD=main), worktree dev-mode 无 owner_session -> 不应被自愈（v16.8.0 防误愈）', () => {
    // 无 owner_session 且 main HEAD != worktree branch -> 不愈合（防 Harness 后台 orphan 被误愈）
    writeFileSync(
      join(worktreeDir, `.dev-mode.${BRANCH_IN_WT}`),
      ['dev', `branch: ${BRANCH_IN_WT}`, 'step_1_spec: done', 'step_2_code: pending'].join('\n')
    );
    const { output } = runStopDev(mainRepo, {
      CLAUDE_SESSION_ID: 'main-session',
    });
    // 无所有权标识 + HEAD 不匹配 -> 不自愈
    expect(output).not.toMatch(/dev-lock 自愈重建/);
    expect(existsSync(join(worktreeDir, `.dev-lock.${BRANCH_IN_WT}`))).toBe(false);
  });

  it('场景: dev-mode 在无效目录 (非 worktree)，不自愈（防 T4 scenario）', () => {
    // 在一个不是 worktree 的临时目录放 dev-mode
    const orphanDir = join(tmpRoot, 'orphan');
    mkdirSync(orphanDir);
    writeFileSync(
      join(orphanDir, '.dev-mode.cp-orphan'),
      ['dev', 'branch: cp-orphan', 'step_2_code: pending'].join('\n')
    );
    // 但 stop-dev 基于 git worktree list 扫描，不会看 orphanDir
    // 这个测试验证 git worktree list 扫不到就不自愈
    const { output } = runStopDev(mainRepo, {
      CLAUDE_SESSION_ID: 'main-session',
    });
    expect(existsSync(join(orphanDir, '.dev-lock.cp-orphan'))).toBe(false);
  });
});
