import fs from 'node:fs';
import path from 'node:path';
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

  it('GitHub合并成功但本地mark前进程死亡：精确merge intent重启只收账，不二次合并', async () => {
    const head = E.remoteHead();
    git(E.sb.origin, 'update-ref', 'refs/pull/77/head', head);
    E.seedState({ passed: true, approved: { head, round: 1 }, rounds: [] });
    const task = { id: TASK, status: 'completed', result: { runner: { host: 'mmv' } } };
    const crashed = await E.go(E.green({ crashAfterMerge: true }), { tasks: [task] });
    expect(crashed.exitCode).not.toBe(0);
    expect(E.state().merged).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(E.sb.logDir, 'pr-sync-pending.json'), 'utf8')).entries['77'].merge_intent.head).toBe(head);
    await E.closeBrain();
    // SIGKILL不能执行finally清锁；模拟系统确认旧pid退出后的下一次重启。
    fs.rmSync(E.sb.lockDir, { recursive: true, force: true });
    const r = await E.go({ prs: [], prDetails: { 77: E.pr({ state: 'MERGED', headRefOid: head }) } }, { tasks: [task] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brain.tasks[0].result).toMatchObject({ merge: { merged: true, head }, runner: { host: 'mmv', phase: 'merged' } });
    expect(E.ghCalls().filter((a) => a[1] === 'merge')).toHaveLength(1);
  });
  it('关闭回执PATCH失败且已退出closed100窗口：下tick仍收尾并同步', async () => {
    const head = E.remoteHead();
    E.seedState({ passed: false, rounds: [{ round: 1, verdict: 'FAIL' }] });
    const closed = E.pr({ state: 'CLOSED', headRefOid: head, closedAt: '2026-10-15T00:00:00Z' });
    const task = { id: TASK, status: 'completed', result: { runner: { host: 'mmv' } } };
    await E.go({ prs: [], closedPrs: [closed] }, { tasks: [task], brainOptions: { resultPatchStatus: 409 } });
    const after = structuredClone(E.brain.tasks[0]);
    expect(E.state().closed).toBeUndefined();
    await E.closeBrain();
    const r = await E.go({ prs: [], closedPrs: [], prDetails: { 77: closed } }, { tasks: [after] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brain.tasks[0].result).toMatchObject({ runner: { host: 'mmv', phase: 'closed_unmerged' }, qa_state: { closed: { head }, preview_stopped: true } });
    expect(E.brain.learnings).toHaveLength(0);
  });
  it('旧closed待办实际已重开：不再停预览，并从远端删除已撤销镜像字段', async () => {
    E.seedState({ passed: false, rounds: [], escalated: { type: 'blocked' } });
    const closed = E.pr({ state: 'CLOSED', closedAt: '2026-10-15T00:00:00Z' });
    const task = { id: TASK, status: 'completed', result: {} };
    await E.go({ prs: [], closedPrs: [closed] }, { tasks: [task] });
    const after = structuredClone(E.brain.tasks[0]);
    await E.closeBrain();
    const stops = E.preview.calls.filter((c) => c.url.includes('/stop/')).length;
    await E.go({ prs: [E.pr()] }, { tasks: [after] });
    expect(E.preview.calls.filter((c) => c.url.includes('/stop/'))).toHaveLength(stops);
    expect(E.brain.tasks[0].result.qa_state.closed).toBeUndefined();
    expect(E.brain.tasks[0].result.qa_state.preview_stopped).toBeUndefined();
    expect(E.brain.tasks[0].result.runner.phase).toBe('awaiting_qa');
  });

  it('terminal本机QA文件丢失：从已核身份的Brain恢复再停预览，保留原FAIL轮', async () => {
    const head = E.remoteHead();
    git(E.sb.origin, 'update-ref', 'refs/pull/77/head', head);
    E.seedState({ passed: true, approved: { head, round: 2 }, rounds: [{ round: 1, verdict: 'FAIL' }, { round: 2, verdict: 'PASS' }] });
    await E.go(E.green(), { tasks: [{ id: TASK, status: 'completed', result: {} }] });
    const task = structuredClone(E.brain.tasks[0]);
    await E.closeBrain();
    fs.rmSync(E.statePath());
    await E.go({ prs: [], prDetails: { 77: E.pr({ state: 'MERGED', headRefOid: head }) } }, { tasks: [task] });
    expect(E.state()).toMatchObject({ passed: true, merged: { head }, preview_stopped: true });
    expect(E.state().rounds.map((r) => r.verdict)).toEqual(['FAIL', 'PASS']);
    expect(E.brain.tasks[0].result.qa_state.preview_stopped).toBe(true);
    expect(E.brain.learnings).toHaveLength(0);
  });

  it('回执已入库但响应失败：重启不追加handoff，不猜Learning已写或重发', async () => {
    const head = E.remoteHead();
    git(E.sb.origin, 'update-ref', 'refs/pull/77/head', head);
    E.seedState({ passed: true, approved: { head, round: 1 }, rounds: [] });
    await E.go(E.green(), { tasks: [{ id: TASK, status: 'completed', result: { handoff: { done: ['原事实'] } } }], brainOptions: { resultPatchCommittedStatus: 409 } });
    const task = structuredClone(E.brain.tasks[0]);
    expect(task.result.runner.phase).toBe('merged');
    expect(E.brain.learnings).toHaveLength(0);
    await E.closeBrain();
    await E.go({ prs: [], prDetails: { 77: E.pr({ state: 'MERGED', headRefOid: head }) } }, { tasks: [task] });
    expect(E.brain.tasks[0].result.handoff.done).toEqual(task.result.handoff.done);
    expect(E.brain.learnings).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(path.join(E.sb.logDir, 'pr-sync-pending.json'), 'utf8')).entries['77']).toMatchObject({ receipt_pending: false, learning_pending: true, learning_status: 'existing_receipt_unverified' });
  });
  it('merge intent与实际MERGED head不同：不恢复虚假的批准或收账', async () => {
    const head = E.remoteHead();
    E.seedState({ passed: true, approved: { head, round: 1 }, rounds: [] });
    const pending = { repo: 'perfectuser21/cecelia', entries: { 77: { pr: E.pr({ state: 'OPEN' }), merge_intent: { head, at: '2026-10-15T00:00:00Z' } } } };
    fs.writeFileSync(path.join(E.sb.logDir, 'pr-sync-pending.json'), JSON.stringify(pending));
    await E.go({ prs: [], prDetails: { 77: E.pr({ state: 'MERGED', headRefOid: 'f'.repeat(40) }) } }, { tasks: [{ id: TASK, status: 'completed', result: {} }] });
    expect(E.state().merged).toBeUndefined();
    expect(E.brain.tasks[0].result.merge).toBeUndefined();
    expect(E.brain.learnings).toHaveLength(0);
    expect(E.ghCalls().filter((a) => a[1] === 'merge')).toHaveLength(0);
  });

  it('恢复在本地merged落盘后中断、pending仍仅有intent：仍补回执待办', async () => {
    const head = E.remoteHead();
    E.seedState({ passed: true, approved: { head, round: 1 }, rounds: [], merged: { head, at: '2026-10-15T00:00:00Z' } });
    const pending = { repo: 'perfectuser21/cecelia', entries: { 77: { pr: E.pr({ state: 'MERGED' }), merge_intent: { head, at: '2026-10-15T00:00:00Z' } } } };
    fs.writeFileSync(path.join(E.sb.logDir, 'pr-sync-pending.json'), JSON.stringify(pending));
    await E.go({ prs: [], prDetails: { 77: E.pr({ state: 'MERGED', headRefOid: head }) } }, { tasks: [{ id: TASK, status: 'completed', result: { runner: { host: 'mmv' } } }] });
    expect(E.brain.tasks[0].result).toMatchObject({ merge: { merged: true, head }, runner: { phase: 'merged', host: 'mmv' } });
    expect(E.brain.learnings).toHaveLength(1);
    expect(E.ghCalls().filter((a) => a[1] === 'merge')).toHaveLength(0);
  });

});
