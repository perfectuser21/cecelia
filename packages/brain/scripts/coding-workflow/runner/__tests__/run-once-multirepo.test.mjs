// C5 门禁按仓库遍历：每个已启用仓库各自 clone / worktree 根 / 状态命名空间 / gh 仓库（GH_REPO）；
// repos.json automerge=false 的仓库 QA + 裁判通过后不调 merge，记 awaiting_human 并 Bark 通知一次（复用 commander 上交的 Bark 通道），
// 人工合并后 runner 收账（merge.merged=true、by=human、phase=merged、终态 span）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitPlain } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, BRANCH, TASK } from './helpers/qa-env.mjs';
import { startFakeBrain, runnerEnv, runOnceProcess, readJsonLines, codingTask, SWITCH } from './helpers/sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPOS = JSON.parse(fs.readFileSync(path.join(HERE, '../../repos.json'), 'utf8'));
const ZJ_SLUG = 'acme/zj';

describe('门禁按仓库遍历 + automerge=false 等人合并', () => {
  let sb;
  const E = useQaEnv({ onReady: (e) => ({ sb } = e) });
  const { pr, green, remoteHead, ghCalls } = E;
  const reposFile = () => path.join(sb.root, 'repos.json');
  const zjClone = () => path.join(sb.root, 'zj-clone');
  const zjLogDir = () => path.join(sb.logDir, 'zj');
  const repoLog = () => path.join(sb.root, 'gh-repo.log');
  const barkCalls = () => E.preview.calls.filter((c) => c.url.startsWith('/bark/'));
  const mergeCalls = () => ghCalls().filter((a) => a[1] === 'merge');
  const ofTask = () => E.brain.patches.filter((p) => p.id === TASK).map((p) => p.body.result ?? {});

  /** 测试用 repos.json：cecelia 照抄（可改 automerge）；zj 可选，指向同一个 origin 的第二个 clone。 */
  const writeRepos = ({ ceceliaAutomerge = true, zj = null } = {}) => {
    const repos = REAL_REPOS.repos.map((r) => (r.default ? { ...r, automerge: ceceliaAutomerge } : r));
    if (zj) {
      if (!fs.existsSync(zjClone())) {
        gitPlain('clone', '-q', sb.origin, zjClone());
        git(zjClone(), 'config', 'core.hooksPath', path.join(sb.root, 'no-hooks'));
      }
      const z = REAL_REPOS.repos.find((r) => r.key === 'zenithjoy-workspace');
      repos.push({ ...z, key: 'zj', aliases: ['zj'], slug: ZJ_SLUG, origin: sb.origin, clone: zjClone(), worktree_base: path.join(sb.root, 'wt-zj'),
        state_ns: 'zj', enabled: true, automerge: zj.automerge, preview: { type: 'brain_preview', base_repo: 'zj' }, ...(zj.override ?? {}) });
    }
    fs.writeFileSync(reposFile(), JSON.stringify({ repos }));
  };
  const seed = (dir, s) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'qa-77.json'), JSON.stringify(s));
  };
  const approved = (head) => ({ passed: true, approved: { head, round: 1 }, rounds: [{ round: 1, head, verdict: 'PASS', fails: 0 }] });
  const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'qa-77.json'), 'utf8'));
  const go = (ghState, opts = {}) => E.go(ghState, { ...opts, extra: {
    CODING_WF_REPOS_FILE: reposFile(), CODING_WF_BARK_URL: `${E.preview.api}/bark`, FAKE_GH_REPO_LOG: repoLog(), ...opts.extra,
  } });

  it('automerge=false：批准且必需检查全绿 → 不调 gh pr merge；qa 状态记 awaiting_human（批准的 head）；Brain phase=awaiting_human；Bark 一次，下一轮不重复', async () => {
    writeRepos({ ceceliaAutomerge: false });
    const head = remoteHead();
    seed(sb.logDir, approved(head));
    let r = await go(green({ prs: [pr({ headRefOid: head })] }), { tasks: [{ id: TASK, status: 'completed', result: { runner: { host: 'mmv', phase: 'awaiting_qa' } } }] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([]);
    expect(read(sb.logDir)).toMatchObject({ passed: true, awaiting_human: { head, task_id: TASK } });
    expect(read(sb.logDir).merged).toBeUndefined();
    expect(ofTask()).toContainEqual(expect.objectContaining({ runner: expect.objectContaining({ host: 'mmv', phase: 'awaiting_human' }) }));
    expect(barkCalls()).toHaveLength(1);
    expect(decodeURIComponent(barkCalls()[0].url)).toContain('PR #77');
    expect(r.stderr).toContain('等人合并');
    await E.closeBrain();
    r = await go(green({ prs: [pr({ headRefOid: head })] }), { tasks: [{ id: TASK, status: 'completed' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([]);
    expect(barkCalls()).toHaveLength(1);
  });

  it('等人合并的 PR 被人合并 → Brain merge.merged=true（by=human）、phase=merged、终态合并 span；只收一次', async () => {
    writeRepos({ ceceliaAutomerge: false });
    const head = remoteHead();
    seed(sb.logDir, { ...approved(head), awaiting_human: { head, task_id: TASK, at: '2026-10-12T00:00:00.000Z' } });
    const merged = [{ ...pr({ headRefOid: head }), mergedAt: '2026-10-12T02:00:00Z' }];
    let r = await go({ prs: [], mergedPrs: merged }, { tasks: [{ id: TASK, status: 'completed', result: { runner: { phase: 'awaiting_human' } } }] });
    expect(r.exitCode, r.stderr).toBe(0);
    const res = ofTask().find((x) => x.merge);
    expect(res).toMatchObject({ merge: { merged: true, by: 'human', head }, runner: { phase: 'merged' } });
    expect(res.handoff.done.join('\n')).toContain('PR #77');
    expect(read(sb.logDir).merged).toMatchObject({ head, by: 'human' });
    expect(E.brain.spans).toContainEqual(expect.objectContaining({ occurrence_key: 'merge:77', outcome: 'pass' }));
    await E.closeBrain();
    r = await go({ prs: [], mergedPrs: merged }, { tasks: [{ id: TASK, status: 'completed' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(ofTask().filter((x) => x.merge)).toEqual([]);
  });

  it('多仓库：默认仓没有 PR，zj 仓已批准的 PR 由合并门在 zj 的 clone 里处理（gh 带 GH_REPO=zj、状态在 <logDir>/zj/、learnings repo=zj）', async () => {
    writeRepos({ zj: { automerge: true } });
    const head = remoteHead();
    seed(zjLogDir(), approved(head));
    const r = await go({ prs: [], byRepo: { [ZJ_SLUG]: green({ prs: [pr({ headRefOid: head })] }) } }, { tasks: [{ id: TASK, status: 'completed' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', head]]);
    const repoCalls = readJsonLines(repoLog());
    expect(repoCalls.find((c) => c.argv[1] === 'merge').repo).toBe(ZJ_SLUG);
    expect(repoCalls.filter((c) => c.argv[1] === 'list').map((c) => c.repo)).toEqual(expect.arrayContaining(['perfectuser21/cecelia', ZJ_SLUG]));
    expect(read(zjLogDir())).toMatchObject({ merged: { head } });
    expect(fs.existsSync(path.join(sb.logDir, 'qa-77.json'))).toBe(false);
    expect(E.brain.learnings).toEqual([expect.objectContaining({ task_id: TASK, repo: 'zj' })]);
    // task_id 从 zj 的 clone 读远端分支：PR 的提交只被取进 zj 的 clone，默认仓 clone 没碰（合并后分支已删，按对象查）
    expect(() => git(zjClone(), 'cat-file', '-e', head)).not.toThrow();
    expect(() => git(sb.clone, 'cat-file', '-e', head)).toThrow();
    expect(git(sb.clone, 'branch', '-r')).not.toContain(`origin/${BRANCH}`);
  });

  // C6：QA 门按仓库的 QA 模式。local（zenithjoy 第一阶段）不起预览，直接在 PR worktree 里跑 evaluate（带本仓 repo_profile）；
  // 本仓不固化回归 smoke（qa_smoke=null）：不写 smoke、不判 smoke_missing，smoke_note 写明
  it('多仓库：zj 仓 QA 模式 local → 不请求预览、直接跑 evaluate（input 带 zj 的 repo_profile）；PASS + 裁判 PASS → 批准，不固化 smoke', async () => {
    writeRepos({ zj: { automerge: false, override: { preview: { type: 'local' }, qa_smoke: null } } });
    const r = await go({ prs: [], byRepo: { [ZJ_SLUG]: green() } }, { mode: 'pass-api', tasks: [{ id: TASK, status: 'completed' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    const [call] = E.qaCalls();
    expect(call.repo_profile).toMatchObject({ key: 'zj', preview: { type: 'local' }, qa_smoke: null });
    expect(E.preview.calls.filter((c) => c.url.includes('/preview/'))).toEqual([]);
    expect(r.stderr).not.toContain('尚未接入');
    const s = read(zjLogDir());
    expect(s).toMatchObject({ passed: true });
    expect(s.smoke).toBeUndefined();
    expect(s.smoke_missing).toBeUndefined();
    expect(s.smoke_note).toContain('不固化');
    expect(E.originLog().join('\n')).not.toContain('qa-smoke');
  });

  it('多仓库：zj 仓 automerge=false → 不合并，<logDir>/zj/qa-77.json 记 awaiting_human，Bark 一次', async () => {
    writeRepos({ zj: { automerge: false } });
    const head = remoteHead();
    seed(zjLogDir(), approved(head));
    const r = await go({ prs: [], byRepo: { [ZJ_SLUG]: green({ prs: [pr({ headRefOid: head })] }) } }, { tasks: [{ id: TASK, status: 'completed' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([]);
    expect(read(zjLogDir())).toMatchObject({ awaiting_human: { head } });
    expect(barkCalls()).toHaveLength(1);
    expect(decodeURIComponent(barkCalls()[0].url)).toContain('zj');
  });
});

describe('任务按仓库执行', () => {
  let sb;
  const E = useQaEnv({ onReady: (e) => ({ sb } = e) });

  it('payload.repo=zj 的任务：worktree 建在 zj 的 worktree 根、来自 zj 的 clone，.dev-lock 记 repo=zj；判卷代码仍来自默认仓 clone', async () => {
    const zjClone = path.join(sb.root, 'zj-clone');
    gitPlain('clone', '-q', sb.origin, zjClone);
    const z = REAL_REPOS.repos.find((r) => r.key === 'zenithjoy-workspace');
    const repos = [...REAL_REPOS.repos, { ...z, key: 'zj', aliases: ['zj'], slug: ZJ_SLUG, origin: sb.origin, clone: zjClone,
      worktree_base: path.join(sb.root, 'wt-zj'), state_ns: 'zj', enabled: true }];
    fs.writeFileSync(path.join(sb.root, 'repos.json'), JSON.stringify({ repos }));
    const T = 'aaaaaaa1-0000-4000-8000-000000000001';
    E.brain = await startFakeBrain({ tasks: [codingTask(T, { payload: { ...SWITCH, repo: 'zj' } })] });
    const r = await runOnceProcess(runnerEnv(sb, E.brain.url, { FAKE_EXEC_MODE: 'failed', CODING_WF_REPOS_FILE: path.join(sb.root, 'repos.json') }));
    expect(r.exitCode, r.stderr).toBe(1);
    const [{ argv, envelope: { input: { worktree } } }] = readJsonLines(sb.execLog);
    expect(path.dirname(worktree)).toBe(path.join(sb.root, 'wt-zj'));
    expect(git(zjClone, 'worktree', 'list')).toContain(worktree);
    expect(git(sb.clone, 'worktree', 'list')).not.toContain(worktree);
    const branch = git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    expect(JSON.parse(fs.readFileSync(path.join(worktree, `.dev-lock.${branch}`), 'utf8')).repo).toBe('zj');
    // 活动层按仓库参数化（C6）：信封带任务所在仓库的 repos.json 条目
    expect(readJsonLines(sb.execLog)[0].envelope.input.repo_profile).toMatchObject({ key: 'zj', version_fragment: null });
    // 执行器的 --cwd（判卷代码目录）在默认仓 clone 里
    expect(argv[argv.indexOf('--cwd') + 1].startsWith(`${sb.clone}/`)).toBe(true);
  }, 30000);
});
