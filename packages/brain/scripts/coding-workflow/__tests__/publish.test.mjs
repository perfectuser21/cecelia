import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { git, gitPlain } from './helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/publish.mjs');
const FAKE_GH = path.join(HERE, 'fixtures/fake-gh.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const TITLE = 'docs(sprint): 11111111 md 链 01-intent → 02-spec';

describe('publish 活动（临时裸仓 + 假 gh）', () => {
  let root;
  let origin;
  let worktree;
  let ghLog;

  beforeAll(() => {
    fs.chmodSync(FAKE_GH, 0o755);
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
    origin = path.join(root, 'origin.git');
    worktree = path.join(root, 'wt');
    ghLog = path.join(root, 'gh.log');
    gitPlain('init', '--bare', '-b', 'main', origin);
    gitPlain('clone', origin, worktree);
    git(worktree, 'config', 'user.name', 'Test');
    git(worktree, 'config', 'user.email', 'test@example.com');
    fs.writeFileSync(path.join(worktree, 'README.md'), 'hi\n');
    git(worktree, 'add', '--', 'README.md');
    git(worktree, 'commit', '-m', 'init');
    git(worktree, 'push', '-u', 'origin', 'main');
    git(worktree, 'checkout', '-b', 'cp-1007000000-test');
    fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '# intent\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/02-spec.md'), '# spec\n');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    chain_files: ['01-intent.md', '02-spec.md'],
    ...patch,
  });
  const run = (mode, patch, extraEnv = {}) =>
    runActivityProcess(ENTRY, input(patch), {
      CODING_WF_GH_BIN: FAKE_GH,
      FAKE_GH_MODE: mode,
      FAKE_GH_LOG: ghLog,
      ...extraEnv,
    });
  const ghCalls = () =>
    fs.existsSync(ghLog)
      ? fs.readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];

  it('new：提交并推送分支，开草稿 PR，输出新 URL 与分支', async () => {
    const r = await run('new');
    expect(r.exitCode).toBe(0);
    expect(r.result.failure_class).toBeNull();
    expect(r.result.outputs).toEqual({ pr_url: 'https://github.com/example/repo/pull/2', branch: 'cp-1007000000-test' });
    expect(r.stdout.trim().split('\n')).toHaveLength(1);

    const files = git(origin, 'ls-tree', '-r', '--name-only', 'cp-1007000000-test').trim().split('\n');
    expect(files).toContain('sprints/s1/01-intent.md');
    expect(files).toContain('sprints/s1/02-spec.md');
    expect(git(origin, 'log', '-1', '--format=%s', 'cp-1007000000-test').trim()).toBe(TITLE);

    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    expect(create).toBeDefined();
    expect(create).toContain('--draft');
    expect(create[create.indexOf('--head') + 1]).toBe('cp-1007000000-test');
    expect(create[create.indexOf('--title') + 1]).toBe(TITLE);
    const body = create[create.indexOf('--body') + 1];
    expect(body).toContain('- sprints/s1/01-intent.md');
    expect(body).toContain('- sprints/s1/02-spec.md');
  });

  it('四文件链 + verified_ids：含代码提交时标题为 feat(workflow): <01-intent 标题>，PR 正文追加每条 I-n 的验收摘要', async () => {
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '---\ntask_id: x\nstep: intent\nupstream: []\n---\n# 登录功能  \n\n### I-1\n能登录\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/03-build.md'), '# build\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/04-evidence.md'), '# evidence\n');
    const r = await run('new', {
      chain_files: ['01-intent.md', '02-spec.md', '03-build.md', '04-evidence.md'],
      evidence_file: '04-evidence.md',
      verified_ids: ['I-1', 'I-2'],
    });
    expect(r.exitCode, r.stderr).toBe(0);
    const title = 'feat(workflow): 登录功能';
    expect(git(origin, 'log', '-1', '--format=%s', 'cp-1007000000-test').trim()).toBe(title);
    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    expect(create[create.indexOf('--title') + 1]).toBe(title);
    const body = create[create.indexOf('--body') + 1];
    expect(body).toContain('- sprints/s1/04-evidence.md');
    expect(body).toContain('## 验收摘要（sprints/s1/04-evidence.md）');
    expect(body).toContain('- I-1：PASS');
    expect(body).toContain('- I-2：PASS');
  });

  it.each(['修复登录超时', 'fix crash on start', 'Bug: 退出按钮无效', 'FIX 空指针'])(
    '含代码提交且 01-intent 标题以 bug/修复/fix 开头（%s）-> fix(workflow):',
    async (heading) => {
      fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), `# ${heading}\n\n### I-1\nx\n`);
      fs.writeFileSync(path.join(worktree, 'sprints/s1/03-build.md'), '# build\n');
      const r = await run('new', { chain_files: ['01-intent.md', '02-spec.md', '03-build.md'] });
      expect(r.exitCode, r.stderr).toBe(0);
      const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
      expect(create[create.indexOf('--title') + 1]).toBe(`fix(workflow): ${heading}`);
    },
  );

  it('含代码提交但 01-intent 没有 # 标题 -> feat(workflow): coding workflow <task_id 前 8 位>', async () => {
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '### I-1\nx\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/03-build.md'), '# build\n');
    const r = await run('new', { chain_files: ['01-intent.md', '02-spec.md', '03-build.md'] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(git(origin, 'log', '-1', '--format=%s', 'cp-1007000000-test').trim()).toBe('feat(workflow): coding workflow 11111111');
  });

  it('上下文没有 verified_ids：PR 正文不带验收摘要', async () => {
    const r = await run('new', { verified_ids: 'I-1' });
    expect(r.exitCode).toBe(0);
    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    expect(create[create.indexOf('--body') + 1]).not.toContain('验收摘要');
  });

  const REVIEW_V2 = [
    '---', 'task_id: x', 'step: spec_review', 'upstream: ["02-spec.md#S-1"]', '---', '# 规格评审', '',
    '## 评分', '意图对齐: 8', '可验证: 7', '场景覆盖: 9', '回归风险: 7', '可执行: 8', '',
    '### R-3', '针对: S-1', '严重度: 建议', 'R-3 第一行说明', 'R-3 第二行细节', '',
    '### R-4', '针对: I-1, S-2', '严重度: 重要', '场景: 用户重复提交', '依据: x.mjs', 'R-4 唯一一行', '',
  ].join('\n');
  const reviewCtx = (gan) => ({
    chain_files: ['01-intent.md', '02-spec.md', '02-review.md'],
    review_file: '02-review.md',
    review_rounds: gan.rounds,
    gan,
  });
  const prBody = () => {
    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    return create[create.indexOf('--body') + 1];
  };

  it('有 review_file：PR 正文含合同对抗小节（轮数、结论与走势、最终评分、末轮每条问题的严重度与首行）', async () => {
    fs.writeFileSync(path.join(worktree, 'sprints/s1/02-review.md'), REVIEW_V2);
    const r = await run('new', reviewCtx({ verdict: 'APPROVED', rounds: 2, trend: 'insufficient_data', open_issues: [], cost_usd: 1.2 }));
    expect(r.exitCode, r.stderr).toBe(0);
    const body = prBody();
    expect(body).toContain('## 合同对抗（sprints/s1/02-review.md）');
    expect(body).toContain('- 轮数：2');
    expect(body).toContain('- 结论：APPROVED（走势 insufficient_data，花费 $1.2）');
    expect(body).toContain('- 最终评分：意图对齐 8 / 可验证 7 / 场景覆盖 9 / 回归风险 7 / 可执行 8');
    expect(body).toContain('- R-3［建议］（针对 S-1）：R-3 第一行说明');
    expect(body).not.toContain('R-3 第二行细节');
    expect(body).toContain('- R-4［重要］（针对 I-1、S-2）：R-4 唯一一行');
    expect(body).not.toContain('强制通过');
  });

  it('强制通过（FORCED）：PR 正文醒目标出仍开着的问题', async () => {
    fs.writeFileSync(path.join(worktree, 'sprints/s1/02-review.md'), REVIEW_V2);
    const r = await run('new', reviewCtx({ verdict: 'FORCED', rounds: 3, trend: 'oscillating', open_issues: [{ id: 'R-1', severity: '阻断', targets: ['S-1'] }], cost_usd: 3 }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(prBody()).toContain('- ⚠️ 强制通过（走势 oscillating），仍开着：R-1［阻断］');
  });

  // 审计 #10：02 的「未覆盖真实链路」原样转呈 PR 正文，主理人一眼看到哪些没真验
  it('02 有「## 未覆盖真实链路」→ PR 正文原样转呈；没有这一段 → 不出现', async () => {
    fs.writeFileSync(path.join(worktree, 'sprints/s1/02-spec.md'), '# spec\n\n## 未覆盖真实链路\n\n- 飞书推送：预览环境无凭据，只验到落库\n');
    let r = await run('new');
    expect(r.exitCode, r.stderr).toBe(0);
    expect(prBody()).toContain('## 未覆盖真实链路（sprints/s1/02-spec.md）\n- 飞书推送：预览环境无凭据，只验到落库');
  });

  it('无 review_file：PR 正文不带规格评审小节', async () => {
    const r = await run('new');
    expect(r.exitCode).toBe(0);
    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    expect(create[create.indexOf('--body') + 1]).not.toContain('规格评审');
  });

  it('existing：复用已有 PR，不再 pr create', async () => {
    const r = await run('existing');
    expect(r.exitCode).toBe(0);
    expect(r.result.outputs).toEqual({ pr_url: 'https://github.com/example/repo/pull/1', branch: 'cp-1007000000-test' });
    expect(ghCalls().some((a) => a[1] === 'create')).toBe(false);
  });

  it('无改动再跑一次：不新增 commit，仍 completed', async () => {
    const first = await run('new');
    expect(first.exitCode).toBe(0);
    const before = git(worktree, 'rev-parse', 'HEAD').trim();
    const second = await run('existing');
    expect(second.exitCode).toBe(0);
    expect(second.result.failure_class).toBeNull();
    expect(git(worktree, 'rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('gh 鉴权失败 -> needs_human gh_auth', async () => {
    const r = await run('auth');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('gh_auth');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('push 失败（origin 不可用）-> retryable push_failed', async () => {
    git(worktree, 'remote', 'set-url', 'origin', path.join(root, 'no-such.git'));
    const r = await run('new');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('push_failed');
  });

  it('分支为 main -> fatal branch_invalid，且未暂存任何文件', async () => {
    git(worktree, 'checkout', 'main');
    const r = await run('new');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('branch_invalid');
    expect(git(worktree, 'status', '--porcelain')).toContain('?? sprints/');
    expect(() => git(origin, 'rev-parse', '--verify', 'refs/heads/main')).not.toThrow();
    expect(() => git(origin, 'rev-parse', '--verify', 'refs/heads/cp-1007000000-test')).toThrow();
    expect(ghCalls()).toHaveLength(0);
  });

  it('gh 非鉴权类失败（网络超时）-> retryable gh_failed', async () => {
    const r = await run('branchfail');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('gh_failed');
  });

  it('只提交 sprint_dir：目录外的未跟踪文件与已暂存文件不进 origin 分支', async () => {
    fs.writeFileSync(path.join(worktree, 'extra.txt'), 'untracked\n');
    fs.writeFileSync(path.join(worktree, 'staged.txt'), 'staged\n');
    git(worktree, 'add', '--', 'staged.txt');
    const r = await run('new');
    expect(r.exitCode).toBe(0);
    const files = git(origin, 'ls-tree', '-r', '--name-only', 'cp-1007000000-test').trim().split('\n');
    expect(files).toContain('sprints/s1/01-intent.md');
    expect(files).not.toContain('extra.txt');
    expect(files).not.toContain('staged.txt');
  });

  it.each(['.', './', ':/', ':(top)'])('sprint_dir=%s 不能扩大提交范围', async (bad) => {
    fs.writeFileSync(path.join(worktree, 'extra.txt'), 'untracked\n');
    const r = await run('new', { sprint_dir: bad });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(() => git(origin, 'rev-parse', '--verify', 'refs/heads/cp-1007000000-test')).toThrow();
    expect(git(worktree, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
  });

  it('sprint_dir 非法 -> fatal sprint_dir_invalid，不碰 git/gh', async () => {
    const r = await run('new', { sprint_dir: 'a/../../b' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('sprint_dir_invalid');
    expect(git(worktree, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect(ghCalls()).toHaveLength(0);
  });

  it('task_id 与 sprint_dir 同时非法 -> 先报 task_id_missing', async () => {
    const r = await run('new', { task_id: '', sprint_dir: 'a/../../b' });
    expect(r.result.reason_code).toBe('task_id_missing');
    expect(ghCalls()).toHaveLength(0);
  });

  it('继承的 GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE 不影响提交（子进程已剥离）', async () => {
    const r = await run('new', {}, {
      GIT_DIR: path.join(root, 'bogus.git'),
      GIT_WORK_TREE: path.join(root, 'bogus-wt'),
      GIT_INDEX_FILE: path.join(root, 'bogus-index'),
    });
    expect(r.exitCode).toBe(0);
    const files = git(origin, 'ls-tree', '-r', '--name-only', 'cp-1007000000-test').trim().split('\n');
    expect(files).toContain('sprints/s1/01-intent.md');
  });

  it.each(['cp-test', 'cp-123-x', 'cp-1007000000-', 'cp-1007000000-Upper', 'feature/x', 'cp-12345678901-x'])(
    '分支名 %s 与全局 pre-commit 钩子正则不一致 -> fatal branch_invalid',
    async (name) => {
      git(worktree, 'checkout', '-b', name);
      const r = await run('new');
      expect(r.exitCode).toBe(2);
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('branch_invalid');
      expect(ghCalls()).toHaveLength(0);
    },
  );

  it('分支名 cp-<8位时间戳>-name 合规 -> 通过', async () => {
    git(worktree, 'checkout', '-b', 'cp-10071451-fix_x-1');
    const r = await run('new');
    expect(r.exitCode).toBe(0);
    expect(r.result.outputs.branch).toBe('cp-10071451-fix_x-1');
  });

  it('commit 失败 -> fatal git_commit_failed，evidence 带 stderr 尾部（最多 20 行）', async () => {
    const hooks = path.join(worktree, '.git/hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(
      path.join(hooks, 'pre-commit'),
      '#!/bin/sh\ni=1\nwhile [ $i -le 30 ]; do echo "hook line $i" >&2; i=$((i+1)); done\nexit 1\n',
    );
    fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755);
    git(worktree, 'config', 'core.hooksPath', hooks);
    const r = await run('new');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('git_commit_failed');
    const tail = r.result.evidence[0].stderr_tail;
    expect(tail).toHaveLength(20);
    expect(tail[tail.length - 1]).toBe('hook line 30');
    expect(tail[0]).toBe('hook line 11');
  });

  // 改了 packages/brain/src 的 PR 必须带 changes/<分支>.md 版本碎片（scripts/ci/check-brain-version-bump.sh，
  // 约定见 changes/README.md：PR 不碰版本五件套），否则 brain-version-bump-gate 必红（4ac5fa39 首跑实证）
  const BUILD_CHAIN = { chain_files: ['01-intent.md', '02-spec.md', '03-build.md'] };
  const FRAG = 'changes/cp-1007000000-test.md';
  const branchFiles = () => git(origin, 'ls-tree', '-r', '--name-only', 'cp-1007000000-test').trim().split('\n');
  const commitSrc = () => {
    fs.mkdirSync(path.join(worktree, 'packages/brain/src/routes'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'packages/brain/src/routes/x.js'), 'export const x = 1;\n');
    git(worktree, 'add', '--', 'packages');
    git(worktree, 'commit', '-m', 'fix(brain): x');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '# 修复 Brain 非法 id 返回 500\n\n### I-1\n非法 id 返回 400\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/03-build.md'), '# build\n');
  };

  it('改了 packages/brain/src 且没有碎片 → 自动写 changes/<分支>.md（{VERSION} 占位 + 需求标题），随 sprint 一起提交', async () => {
    commitSrc();
    const r = await run('new', BUILD_CHAIN);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(branchFiles()).toContain(FRAG);
    const frag = git(origin, 'show', `cp-1007000000-test:${FRAG}`);
    expect(frag).toMatch(/^## Brain \{VERSION\} — 修复 Brain 非法 id 返回 500\n/);
    expect(frag).toContain(TASK_ID.slice(0, 8));
    expect(frag).toContain('sprints/s1');
    expect(git(origin, 'show', '--name-only', '--format=', 'cp-1007000000-test').trim().split('\n')).toContain(FRAG);
  });

  it('分支上已带碎片 → 不再写', async () => {
    commitSrc();
    fs.mkdirSync(path.join(worktree, 'changes'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'changes/own.md'), '## Brain {VERSION} — own\n');
    git(worktree, 'add', '--', 'changes');
    git(worktree, 'commit', '-m', 'docs: frag');
    const r = await run('new', BUILD_CHAIN);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(branchFiles()).not.toContain(FRAG);
    expect(branchFiles()).toContain('changes/own.md');
  });

  it('没改 packages/brain/src → 不写碎片', async () => {
    const r = await run('new');
    expect(r.exitCode, r.stderr).toBe(0);
    expect(branchFiles()).not.toContain(FRAG);
  });
});
