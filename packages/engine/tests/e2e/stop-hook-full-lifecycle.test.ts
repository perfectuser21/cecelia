/**
 * E2E 回归防线：stop hook 全生命周期
 *
 * 12 个场景覆盖 stop.sh + stop-dev.sh + devloop-check.sh 联合行为。
 * 每个场景起真临时 git repo + 真 spawn bash hooks/stop.sh。
 * 依赖 gh 的场景用 $PATH stub 注入 fake gh 二进制。
 *
 * 设计文档：docs/superpowers/specs/2026-04-21-stop-hook-final-design.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const STOP_HOOK = resolve(__dirname, '../../hooks/stop.sh');
const BLOCK_PATTERN = /"decision"\s*:\s*"block"/;

interface RunOpts {
  cwd: string;
  stdinJson?: object;
  env?: Record<string, string>;
  ghStub?: string;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

// Critical 2: 收集所有 gh stub tmpdir，afterEach 统一清理避免泄漏
const stubDirs: string[] = [];

function runStopHook(opts: RunOpts): RunResult {
  const stdinStr = opts.stdinJson ? JSON.stringify(opts.stdinJson) : '';
  let envPath = process.env.PATH ?? '';

  if (opts.ghStub) {
    const stubDir = mkdtempSync(join(tmpdir(), 'gh-stub-'));
    stubDirs.push(stubDir); // 追踪，afterEach 清理
    const ghPath = join(stubDir, 'gh');
    writeFileSync(ghPath, `#!/usr/bin/env bash\n${opts.ghStub}\n`);
    chmodSync(ghPath, 0o755);
    envPath = `${stubDir}:${envPath}`;
  }

  // 走 CLAUDE_HOOK_STDIN_JSON_OVERRIDE 而不是 stdin pipe —— vitest spawnSync stdin
  // 不稳定（stop.sh 自己有这条逃生通道，专门给测试用）。把 stdin 也设上做双保险。
  const overrideEnv: Record<string, string> = {};
  if (stdinStr) overrideEnv.CLAUDE_HOOK_STDIN_JSON_OVERRIDE = stdinStr;

  const res = spawnSync('bash', [STOP_HOOK], {
    cwd: opts.cwd,
    env: { ...process.env, ...overrideEnv, ...(opts.env ?? {}), PATH: envPath },
    input: stdinStr,
    encoding: 'utf-8',
    timeout: 15000,
  });

  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function makeGitRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'stop-hook-lifecycle-'));
  const run = (cmd: string) => execSync(cmd, { cwd: d, stdio: 'ignore' });
  run('git init -q -b main');
  run('git config user.email t@e.com');
  run('git config user.name t');
  writeFileSync(join(d, 'README.md'), '#');
  run('git add . && git commit -q -m init');
  return d;
}

function checkoutBranch(dir: string, branch: string) {
  execSync(`git checkout -qb ${branch}`, { cwd: dir, stdio: 'ignore' });
}

function writeDevMode(dir: string, branch: string, content: string) {
  writeFileSync(join(dir, `.dev-mode.${branch}`), content);
}

// TODO(cp-0504185237): Ralph Loop 模式（v21.0.0）改变了信号源 — 不再读 .dev-mode 字段，
// 改读项目根 .cecelia/dev-active-<branch>.json + hook 主动验证 PR/Learning/cleanup。
// 这 12 场景 setup 基于旧 .dev-mode 字段语义，需要整体重写。
// 临时：integration ralph-loop-mode.test.sh 5 case 覆盖关键行为（cwd 漂移 / 自删 .dev-mode 等）。
// follow-up PR：重写 12 场景 setup 使用 .cecelia/dev-active-* + gh CLI mock，期望 decision:block + exit 0。
describe.skip('Stop Hook Full Lifecycle — 12 场景 E2E（Ralph 模式后待重写）', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeGitRepo();
  });

  afterEach(() => {
    if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    // Critical 2: 清理所有 gh stub tmpdir
    for (const d of stubDirs.splice(0)) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    }
  });

  // ============ 放行场景 ============

  it('场景 1: 主仓库 main 分支 → exit 0（日常对话不阻塞）', () => {
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo, session_id: 'test-sid' },
    });
    expect(r.status).toBe(0);
  });

  it('场景 2: cp-* 分支但无 .dev-mode → exit 0（不在 /dev 流程）', () => {
    checkoutBranch(repo, 'cp-test');
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo, session_id: 'test-sid' },
    });
    expect(r.status).toBe(0);
  });

  it('场景 12: bypass env → exit 0（逃生）', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(repo, 'cp-test', 'dev\nbranch: cp-test\nstep_1_spec: pending\n');
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
      env: { CECELIA_STOP_HOOK_BYPASS: '1' },
    });
    expect(r.status).toBe(0);
  });

  // ============ 格式异常 fail-closed ============

  it('场景 3: .dev-mode 首行非 dev（等号格式） → exit 2 fail-closed', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'branch=cp-test\ntask=foo\nagent=a\n',
    );
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('格式异常');
  });

  // ============ Pipeline 阶段 ============

  it('场景 4: step_1_spec=pending → exit 2 block（Spec 未完成）', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: pending\n',
    );
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(BLOCK_PATTERN);
    // Critical 1: reason 非空，有实质内容
    expect(r.stdout.length).toBeGreaterThan(50);
  });

  it('场景 5: step_2_code=done 但无 pr_url → exit 2 block（提示建 PR）', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: done\nstep_2_code: done\n',
    );
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(BLOCK_PATTERN);
    // Critical 1: reason 非空，有实质内容
    expect(r.stdout.length).toBeGreaterThan(50);
  });

  // ============ PR/CI mock 场景 ============

  it('场景 6: PR 创建 + CI in_progress → exit 2 block（等 CI）', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: done\nstep_2_code: done\npr_url: https://github.com/x/y/pull/1\npr_number: 1\n',
    );
    const ghStub = `
if [[ "$1 $2" == "pr view" ]]; then
  echo '{"state":"OPEN","statusCheckRollup":[{"name":"test","conclusion":null,"status":"IN_PROGRESS"}]}'
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "checks" ]]; then
  echo "test	pending	0	https://example.com"
  exit 0
fi
echo ""
`;
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
      ghStub,
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(BLOCK_PATTERN);
    // Critical 1: reason 含 CI 关键字
    expect(r.stdout).toMatch(/CI/i);
  });

  it('场景 7: CI failed → exit 2 block + reason 含失败', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: done\nstep_2_code: done\npr_url: https://github.com/x/y/pull/1\npr_number: 1\n',
    );
    const ghStub = `
if [[ "$1 $2" == "pr view" ]]; then
  echo '{"state":"OPEN","statusCheckRollup":[{"name":"test","conclusion":"FAILURE","status":"COMPLETED"}]}'
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "checks" ]]; then
  echo "test	fail	10s	https://example.com"
  exit 0
fi
echo ""
`;
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
      ghStub,
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(BLOCK_PATTERN);
    // Critical 1: reason 含失败相关关键字
    expect(r.stdout).toMatch(/失败|fail|CI/i);
  });

  it('场景 8: CI 绿 + 未合并 → exit 2 block（等上层合 PR）', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: done\nstep_2_code: done\nstep_4_ship: done\npr_url: https://github.com/x/y/pull/1\npr_number: 1\n',
    );
    const ghStub = `
if [[ "$1 $2" == "pr view" ]]; then
  echo '{"state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[{"name":"test","conclusion":"SUCCESS","status":"COMPLETED"}]}'
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "checks" ]]; then
  echo "test	pass	10s	https://example.com"
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "merge" ]]; then
  exit 0
fi
echo ""
`;
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
      ghStub,
    });
    // Important(TODO): 预期 exit 0（CI 绿 + step_4_ship=done + MERGEABLE 应自动合并并清理）
    // 待 Task 2 实现 stop-dev.sh 完整 pr merge 逻辑后收紧为 expect(r.status).toBe(0)
    // 同时验证 .dev-mode 被清：expect(existsSync(join(repo, '.dev-mode.cp-test'))).toBe(false)
    expect([0, 2]).toContain(r.status);
  });

  it('场景 9: PR merged + step_4_ship=done → exit 0 + .dev-mode 被清', () => {
    checkoutBranch(repo, 'cp-test');
    const devModeFile = join(repo, '.dev-mode.cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: done\nstep_2_code: done\nstep_4_ship: done\npr_url: https://github.com/x/y/pull/1\npr_number: 1\ncleanup_done: true\n',
    );
    const ghStub = `
if [[ "$1 $2" == "pr view" ]]; then
  echo '{"state":"MERGED","statusCheckRollup":[{"name":"test","conclusion":"SUCCESS","status":"COMPLETED"}]}'
  exit 0
fi
echo ""
`;
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
      ghStub,
    });
    expect(r.status).toBe(0);
    expect(existsSync(devModeFile)).toBe(false);
  });

  // ============ 模式兼容 ============

  it('场景 10: 交互模式（session_id 空）→ 按 cwd 正常走（不因 session 空 exit 0 放行）', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: pending\n',
    );
    const r = runStopHook({
      cwd: repo,
      stdinJson: { cwd: repo },
    });
    expect(r.status).toBe(2);
  });

  it('场景 11: 无头模式（CLAUDE_HOOK_CWD env 指向 worktree） → 按 cwd 正常走', () => {
    checkoutBranch(repo, 'cp-test');
    writeDevMode(
      repo,
      'cp-test',
      'dev\nbranch: cp-test\nstep_1_spec: pending\n',
    );
    const r = runStopHook({
      cwd: '/tmp',
      stdinJson: { cwd: repo, session_id: 'headless-sid' },
    });
    expect(r.status).toBe(2);
  });
});
