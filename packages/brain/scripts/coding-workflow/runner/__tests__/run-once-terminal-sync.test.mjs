import { describe, it, expect } from 'vitest';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, BRANCH, TASK } from './helpers/qa-env.mjs';
describe('合并后终态不因退出 open 列表丢失', () => {
  const E = useQaEnv();
  it('同 tick 合并删 branch 后同步；下 tick 停预览再次同步，历史失败不改成全 PASS', async () => {
    const head = E.remoteHead();
    git(E.sb.origin, 'update-ref', 'refs/pull/77/head', head);
    E.seedState({ passed: true, approved: { head, round: 3 }, rounds: [
      { round: 1, verdict: 'FAIL' }, { round: 2, verdict: 'FAIL' }, { round: 3, verdict: 'PASS' },
    ] });
    const task = { id: TASK, status: 'completed', result: { runner: { host: 'mmv' } } };
    let r = await E.go(E.green({ prs: [E.pr({ headRefOid: head })] }), { tasks: [task] });
    expect(r.exitCode, r.stderr).toBe(0);
    const after = structuredClone(E.brain.tasks[0]);
    expect(after.result.qa_state?.merged).toMatchObject({ head });
    expect(after.result.handoff.done.join('\n')).toContain('AI QA 第 3 轮');
    expect(after.result.handoff.done.join('\n')).toContain('历史记录 3 轮');
    expect(after.result.handoff.done.join('\n')).not.toContain('真人 QA');
    expect(after.result.qa_state.rounds.map((x) => x.verdict)).toEqual(['FAIL', 'FAIL', 'PASS']);
    await E.closeBrain();
    r = await E.go({ prs: [], mergedPrs: [E.pr({ headRefOid: head, state: 'MERGED' })] }, { tasks: [after] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brain.tasks[0].result.qa_state.preview_stopped).toBe(true);
    expect(E.brain.learnings).toHaveLength(0);
    expect(E.ghCalls().filter((a) => a[1] === 'merge')).toHaveLength(1);
  });
  for (const [failure, options] of [['GET', { getTaskStatus: 503 }], ['PATCH', { resultPatchStatus: 409 }]]) {
    it(`${failure} 失败留下终态待办，退出 merged30 窗口仍重试且不重复交接/learning`, async () => {
      const head = E.remoteHead();
      git(E.sb.origin, 'update-ref', 'refs/pull/77/head', head);
      E.seedState({ passed: true, approved: { head, round: 1 }, rounds: [] });
      const task = { id: TASK, status: 'completed', result: { runner: { host: 'mmv', phase: 'awaiting_qa' }, handoff: { done: ['原事实'] } } };
      let r = await E.go(E.green(), { tasks: [task], brainOptions: options });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(E.brain.learnings).toHaveLength(0);
      if (failure === 'GET') expect(E.brain.patches).toHaveLength(0);
      const after = structuredClone(E.brain.tasks[0]);
      await E.closeBrain();
      const gh = { prs: [], mergedPrs: [], prDetails: { 77: E.pr({ state: 'MERGED', headRefOid: head }) } };
      r = await E.go(gh, { tasks: [after] });
      expect(r.exitCode, r.stderr).toBe(0);
      const done = structuredClone(E.brain.tasks[0]);
      expect(done.result.runner).toMatchObject({ host: 'mmv', phase: 'merged' });
      expect(done.result.qa_state).toMatchObject({ merged: { head }, preview_stopped: true });
      expect(done.result.handoff.done[0]).toBe('原事实');
      expect(E.brain.learnings).toHaveLength(1);
      await E.closeBrain();
      await E.go(gh, { tasks: [done] });
      expect(E.brain.learnings).toHaveLength(0);
      expect(E.brain.patches).toHaveLength(0);
      expect(E.brain.tasks[0].result.handoff.done).toEqual(done.result.handoff.done);
      expect(E.ghCalls().filter((a) => a[1] === 'merge')).toHaveLength(1);
    });
  }

});
