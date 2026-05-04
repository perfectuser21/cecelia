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

// Ralph Loop 模式（v21.0.0+）helper
function setupRalphDevSession(repo: string, branch: string, worktreePath?: string) {
  const wt = worktreePath || repo;
  mkdirSync(join(repo, '.cecelia'), { recursive: true });
  writeFileSync(
    join(repo, '.cecelia', `dev-active-${branch}.json`),
    JSON.stringify({ branch, worktree: wt, started_at: '2026-05-04T00:00:00Z', session_id: 'test' }, null, 2),
  );
}

function setupMockCleanup(repo: string, exitCode: number) {
  const dir = join(repo, 'packages/engine/skills/dev/scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cleanup.sh'), `#!/usr/bin/env bash\nexit ${exitCode}\n`);
  chmodSync(join(dir, 'cleanup.sh'), 0o755);
}

function setupLearning(repo: string, branch: string, content: string) {
  const dir = join(repo, 'docs/learnings');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${branch}.md`), content);
}

const STOP_DEV = resolve(__dirname, '../../hooks/stop-dev.sh');

function setupDevloopLib(repo: string) {
  const libDir = join(repo, 'packages/engine/lib');
  const realLib = resolve(__dirname, '../../lib/devloop-check.sh');
  mkdirSync(libDir, { recursive: true });
  execSync(`cp "${realLib}" "${libDir}/devloop-check.sh"`);
}

function runStopDev(opts: { cwd: string; hookCwd?: string; ghStub?: string; env?: Record<string, string> }): RunResult {
  let envPath = process.env.PATH ?? '';
  if (opts.ghStub) {
    const stubDir = mkdtempSync(join(tmpdir(), 'gh-stub-'));
    stubDirs.push(stubDir);
    const ghPath = join(stubDir, 'gh');
    writeFileSync(ghPath, `#!/usr/bin/env bash\n${opts.ghStub}\n`);
    chmodSync(ghPath, 0o755);
    envPath = `${stubDir}:${envPath}`;
  }
  const res = spawnSync('bash', [STOP_DEV], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      CLAUDE_HOOK_CWD: opts.hookCwd ?? opts.cwd,
      ...(opts.env ?? {}),
      PATH: envPath,
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

describe('Stop Hook Full Lifecycle — Ralph 模式 12 场景 E2E (v21.0.0+)', () => {
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

  // ============ 放行场景（无 dev 流程） ============

  it('场景 1: 无 .cecelia/dev-active → exit 0 普通对话放行', () => {
    const r = runStopDev({ cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('"decision"');
  });

  it('场景 2: bypass env → exit 0', () => {
    setupRalphDevSession(repo, 'cp-test');
    const r = runStopDev({ cwd: repo, env: { CECELIA_STOP_HOOK_BYPASS: '1' } });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('"decision"');
  });

  it('场景 3: .cecelia 存在 + PR 未创建 → block', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    const r = runStopDev({ cwd: repo, ghStub: 'echo ""\nexit 0' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
    expect(r.stdout).toMatch(/PR 未创建/);
  });

  it('场景 4: PR + CI in_progress → block', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    const ghStub = `
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "" ;;
    "run list") echo "in_progress" ;;
esac
exit 0
`;
    const r = runStopDev({ cwd: repo, ghStub });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
    expect(r.stdout).toMatch(/CI 进行中/);
  });

  it('场景 5: PR + CI completed but not merged → block + 提示 auto-merge', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    const ghStub = `
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "" ;;
    "run list") echo "completed" ;;
esac
exit 0
`;
    const r = runStopDev({ cwd: repo, ghStub });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
    expect(r.stdout).toMatch(/auto-merge/);
  });

  it('场景 6: PR merged + Learning 不存在 → block', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    const ghStub = `
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
`;
    const r = runStopDev({ cwd: repo, ghStub });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
    expect(r.stdout).toMatch(/Learning 文件不存在/);
  });

  it('场景 7: PR merged + Learning 缺 ### 根本原因 → block', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    setupLearning(repo, 'cp-test', '# 空 Learning\n没有根本原因段\n');
    const ghStub = `
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
`;
    const r = runStopDev({ cwd: repo, ghStub });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
    expect(r.stdout).toMatch(/缺必备段/);
  });

  it('场景 8: PR merged + Learning OK + cleanup.sh 不存在 → block', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    setupLearning(repo, 'cp-test', '# Learning\n### 根本原因\nfoo\n');
    const ghStub = `
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
`;
    const r = runStopDev({ cwd: repo, ghStub, env: { HOME: '/nonexistent-home' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
    expect(r.stdout).toMatch(/未找到 cleanup\.sh/);
  });

  it('场景 9: PR merged + Learning OK + cleanup fail → block', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    setupLearning(repo, 'cp-test', '# Learning\n### 根本原因\nfoo\n');
    setupMockCleanup(repo, 1);
    const ghStub = `
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
`;
    const r = runStopDev({ cwd: repo, ghStub });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
    expect(r.stdout).toMatch(/cleanup\.sh 执行失败/);
  });

  it('场景 10 [HAPPY PATH]: PR merged + Learning + cleanup ok → done + rm 状态文件', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    setupLearning(repo, 'cp-test', '# Learning\n### 根本原因\nfoo\n### 下次预防\n- [ ] x\n');
    setupMockCleanup(repo, 0);
    const stateFile = join(repo, '.cecelia', 'dev-active-cp-test.json');
    expect(existsSync(stateFile)).toBe(true);
    const ghStub = `
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
`;
    const r = runStopDev({ cwd: repo, ghStub });
    expect(r.status).toBe(0);
    // done 路径：stdout 静默不输出 decision JSON（按 Ralph Loop 官方协议）
    // 之前自创 decision:"allow" 违反 Claude Code Stop Hook schema（合法值只有 approve/block）
    expect(r.stdout).not.toContain('"decision"');
    // reason 走 stderr 诊断
    expect(r.stderr).toMatch(/真完成/);
    expect(existsSync(stateFile)).toBe(false);
  });

  it('场景 11 [关键修复]: cwd 漂到主仓库 → 仍 block（cwd 漂移修复）', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test', repo);
    setupDevloopLib(repo);
    const r = runStopDev({ cwd: repo, ghStub: 'echo ""\nexit 0' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
  });

  it('场景 12 [关键修复]: 删 .dev-mode → 仍 block（自删修复）', () => {
    checkoutBranch(repo, 'cp-test');
    setupRalphDevSession(repo, 'cp-test');
    setupDevloopLib(repo);
    writeFileSync(join(repo, '.dev-mode.cp-test'), 'dev\n');
    rmSync(join(repo, '.dev-mode.cp-test'));
    const r = runStopDev({ cwd: repo, ghStub: 'echo ""\nexit 0' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
  });

  // ============ 7 阶段重设计新场景（P3/P5/P6） ============
  // 注：以下 3 场景断言 verify_dev_complete 7 阶段重写后的行为。
  // 现有 `makeStubGhEnv` helper 不支持 failedJobs/deployRuns/healthEndpoint
  // 字段，先 skip 留 placeholder，等 stub 扩展后再开（详见 plan Task 1 Step 2）。

  it.skip('场景 13: P3 CI 失败 → block + 反馈含 fail job 名 + log URL', () => {
    // ghStub 模拟 gh run list/view 返回 failure + jobs + log url
    // 预期 verify_dev_complete P3 分支命中，反馈 'CI 失败' + fail job 名 + URL
  });

  it.skip('场景 14: P5 deploy workflow 进行中 → block + 等 deploy', () => {
    // ghStub 模拟 PR merged + CI success + brain-ci-deploy in_progress
    // 预期 verify_dev_complete P5 分支命中，反馈 brain-ci-deploy.yml
  });

  it.skip('场景 15: P6 health probe 60×5s 超时 → block', () => {
    // 模拟 PR merged + CI success + deploy success + health endpoint dead
    // HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=0
    // 预期 verify_dev_complete P6 分支命中，反馈 'health probe...超时'
  });
});
