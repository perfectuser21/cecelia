// run-once.mjs 的任务依赖（大改拆成有序小任务）：payload.depends_on 里的前置任务全部完成且 PR 已合并才认领。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_EXECUTOR, startFakeBrain, codingTask, SWITCH, makeSandbox, runnerEnv, runOnceProcess } from './helpers/sandbox.mjs';
import { depsOf } from '../lib/plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GH_CI = path.join(HERE, 'fixtures/fake-gh-ci.mjs');
const DEP = 'd0000001-0000-4000-8000-000000000001';
const NEXT = 'e0000002-0000-4000-8000-000000000002';
const PR = 'https://github.com/perfectuser21/cecelia/pull/901';

describe('runner 任务依赖（depends_on）', () => {
  let sb;
  let brain;
  let ghState;

  beforeAll(() => {
    fs.chmodSync(FAKE_GH_CI, 0o755);
    fs.chmodSync(FAKE_EXECUTOR, 0o755);
  });

  beforeEach(() => {
    sb = makeSandbox();
    ghState = path.join(sb.root, 'gh-ci.json');
  });

  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    sb.cleanup();
  });

  const depTask = (status, result) => ({
    ...codingTask(DEP, { status, created_at: '2026-10-08T00:00:00.000Z' }),
    result,
  });
  const next = () => codingTask(NEXT, {
    created_at: '2026-10-08T01:00:00.000Z',
    payload: { ...SWITCH, depends_on: [DEP] },
  });
  const go = async (tasks, prStates = {}) => {
    fs.writeFileSync(ghState, JSON.stringify({ prStates }));
    brain = await startFakeBrain({ tasks });
    return runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_GH_BIN: FAKE_GH_CI, FAKE_GH_CI: ghState }));
  };
  const claimed = () => brain.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/claim')).map((c) => c.path.split('/')[4]);

  it('depsOf：只取非空字符串 id，其余忽略', () => {
    expect(depsOf({ payload: { depends_on: [DEP, '', 3, null, NEXT] } })).toEqual([DEP, NEXT]);
    expect(depsOf({ payload: { depends_on: 'x' } })).toEqual([]);
    expect(depsOf({ payload: {} })).toEqual([]);
    expect(depsOf(null)).toEqual([]);
  });

  it('前置任务已完成且 PR 已合并 → 认领后继任务', async () => {
    const r = await go([depTask('completed', { coding_workflow: { pr_url: PR } }), next()], { [PR]: 'MERGED' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claimed()).toEqual([NEXT]);
  });

  it.each([
    ['前置任务 PR 还没合并', () => [depTask('completed', { coding_workflow: { pr_url: PR } })], { [PR]: 'OPEN' }, '前置未就绪'],
    ['前置任务还在跑', () => [depTask('in_progress', null)], {}, '前置未就绪'],
    ['前置任务失败', () => [depTask('failed', { coding_workflow_runner: { reason_code: 'x' } })], {}, '前置失败'],
    ['前置任务 PR 被关闭未合并', () => [depTask('completed', { coding_workflow: { pr_url: PR } })], { [PR]: 'CLOSED' }, '前置失败'],
    ['前置任务不存在', () => [], {}, '前置未就绪'],
  ])('%s → 不认领后继，日志说明原因', async (_name, deps, prStates, why) => {
    const r = await go([...deps(), next()], prStates);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claimed()).not.toContain(NEXT);
    expect(r.stderr).toContain(`${NEXT} ${why}`);
  });

  it('后继被挡时不影响其他无依赖任务认领', async () => {
    const other = codingTask('f0000003-0000-4000-8000-000000000003', { created_at: '2026-10-08T02:00:00.000Z' });
    const r = await go([depTask('in_progress', null), next(), other]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claimed()).toEqual([other.id]);
  });
});
