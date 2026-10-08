// run-once 防重跑与对账：Brain 重启把任务打回 queued、本机已有运行痕迹、本机 runner 丢失的 in_progress 任务。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const ME = `coding-workflow-runner@${os.hostname()}`;
const PR = 'https://github.com/example/repo/pull/9';

/** 只在第一次只带 result 的 PATCH（report 活动回写）后执行一次，模拟运行中 Brain 重启。 */
function once(fn) {
  let done = false;
  return (task) => { if (!done) { done = true; fn(task); } };
}

describe('coding workflow runner 防重跑与对账', () => {
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

  const statuses = () => brain.patches.map((p) => p.body.status ?? null);
  const claims = () => brain.calls.filter((c) => c.method === 'POST');
  const writeLocal = (id, ext, body) => {
    fs.mkdirSync(sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(sb.logDir, `${id}.${ext}`), body);
  };

  it('运行中 Brain 重启把任务打回 queued（保留 claim）：收尾 409 → 重新 in_progress → completed，不重跑', async () => {
    brain = await startFakeBrain({
      tasks: [codingTask(T1)],
      onResultPatch: once((task) => { task.status = 'queued'; }),
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_REPORT: '1' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(statuses()).toEqual(['in_progress', null, 'completed', 'in_progress', 'completed', null]);
    expect(claims()).toHaveLength(1);
    expect(readJsonLines(sb.execLog)).toHaveLength(1);
    expect(brain.tasks[0].status).toBe('completed');
    expect(brain.calls.some((c) => c.method === 'GET' && c.path === `/api/brain/tasks/${T1}`)).toBe(true);
  }, 30000);

  it('打回 queued 且 claim 已被清：收尾时重新认领（带 executor_kind）再写终态', async () => {
    brain = await startFakeBrain({
      tasks: [codingTask(T1)],
      onResultPatch: once((task) => { task.status = 'queued'; task.claimed_by = null; }),
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_REPORT: '1', CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claims()).toHaveLength(2);
    expect(JSON.parse(claims()[1].raw)).toEqual({ claimer: ME, executor_kind: 'coding-workflow-runner' });
    expect(statuses()).toEqual(['in_progress', null, 'completed', 'in_progress', 'completed']);
  }, 30000);

  it('打回 queued 后已被他人认领：只记日志，不覆盖、不 automerge、保留 worktree', async () => {
    brain = await startFakeBrain({
      tasks: [codingTask(T1)],
      onResultPatch: once((task) => { task.status = 'queued'; task.claimed_by = 'someone-else'; }),
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_REPORT: '1' }));
    expect(r.exitCode).toBe(1);
    expect(statuses()).toEqual(['in_progress', null, 'completed']);
    expect(brain.tasks[0].claimed_by).toBe('someone-else');
    expect(r.stderr).toContain('someone-else');
    expect(readJsonLines(sb.ghLog)).toEqual([]);
    expect(fs.existsSync(path.join(sb.worktreeBase, 'cw-aaaaaaa1'))).toBe(true);
  }, 30000);

  it('本机已有终态回执（上次跑完没写进 Brain）：不重跑，按回执对账收尾为 completed', async () => {
    writeLocal(T1, 'json', JSON.stringify({ status: 'completed', outputs: { pr_url: PR }, activities: [] }));
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readJsonLines(sb.execLog)).toEqual([]);
    expect(statuses()).toEqual(['in_progress', 'completed']);
    expect(brain.patches[1].body.result.runner.reconciled).toBe(true);
  }, 30000);

  it('本机只有运行日志没有终态回执（runner 中途丢失）：不重跑，收尾为 failed runner_lost', async () => {
    writeLocal(T1, 'log', 'half way\n');
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(readJsonLines(sb.execLog)).toEqual([]);
    expect(statuses()).toEqual(['in_progress', 'failed']);
    expect(brain.patches[1].body.result.coding_workflow_runner.reason_code).toBe('runner_lost');
    expect(r.exitCode).toBe(0);
  }, 30000);

  it('打回 queued 仍挂着本机 claim + 本机有终态回执：不再认领，直接 in_progress → 终态', async () => {
    writeLocal(T1, 'json', JSON.stringify({ status: 'completed', outputs: { pr_url: PR }, activities: [] }));
    brain = await startFakeBrain({ tasks: [codingTask(T1, { claimed_by: ME })] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claims()).toEqual([]);
    expect(statuses()).toEqual(['in_progress', 'completed']);
  }, 30000);

  it('Brain 里已有运行结果（result.coding_workflow 等）而本机无痕迹：不认领该条，继续下一条', async () => {
    brain = await startFakeBrain({
      tasks: [
        codingTask(T1, { created_at: '2026-10-08T00:00:00.000Z', result: { coding_workflow: { pr_url: PR } } }),
        codingTask(T2, { created_at: '2026-10-08T01:00:00.000Z', result: { runner: { host: 'x' }, other: 1 } }),
        codingTask('ccccccc3-0000-4000-8000-000000000003', { created_at: '2026-10-08T02:00:00.000Z', result: { coding_workflow_runner: { reason_code: 'x' } } }),
        codingTask('ddddddd4-0000-4000-8000-000000000004', { created_at: '2026-10-08T03:00:00.000Z', result: { unrelated: true, coding_workflow: {} } }),
      ],
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claims().map((c) => c.path)).toEqual(['/api/brain/tasks/ddddddd4-0000-4000-8000-000000000004/claim']);
    expect(r.stderr).toContain(T1);
  }, 30000);

  it('认领响应 executor_kind 不是 coding-workflow-runner（旧 Brain 端点保留 headed-session 残留）：不跑链，in_progress → failed executor_kind_mismatch', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1, { executor_kind: 'headed-session' })], legacyClaim: true });
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode).toBe(1);
    expect(readJsonLines(sb.execLog)).toEqual([]);
    expect(statuses()).toEqual(['in_progress', 'failed']);
    const info = brain.patches[1].body.result.coding_workflow_runner;
    expect(info.reason_code).toBe('executor_kind_mismatch');
    expect(info.detail).toContain('headed-session');
    expect(r.stderr).toContain('headed-session');
    expect(fs.existsSync(sb.worktreeBase)).toBe(false);
  }, 30000);

  it('预置 headed-session 的任务经新端点认领后 kind 被纠正，照常跑链', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1, { executor_kind: 'headed-session' })] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(brain.tasks[0].executor_kind).toBe('coding-workflow-runner');
    expect(readJsonLines(sb.execLog)).toHaveLength(1);
  }, 30000);

  it('启动对账：本机 runner 认领的 in_progress 任务（锁已在本进程手里 = 原执行者已不在）→ failed runner_lost；别人的不动', async () => {
    brain = await startFakeBrain({
      tasks: [
        codingTask(T1, { status: 'in_progress', claimed_by: ME }),
        codingTask(T2, { status: 'in_progress', claimed_by: 'coding-workflow-runner@other-host' }),
      ],
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    const inProgressList = brain.calls.find((c) => c.method === 'GET' && new URLSearchParams(c.query).get('status') === 'in_progress');
    expect(new URLSearchParams(inProgressList.query).get('task_type')).toBe('data');
    expect(brain.patches.map((p) => [p.id, p.body.status])).toEqual([[T1, 'failed']]);
    const info = brain.patches[0].body.result.coding_workflow_runner;
    expect(info.reason_code).toBe('runner_lost');
    expect(info.host).toBe(os.hostname());
    expect(info.detail).toMatch(/runner/);
    expect(brain.tasks[1].status).toBe('in_progress');
  }, 30000);

  it('启动对账：本机 runner 的 in_progress 任务若本机有 completed 回执 → 收尾为 completed', async () => {
    writeLocal(T1, 'json', JSON.stringify({ status: 'completed', outputs: { pr_url: PR }, activities: [] }));
    brain = await startFakeBrain({ tasks: [codingTask(T1, { status: 'in_progress', claimed_by: ME })] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(statuses()).toEqual(['completed']);
  }, 30000);
});
