import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Phase 7.4 — /dev 完整 7 棒接力链 + Stop Hook 循环机制 E2E regression
 *
 * 为什么存在：
 *   Phase 7.1 / 7.2 / 7.3 修复了 Stop Hook 循环机制「形同虚设」的一系列 bug。
 *   但至今没有集成测试把整链关键关节串起来验证——任何一环（launcher export
 *   CLAUDE_SESSION_ID / worktree-manage 读 env 写 owner_session /
 *   stop.sh 按 owner_session 精确匹配 / devloop-check 状态机）被破坏，CI 都不会发现，
 *   只能等到下一次交互 /dev 翻车才暴露。
 *
 * 本 test 用 vitest + execSync 驱动真实 bash 脚本（不起 claude CLI），
 * 覆盖 6 个关键场景作为 regression baseline。
 */

const PROJECT_ROOT = resolve(__dirname, '../../../../');
const LAUNCHER = join(PROJECT_ROOT, 'scripts/claude-launch.sh');
const STOP_SH = join(PROJECT_ROOT, 'hooks/stop.sh');
const WORKTREE_MANAGE = join(
  PROJECT_ROOT,
  'packages/engine/skills/dev/scripts/worktree-manage.sh',
);
const DEVLOOP_CHECK = join(PROJECT_ROOT, 'packages/engine/lib/devloop-check.sh');

describe('Phase 7.4 /dev 7 棒接力链 E2E regression', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'phase74-e2e-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ==========================================================================
  // Scenario 1 — claude-launch 链路
  //   CLAUDE_SESSION_ID=fixed-uuid → exec claude 时 env + --session-id 都传递
  //   破坏点：scripts/claude-launch.sh
  // ==========================================================================
  it('[S1] claude-launch.sh 透传 CLAUDE_SESSION_ID env + --session-id flag', () => {
    const mockDir = join(tmpRoot, 'mock-bin');
    mkdirSync(mockDir, { recursive: true });
    // mock claude — dump env CLAUDE_SESSION_ID + 参数
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(
      mockClaude,
      `#!/usr/bin/env bash
echo "CLAUDE_SESSION_ID_ENV=\${CLAUDE_SESSION_ID:-<empty>}"
echo "ARGS=$*"
`,
    );
    chmodSync(mockClaude, 0o755);

    const out = execSync(`bash "${LAUNCHER}" --help`, {
      shell: '/bin/bash',
      env: {
        ...process.env,
        PATH: `${mockDir}:${process.env.PATH}`,
        CLAUDE_SESSION_ID: 'phase74-s1-fixed-uuid',
      },
    }).toString();

    // 断言 1：env 被 export 给 mock claude
    expect(out).toContain('CLAUDE_SESSION_ID_ENV=phase74-s1-fixed-uuid');
    // 断言 2：--session-id <uuid> 作为参数传递
    expect(out).toContain('--session-id phase74-s1-fixed-uuid');
    // 断言 3：额外参数透传（--help）
    expect(out).toContain('--help');
  });

  // ==========================================================================
  // Scenario 2 — worktree-manage 按 env 写 owner_session
  //   CLAUDE_SESSION_ID 在环境里 → cmd_create 写入 .dev-lock.* 的 owner_session
  //   破坏点：worktree-manage.sh::_resolve_claude_session_id（Phase 7.1 加的 env 优先分支）
  // ==========================================================================
  it('[S2] worktree-manage cmd_create 把 CLAUDE_SESSION_ID 写进 .dev-lock owner_session', () => {
    // 临时 git repo
    const repo = join(tmpRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    execSync(`git init -q -b main "${repo}"`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" commit --allow-empty -qm init`, { stdio: 'pipe' });

    // WORKTREE_BASE 指向 tmpRoot 下一个独立目录，避免污染真实 ~/worktrees
    const worktreeBase = join(tmpRoot, 'wts');
    mkdirSync(worktreeBase, { recursive: true });

    const envSessionId = 'phase74-s2-env-uuid';
    const out = execSync(
      `cd "${repo}" && bash "${WORKTREE_MANAGE}" create phase74-s2-task 2>&1`,
      {
        shell: '/bin/bash',
        env: {
          ...process.env,
          CLAUDE_SESSION_ID: envSessionId,
          WORKTREE_BASE: worktreeBase,
          // 覆盖 HOME 以防 _resolve fallback 读主机 env var 干扰
          HOME: tmpRoot,
        },
      },
    ).toString();

    // 最后一行是 worktree_path（stdout，非 stderr）
    const lines = out.split('\n').filter(Boolean);
    const worktreePath = lines[lines.length - 1];
    expect(worktreePath).toContain(worktreeBase);
    expect(existsSync(worktreePath)).toBe(true);

    // 找 .dev-lock.<branch>
    const lockFiles = execSync(
      `ls "${worktreePath}"/.dev-lock.* 2>/dev/null || true`,
      { shell: '/bin/bash' },
    )
      .toString()
      .split('\n')
      .filter(Boolean);
    expect(lockFiles.length).toBeGreaterThan(0);

    const lockContent = readFileSync(lockFiles[0], 'utf8');
    // 关键断言：owner_session 等于传入的 env var
    expect(lockContent).toContain(`owner_session: ${envSessionId}`);

    // 清理 worktree（释放 git 引用）
    try {
      execSync(`git -C "${repo}" worktree remove --force "${worktreePath}"`, {
        stdio: 'pipe',
      });
    } catch {
      /* ignore */
    }
  });

  // ==========================================================================
  // Scenario 3 — DEPRECATED（v19.0.0 cwd-as-key 起废止）
  //   老行为"stop.sh 按 owner_session 精确匹配路由"已于 v19.0.0 删除。
  //   替代防线：packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts
  //   场景 10（交互模式 session 空仍按 cwd 守住）。
  // ==========================================================================
  it.skip('[S3 DEPRECATED] stop.sh 按 owner_session 精确路由（v19 已废止）', () => {
    // 临时 git repo + 2 worktree
    const repo = join(tmpRoot, 'repo-s3');
    mkdirSync(repo, { recursive: true });
    execSync(`git init -q -b main "${repo}"`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" commit --allow-empty -qm init`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" worktree add -q "${repo}/wt-A" -b cp-s3-wtA`, {
      stdio: 'pipe',
    });
    execSync(`git -C "${repo}" worktree add -q "${repo}/wt-B" -b cp-s3-wtB`, {
      stdio: 'pipe',
    });
    writeFileSync(
      join(repo, 'wt-A', '.dev-lock.cp-s3-wtA'),
      'dev\nbranch: cp-s3-wtA\nsession_id: headed-a\nowner_session: uuid-A\ntty: none\n',
    );
    writeFileSync(
      join(repo, 'wt-B', '.dev-lock.cp-s3-wtB'),
      'dev\nbranch: cp-s3-wtB\nsession_id: headed-b\nowner_session: uuid-B\ntty: none\n',
    );

    // 装一份本地 stop.sh 副本 + fake stop-dev.sh 用来验证路由
    const hookDir = join(repo, 'hooks-local');
    mkdirSync(hookDir, { recursive: true });
    const realStopSh = readFileSync(STOP_SH, 'utf8');
    writeFileSync(join(hookDir, 'stop.sh'), realStopSh);
    chmodSync(join(hookDir, 'stop.sh'), 0o755);
    writeFileSync(
      join(hookDir, 'stop-dev.sh'),
      `#!/usr/bin/env bash
echo "ROUTED_TO_STOP_DEV"
echo "SID=\${CLAUDE_HOOK_SESSION_ID:-}"
exit 0
`,
    );
    chmodSync(join(hookDir, 'stop-dev.sh'), 0o755);

    const runWithSession = (sid: string) => {
      const stdin = JSON.stringify({
        session_id: sid,
        transcript_path: '/tmp/x',
        cwd: repo,
        hook_event_name: 'Stop',
        stop_hook_active: false,
      });
      try {
        const stdout = execSync(`bash "${join(hookDir, 'stop.sh')}" 2>&1`, {
          cwd: repo,
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_HOOK_STDIN_JSON_OVERRIDE: stdin },
        });
        return { exitCode: 0, stdout };
      } catch (e: any) {
        return { exitCode: e.status ?? -1, stdout: e.stdout?.toString() || '' };
      }
    };

    const resA = runWithSession('uuid-A');
    expect(resA.exitCode).toBe(0);
    expect(resA.stdout).toContain('ROUTED_TO_STOP_DEV');
    expect(resA.stdout).toContain('SID=uuid-A');

    const resB = runWithSession('uuid-B');
    expect(resB.exitCode).toBe(0);
    expect(resB.stdout).toContain('ROUTED_TO_STOP_DEV');
    expect(resB.stdout).toContain('SID=uuid-B');

    const resUnknown = runWithSession('uuid-DOES-NOT-MATCH-ANY');
    expect(resUnknown.exitCode).toBe(0);
    // 关键断言：session_id 不匹配 → exit 0，不路由到 stop-dev.sh
    expect(resUnknown.stdout).not.toContain('ROUTED_TO_STOP_DEV');
  });

  // ==========================================================================
  // Scenario 4 — stop.sh 空数组 guard（Phase 7.2 回归）
  //   非 git 目录 → git worktree list 返回空 → _STOP_HOOK_WT_LIST 空数组
  //   bash 3.2 + set -u 下 "${arr[@]}" 会炸 unbound variable，
  //   Phase 7.2 用 "${arr[@]+${arr[@]}}" guard 修了。
  // ==========================================================================
  it('[S4] stop.sh 在无 git / 无 worktree 场景下不抛 unbound variable (Phase 7.2 回归)', () => {
    const empty = join(tmpRoot, 'empty');
    mkdirSync(empty, { recursive: true });

    const stdinJSON = JSON.stringify({
      session_id: 'phase74-s4-sid',
      transcript_path: '',
      cwd: empty,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });
    const out = execSync(
      `cd "${empty}" && bash "${STOP_SH}" 2>&1; echo "EXIT=$?"`,
      {
        shell: '/bin/bash',
        env: { ...process.env, CLAUDE_HOOK_STDIN_JSON_OVERRIDE: stdinJSON },
      },
    ).toString();

    expect(out).not.toContain('unbound variable');
    expect(out).not.toContain('_STOP_HOOK_WT_LIST[@]');
    expect(out).toContain('EXIT=0');
  });

  // ==========================================================================
  // Scenario 5 — devloop-check 状态机：CI 失败 → blocked
  //   source devloop-check.sh，mock PATH 里的 gh（返回 open PR + 失败的 CI run），
  //   断言 devloop_check 输出 status=blocked + reason 含「CI 失败」。
  //   破坏点：packages/engine/lib/devloop-check.sh 条件 4
  // ==========================================================================
  it('[S5] devloop_check CI 失败 → 输出 blocked + reason 含「CI 失败」', () => {
    const repo = join(tmpRoot, 'repo-s5');
    mkdirSync(repo, { recursive: true });
    execSync(`git init -q -b main "${repo}"`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" commit --allow-empty -qm init`, { stdio: 'pipe' });

    const branch = 'cp-s5-ci-fail';
    execSync(`git -C "${repo}" checkout -q -b "${branch}"`, { stdio: 'pipe' });

    const devModeFile = join(repo, `.dev-mode.${branch}`);
    writeFileSync(
      devModeFile,
      [
        'dev',
        `branch: ${branch}`,
        'step_1_spec: done',
        'step_2_code: done',
        `started: ${new Date().toISOString().replace(/\.\d+Z$/, '+08:00')}`,
      ].join('\n') + '\n',
    );

    // Mock gh — 根据第一个参数分派
    const mockDir = join(tmpRoot, 'mock-bin-s5');
    mkdirSync(mockDir, { recursive: true });
    const mockGh = join(mockDir, 'gh');
    writeFileSync(
      mockGh,
      `#!/usr/bin/env bash
# Mock gh for devloop_check Scenario 5 (CI failed)
case "$1" in
  pr)
    # gh pr list --head ... --state open  → 返回 [{number:42}]
    # gh pr list --head ... --state merged → 返回 []
    if [[ "$*" == *"--state open"* ]]; then
      echo "42"
      exit 0
    fi
    if [[ "$*" == *"--state merged"* ]]; then
      echo ""
      exit 0
    fi
    # gh pr view 42 --json mergeable,state -q {...}
    if [[ "$2" == "view" ]]; then
      echo '{"m":"MERGEABLE","s":"OPEN"}'
      exit 0
    fi
    echo ""
    exit 0
    ;;
  run)
    # gh run list --branch ... --limit 1 --json status,conclusion,databaseId
    echo '[{"status":"completed","conclusion":"failure","databaseId":9999}]'
    exit 0
    ;;
  *)
    echo ""
    exit 0
    ;;
esac
`,
    );
    chmodSync(mockGh, 0o755);

    const bashScript = `
set -euo pipefail
export PATH="${mockDir}:$PATH"
cd "${repo}"
source "${DEVLOOP_CHECK}"
devloop_check "${branch}" "${devModeFile}" || true
`;
    const out = execSync(`bash -c '${bashScript.replace(/'/g, `'"'"'`)}'`, {
      shell: '/bin/bash',
      env: { ...process.env },
    }).toString();

    // JSON 输出应含 status=blocked + reason 提到 "CI 失败"
    // jq 格式化会加空格/换行，用 regex 宽松匹配
    expect(out).toMatch(/"status":\s*"blocked"/);
    expect(out).toContain('CI 失败');
  });

  // ==========================================================================
  // Scenario 6 — devloop-check 状态机：cleanup_done → done
  //   .dev-mode 含 cleanup_done: true → 唯一出口直接 done（非 harness 模式）
  //   破坏点：devloop-check.sh 条件 0.1
  // ==========================================================================
  it('[S6] devloop_check 读到 cleanup_done: true → 输出 status=done', () => {
    const repo = join(tmpRoot, 'repo-s6');
    mkdirSync(repo, { recursive: true });
    execSync(`git init -q -b main "${repo}"`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${repo}" commit --allow-empty -qm init`, { stdio: 'pipe' });

    const branch = 'cp-s6-done';
    execSync(`git -C "${repo}" checkout -q -b "${branch}"`, { stdio: 'pipe' });

    const devModeFile = join(repo, `.dev-mode.${branch}`);
    writeFileSync(
      devModeFile,
      [
        'dev',
        `branch: ${branch}`,
        'step_1_spec: done',
        'step_2_code: done',
        'step_4_ship: done',
        'cleanup_done: true',
      ].join('\n') + '\n',
    );

    const bashScript = `
set -euo pipefail
cd "${repo}"
source "${DEVLOOP_CHECK}"
devloop_check "${branch}" "${devModeFile}" || true
`;
    const out = execSync(`bash -c '${bashScript.replace(/'/g, `'"'"'`)}'`, {
      shell: '/bin/bash',
      env: { ...process.env },
    }).toString();

    expect(out).toMatch(/"status":\s*"done"/);
    expect(out).not.toMatch(/"status":\s*"blocked"/);
  });
});
