// run-once.mjs 端到端：假 Brain、临时 bare origin + 专用 clone、假执行器、假 gh，全程不碰真实服务。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git } from '../../__tests__/helpers/git.mjs';
import {
  FAKE_EXECUTOR,
  FAKE_GH,
  startFakeBrain,
  codingTask,
  makeSandbox,
  runnerEnv,
  runOnceProcess,
  readJsonLines,
} from './helpers/sandbox.mjs';

const T1 = 'aaaaaaa1-0000-4000-8000-000000000001';
const T2 = 'bbbbbbb2-0000-4000-8000-000000000002';
const BRANCH_RE = /^cp-[0-9]{8}-cw-[0-9a-f]{8}$/;

/** 一个已退出进程的 pid（用于构造陈旧锁）。 */
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}

describe('coding workflow runner run-once', () => {
  let sb;
  let brain;

  beforeAll(() => {
    fs.chmodSync(FAKE_EXECUTOR, 0o755);
    fs.chmodSync(FAKE_GH, 0o755);
  });

  beforeEach(() => {
    sb = makeSandbox();
  });

  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    sb.cleanup();
  });

  it('没有带开关的任务：退出 0，不认领、不 PATCH、不跑执行器', async () => {
    brain = await startFakeBrain({
      tasks: [
        codingTask(T1, { payload: { headed_manual: 'true' } }),
        codingTask(T2, { payload: { coding_workflow: 'true' } }),
      ],
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    const list = brain.calls.find((c) => c.method === 'GET');
    expect(list.path).toBe('/api/brain/tasks');
    expect(new URLSearchParams(list.query).get('status')).toBe('queued');
    expect(new URLSearchParams(list.query).get('limit')).toBe('500');
    expect(brain.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(readJsonLines(sb.execLog)).toEqual([]);
    // 锁用完即释放
    expect(fs.existsSync(path.join(sb.lockDir, 'coding-workflow-runner.lock'))).toBe(false);
  }, 30000);

  it('已被认领 / 非 cecelia 仓的任务不参与；多条候选取最早创建的', async () => {
    brain = await startFakeBrain({
      tasks: [
        codingTask(T1, { created_at: '2026-10-08T02:00:00.000Z' }),
        codingTask(T2, { created_at: '2026-10-08T01:00:00.000Z', claimed_by: 'someone' }),
        codingTask('ccccccc3-0000-4000-8000-000000000003', { created_at: '2026-10-08T00:00:00.000Z', payload: { coding_workflow: true, repo: 'zenithjoy' } }),
        codingTask('ddddddd4-0000-4000-8000-000000000004', { created_at: '2026-10-08T01:30:00.000Z' }),
      ],
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    const claims = brain.calls.filter((c) => c.method === 'POST');
    expect(claims.map((c) => c.path)).toEqual(['/api/brain/tasks/ddddddd4-0000-4000-8000-000000000004/claim']);
  }, 30000);

  it('锁被存活进程持有：退出 0，不访问 Brain', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const lock = path.join(sb.lockDir, 'coding-workflow-runner.lock');
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(brain.calls).toEqual([]);
    // 别人的锁不能被删
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8')).toBe(String(process.pid));
  }, 30000);

  it('陈旧锁（持锁进程已死）被回收，本轮照常执行并在结束时释放', async () => {
    brain = await startFakeBrain({ tasks: [] });
    const lock = path.join(sb.lockDir, 'coding-workflow-runner.lock');
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, 'pid'), String(deadPid()));
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(brain.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
    expect(fs.existsSync(lock)).toBe(false);
  }, 30000);

  it('认领 409 换下一条，claimer 为 coding-workflow-runner@<hostname>', async () => {
    brain = await startFakeBrain({
      tasks: [
        codingTask(T1, { created_at: '2026-10-08T00:00:00.000Z' }),
        codingTask(T2, { created_at: '2026-10-08T01:00:00.000Z' }),
      ],
      claim409: [T1],
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    const claims = brain.calls.filter((c) => c.method === 'POST');
    expect(claims.map((c) => c.path)).toEqual([`/api/brain/tasks/${T1}/claim`, `/api/brain/tasks/${T2}/claim`]);
    expect(JSON.parse(claims[1].raw).claimer).toBe(`coding-workflow-runner@${os.hostname()}`);
    expect(brain.patches.map((p) => [p.id, p.body.status])).toEqual([[T2, 'in_progress'], [T2, 'completed']]);
  }, 30000);

  it('成功路径：建 worktree → 执行器回执 completed → automerge 调假 gh → PATCH completed（只补 runner）→ 删 worktree', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1, { payload: { coding_workflow: true, headed_manual: 'true', gp_anchor: 'f1/step3' } })] });
    const env = runnerEnv(sb, brain.url, {
      FAKE_EXEC_REPORT: '1',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      GIT_DIR: '/nonexistent/.git',
      GIT_INDEX_FILE: '/nonexistent/index',
    });
    const r = await runOnceProcess(env);
    expect(r.exitCode, r.stderr).toBe(0);

    const [exec] = readJsonLines(sb.execLog);
    const { input } = exec.envelope;
    const worktree = input.worktree;
    // worktree 建在临时 base，分支名满足全局 pre-commit 钩子正则
    expect(path.dirname(worktree)).toBe(sb.worktreeBase);
    expect(path.basename(worktree)).toBe('cw-aaaaaaa1');
    expect(input.task_id).toBe(T1);
    expect(input.brain_url).toBe(brain.url);
    expect(input.sprint_dir).toMatch(/^sprints\/[0-9]{8}-cw-aaaaaaa1$/);
    expect(input.run_tag).toMatch(/^[A-Za-z0-9_.:/-]{1,128}$/);
    // 执行器在 worktree 内被调用：--cwd 指向 worktree 的 coding-workflow 目录，--receipt 落 LOG_DIR
    expect(exec.argv).toEqual([
      '--cwd', path.join(worktree, 'packages/brain/scripts/coding-workflow'),
      '--receipt', path.join(sb.logDir, `${T1}.json`),
    ]);
    expect(exec.cwd).toBe(worktree);
    expect(exec.contract_activities).toEqual(['intent', 'spec', 'build', 'verify', 'chain_check', 'publish', 'report']);
    // 子进程 env 剥离 CLAUDECODE / CLAUDE_CODE_* / GIT_*，保留 CODING_WF_GH_BIN
    expect(exec.env).toEqual({
      CLAUDECODE: false,
      CLAUDE_CODE_ENTRYPOINT: false,
      GIT_DIR: false,
      GIT_WORK_TREE: false,
      GIT_INDEX_FILE: false,
      CODING_WF_GH_BIN: true,
    });

    // Brain：in_progress → report 的 result.coding_workflow → completed（只补 runner）
    expect(brain.patches.map((p) => p.body.status ?? null)).toEqual(['in_progress', null, 'completed']);
    const completed = brain.patches[2].body;
    expect(Object.keys(completed.result)).toEqual(['runner']);
    expect(completed.result.runner.receipt_path).toBe(path.join(sb.logDir, `${T1}.json`));
    expect(completed.result.runner.host).toBe(os.hostname());
    expect(Number.isInteger(completed.result.runner.duration_s)).toBe(true);
    expect(brain.tasks[0].result.coding_workflow.pr_url).toBe('https://github.com/example/repo/pull/9');
    expect(fs.existsSync(path.join(sb.logDir, `${T1}.json`))).toBe(true);

    // automerge：gh pr ready + gh pr merge --auto --squash
    expect(readJsonLines(sb.ghLog)).toEqual([
      ['pr', 'ready', 'https://github.com/example/repo/pull/9'],
      ['pr', 'merge', 'https://github.com/example/repo/pull/9', '--auto', '--squash'],
    ]);

    // worktree 已删除，clone 里不再登记它
    expect(fs.existsSync(worktree)).toBe(false);
    expect(git(sb.clone, 'worktree', 'list')).not.toContain('cw-aaaaaaa1');
  }, 30000);

  it('worktree 内容：基于 origin/main，写了 .dev-mode/.dev-lock（gp_anchor 取 payload）且不进 git status', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1, { payload: { coding_workflow: true, gp_anchor: 'f1/step3' } })] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_MODE: 'failed' }));
    expect(r.exitCode, r.stderr).toBe(1);
    const [{ envelope: { input: { worktree } } }] = readJsonLines(sb.execLog);
    const branch = git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    expect(branch).toMatch(BRANCH_RE);
    expect(branch.endsWith('-cw-aaaaaaa1')).toBe(true);
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(git(sb.origin, 'rev-parse', 'main'));
    const devMode = fs.readFileSync(path.join(worktree, `.dev-mode.${branch}`), 'utf8');
    expect(devMode).toContain(`branch: ${branch}`);
    expect(devMode).toContain(`task_id: ${T1}`);
    expect(devMode).toContain('gp_anchor: f1/step3');
    const devLock = JSON.parse(fs.readFileSync(path.join(worktree, `.dev-lock.${branch}`), 'utf8'));
    expect(devLock.branch).toBe(branch);
    expect(devLock.task_id).toBe(T1);
    expect(devLock.worktree_path).toBe(worktree);
    expect(git(worktree, 'status', '--porcelain')).toBe('');
  }, 30000);

  it('.gitignore 未忽略 .dev-* 时写进 worktree 的 info/exclude；gp_anchor 缺省 none(infra)', async () => {
    fs.writeFileSync(path.join(sb.seed, '.gitignore'), 'node_modules\n');
    git(sb.seed, 'commit', '-q', '-am', 'chore: drop ignore');
    git(sb.seed, 'push', '-q', 'origin', 'main');
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_MODE: 'failed' }));
    expect(r.exitCode, r.stderr).toBe(1);
    const [{ envelope: { input: { worktree } } }] = readJsonLines(sb.execLog);
    const branch = git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    expect(fs.readFileSync(path.join(worktree, `.dev-mode.${branch}`), 'utf8')).toContain('gp_anchor: none(infra)');
    expect(git(worktree, 'status', '--porcelain')).toBe('');
  }, 30000);

  it('CODING_WF_AUTOMERGE=0：成功但不调 gh', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readJsonLines(sb.ghLog)).toEqual([]);
    expect(brain.patches.at(-1).body.status).toBe('completed');
  }, 30000);

  it('失败路径：回执 partial/verify 失败 → PATCH failed 含 failed_activity/reason_code，worktree 保留', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_MODE: 'failed' }));
    expect(r.exitCode, r.stderr).toBe(1);
    expect(brain.patches.map((p) => p.body.status)).toEqual(['in_progress', 'failed']);
    const info = brain.patches[1].body.result.coding_workflow_runner;
    expect(info).toEqual({
      status: 'partial',
      failed_activity: 'verify',
      reason_code: 'verification_failed',
      receipt_path: path.join(sb.logDir, `${T1}.json`),
      host: os.hostname(),
    });
    const [{ envelope: { input: { worktree } } }] = readJsonLines(sb.execLog);
    expect(fs.existsSync(worktree)).toBe(true);
    expect(readJsonLines(sb.ghLog)).toEqual([]);
  }, 30000);

  it('执行器崩溃（stdout 非 JSON、非零退出）→ PATCH failed executor_crashed，worktree 保留', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_MODE: 'crash' }));
    expect(r.exitCode, r.stderr).toBe(1);
    const last = brain.patches.at(-1).body;
    expect(last.status).toBe('failed');
    expect(last.result.coding_workflow_runner.reason_code).toBe('executor_crashed');
    expect(last.result.coding_workflow_runner.failed_activity).toBeNull();
    expect(fs.existsSync(path.join(sb.worktreeBase, 'cw-aaaaaaa1'))).toBe(true);
  }, 30000);

  it('执行器超时 → 杀掉执行器，PATCH failed executor_timeout', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const started = Date.now();
    const r = await runOnceProcess(runnerEnv(sb, brain.url, {
      FAKE_EXEC_MODE: 'hang',
      CODING_WF_RUN_TIMEOUT_MS: '800',
      CODING_WF_KILL_GRACE_MS: '200',
    }));
    expect(r.exitCode, r.stderr).toBe(1);
    expect(Date.now() - started).toBeLessThan(20000);
    const last = brain.patches.at(-1).body;
    expect(last.status).toBe('failed');
    expect(last.result.coding_workflow_runner.reason_code).toBe('executor_timeout');
  }, 30000);

  it('执行器不存在 → PATCH failed，不留 in_progress 孤儿', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_EXECUTOR: path.join(sb.root, 'nope.js') }));
    expect(r.exitCode, r.stderr).toBe(1);
    expect(brain.patches.map((p) => p.body.status)).toEqual(['in_progress', 'failed']);
    expect(brain.patches[1].body.result.coding_workflow_runner.reason_code).toBe('executor_crashed');
  }, 30000);

  it('准备 worktree 失败（clone 的 origin 不可达）→ PATCH failed git_fetch_failed，不调执行器', async () => {
    git(sb.clone, 'remote', 'set-url', 'origin', path.join(sb.root, 'missing.git'));
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(1);
    expect(brain.patches.map((p) => p.body.status)).toEqual(['in_progress', 'failed']);
    expect(brain.patches[1].body.result.coding_workflow_runner.reason_code).toBe('git_fetch_failed');
    expect(readJsonLines(sb.execLog)).toEqual([]);
  }, 30000);

  it('Brain 拒绝 completed → 尽力改回写 failed（complete_rejected），worktree 保留', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)], patchStatus: { completed: 422 } });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(1);
    expect(brain.patches.map((p) => p.body.status)).toEqual(['in_progress', 'completed', 'failed']);
    expect(brain.patches[2].body.result.coding_workflow_runner.reason_code).toBe('complete_rejected');
    expect(fs.existsSync(path.join(sb.worktreeBase, 'cw-aaaaaaa1'))).toBe(true);
  }, 30000);

  it('Brain 不可达：退出 1，不建 worktree', async () => {
    const r = await runOnceProcess(runnerEnv(sb, 'http://127.0.0.1:9'));
    expect(r.exitCode).toBe(1);
    expect(fs.existsSync(sb.worktreeBase)).toBe(false);
  }, 30000);
});
