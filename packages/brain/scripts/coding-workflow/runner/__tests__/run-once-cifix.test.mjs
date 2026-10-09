// run-once.mjs 的 CI 红自动修复：假 Brain、临时 origin 上的 cw PR 分支、假 gh（回放 PR/检查/日志）、假 claude。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { startFakeBrain, codingTask, makeSandbox, runnerEnv, runOnceProcess, readJsonLines } from './helpers/sandbox.mjs';
import { loadConfig } from '../lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GH_CI = path.join(HERE, 'fixtures/fake-gh-ci.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude-cifix.mjs');
const TASK = 'c954ebfd-469f-4006-a95f-b277fa6564f6';
const BRANCH = 'cp-10081835-cw-c954ebfd';
const SPRINT = 'sprints/10081835-cw-c954ebfd';
const JOB_URL = 'https://github.com/perfectuser21/cecelia/actions/runs/1/job/4242';

describe('runner CI 红自动修复（ci_fix）', () => {
  let sb;
  let brain;
  let head;
  const files = {};

  beforeAll(() => {
    fs.chmodSync(FAKE_GH_CI, 0o755);
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });

  beforeEach(() => {
    sb = makeSandbox();
    // 模拟 runner 之前开出的 PR 分支：带 sprint 链文件（01 里有 task_id）
    git(sb.seed, 'checkout', '-q', '-b', BRANCH);
    fs.mkdirSync(path.join(sb.seed, SPRINT), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, SPRINT, '01-intent.md'), `---\ntask_id: ${TASK}\nstep: intent\nupstream: []\n---\n# x\n\n### I-1\n验收\n`);
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', 'feat: cw');
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
    head = git(sb.seed, 'rev-parse', 'HEAD').trim();
    // clone 及其 worktree 不跑本机全局钩子
    git(sb.clone, 'config', 'core.hooksPath', path.join(sb.root, 'no-hooks'));
    files.ghState = path.join(sb.root, 'gh-ci.json');
    files.prompt = path.join(sb.root, 'prompt.txt');
  });

  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    sb.cleanup();
  });

  const pr = (extra = {}) => ({ number: 77, headRefName: BRANCH, headRefOid: head, url: 'https://github.com/x/y/pull/77', isDraft: false, ...extra });
  const red = () => ({
    prs: [pr()],
    required: { 77: [{ name: 'ci-passed', bucket: 'fail' }, { name: 'Smoke Glob Runner Passed', bucket: 'pass' }] },
    checks: { 77: [
      { name: 'brain-unit (1)', bucket: 'fail', link: JOB_URL },
      { name: 'ci-passed', bucket: 'fail', link: 'https://github.com/perfectuser21/cecelia/actions/runs/1/job/4243' },
      { name: 'lint', bucket: 'pass', link: 'https://github.com/perfectuser21/cecelia/actions/runs/1/job/4244' },
    ] },
    logs: { 4242: '2026-10-08T10:40:00.4048853Z FAIL install.test.mjs > XML 转义\n2026-10-08T10:40:00.4061634Z AssertionError: expected <lt;', 4243: 'brain-unit failed' },
  });
  const go = async (ghState, { mode = 'fix', extra = {}, tasks = [] } = {}) => {
    fs.writeFileSync(files.ghState, JSON.stringify(ghState));
    brain = await startFakeBrain({ tasks });
    return runOnceProcess(runnerEnv(sb, brain.url, {
      CODING_WF_CIFIX: '1',
      CODING_WF_GH_BIN: FAKE_GH_CI,
      FAKE_GH_CI: files.ghState,
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CIFIX_MODE: mode,
      FAKE_CIFIX_PROMPT: files.prompt,
      ...extra,
    }));
  };
  const remoteHead = () => git(sb.origin, 'rev-parse', BRANCH).trim();
  const state = () => JSON.parse(fs.readFileSync(path.join(sb.logDir, 'cifix-77.json'), 'utf8'));

  it('必需检查已出结果且失败：拉失败 job 日志进 prompt → claude 在 PR 分支提交 → runner 推送；记录尝试、回写 Brain，本轮不再认领新任务', async () => {
    const r = await go(red(), { tasks: [codingTask('dddddddd-0000-4000-8000-000000000004')] });
    expect(r.exitCode, r.stderr).toBe(0);

    expect(remoteHead()).not.toBe(head);
    expect(git(sb.origin, 'log', '-1', '--format=%s', BRANCH).trim()).toBe('fix(ci): 修复 CI 失败');
    expect(git(sb.origin, 'merge-base', '--is-ancestor', head, BRANCH)).toBe('');

    const prompt = fs.readFileSync(files.prompt, 'utf8');
    expect(prompt).toContain(BRANCH);
    expect(prompt).toContain('brain-unit (1)');
    expect(prompt).toContain('AssertionError: expected <lt;');
    expect(prompt).not.toContain('2026-10-08T10:40:00.4061634Z'); // 去掉 Actions 时间戳
    expect(prompt).not.toContain('job/4244'); // 通过的检查不拉日志

    expect(state().attempts).toMatchObject([{ head, result: 'pushed' }]);
    const patch = brain.patches.find((p) => p.id === TASK);
    expect(patch.body.status).toBeUndefined();
    expect(patch.body.result.ci_fix.attempts).toMatchObject([{ pr: 77, head, result: 'pushed' }]);
    // 修复优先：本轮不认领新任务
    expect(brain.patches.some((p) => p.id.startsWith('dddddddd'))).toBe(false);
    // 修复 worktree 用完即删
    expect(fs.readdirSync(sb.worktreeBase).filter((n) => n.startsWith('cifix-'))).toEqual([]);
  });

  it('必需检查还有 pending / 全部通过 / 无必需检查 / 非 cw 分支：不修，照常进入认领新任务', async () => {
    const cases = [
      { ...red(), required: { 77: [{ name: 'ci-passed', bucket: 'pending' }, { name: 'x', bucket: 'fail' }] } },
      { ...red(), required: { 77: [{ name: 'ci-passed', bucket: 'pass' }] } },
      { ...red(), required: {} },
      { ...red(), prs: [pr({ headRefName: 'cp-10081835-some-feature' })] },
    ];
    for (const ghState of cases) {
      const r = await go(ghState);
      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.stderr).toContain('没有可新跑的开关任务');
      expect(fs.existsSync(files.prompt)).toBe(false);
      expect(remoteHead()).toBe(head);
      await brain.close();
      brain = null;
    }
  });

  // QA/裁判通过后已开自动合并：CI 修复再改代码 → 撤销通过、关自动合并，新 head 重过 QA 与裁判（4ac5fa39 首跑发现的漏洞）
  const seedQaPassed = () => {
    fs.mkdirSync(sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(sb.logDir, 'qa-77.json'), JSON.stringify({ passed: true, rounds: [{ round: 1, head, verdict: 'PASS', fails: 0, judge: { verdict: 'PASS' } }] }));
  };
  const qaState = () => JSON.parse(fs.readFileSync(path.join(sb.logDir, 'qa-77.json'), 'utf8'));
  const ghCalls = () => readJsonLines(sb.ghLog);

  it('QA 已通过后 CI 修复改了代码 → 撤销 QA 通过、关自动合并（新 head 重新 QA + 裁判）', async () => {
    seedQaPassed();
    const r = await go(red());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaState()).toMatchObject({ passed: false, revoked: [expect.objectContaining({ reason: 'ci_fix_changed_code', files: ['src/fix.txt'] })] });
    expect(ghCalls()).toContainEqual(['pr', 'merge', '77', '--disable-auto']);
  });

  it('QA 已通过后 CI 修复只补 changes/ 版本碎片 → 保留通过与自动合并', async () => {
    seedQaPassed();
    const r = await go(red(), { mode: 'fragment' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(state().attempts).toMatchObject([{ result: 'pushed' }]);
    expect(qaState().passed).toBe(true);
    expect(ghCalls().some((a) => a.includes('--disable-auto'))).toBe(false);
  });

  it('同一 head 只修一次；累计 2 次后不再修', async () => {
    fs.mkdirSync(sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(sb.logDir, 'cifix-77.json'), JSON.stringify({ attempts: [{ head, result: 'no_commit' }] }));
    let r = await go(red());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(files.prompt)).toBe(false);
    await brain.close();
    brain = null;

    fs.writeFileSync(path.join(sb.logDir, 'cifix-77.json'), JSON.stringify({ attempts: [{ head: 'a'.repeat(40), result: 'pushed' }, { head: 'b'.repeat(40), result: 'pushed' }] }));
    r = await go(red());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(files.prompt)).toBe(false);
    expect(remoteHead()).toBe(head);
  });

  it.each([
    ['none', 'no_commit'],
    ['dirty', 'uncommitted'],
    ['tamper', 'protected_path'],
    ['fail', 'claude_failed'],
  ])('claude 模式 %s → 不推送，记一次尝试 %s', async (mode, reason) => {
    const r = await go(red(), { mode });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remoteHead()).toBe(head);
    expect(state().attempts).toMatchObject([{ head, result: reason }]);
    expect(brain.patches.find((p) => p.id === TASK).body.result.ci_fix.attempts).toMatchObject([{ result: reason }]);
  });

  it('配置：默认开启、每 PR 最多 2 次；CODING_WF_CIFIX=0 关闭', () => {
    expect(loadConfig({ HOME: '/h' })).toMatchObject({ ciFix: true, ciFixMaxAttempts: 2 });
    expect(loadConfig({ HOME: '/h', CODING_WF_CIFIX: '0' }).ciFix).toBe(false);
  });

  it('CODING_WF_CIFIX=0 关闭：不查 PR', async () => {
    const r = await go(red(), { extra: { CODING_WF_CIFIX: '0' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readJsonLines(sb.ghLog)).toEqual([]);
    expect(fs.existsSync(files.prompt)).toBe(false);
  });
});
