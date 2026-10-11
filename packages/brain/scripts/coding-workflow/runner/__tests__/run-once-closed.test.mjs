// 外部关闭（未合并）的 cw PR 收尾（金丝雀 5：PR #6220 / 任务 4ea44bcf 被人关掉后 runner 两天毫无反应）：
// 各道门只看 open 列表 → 关掉的 PR 没有 Brain 回写、没有终态 span、预览不停。
// 口径：Brain 任务保持 completed（状态机 completed 是终态），result.runner.phase='closed_unmerged' + result.merge.closed=true；
// 终态 span outcome=fail、reason=pr_closed_externally；停预览；修复会话跑到一半 PR 被关 → 不推送、不升级；PR 重开 → 自动恢复。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, BRANCH, TASK } from './helpers/qa-env.mjs';

const CLOSED_AT = '2026-10-10T09:52:15Z';

describe('runner 收尾外部关闭的 PR', () => {
  let sb;
  const E = useQaEnv({ onReady: (e) => ({ sb } = e) });
  const { pr, green, go, remoteHead, state, seedState, ghCalls, originLog } = E;
  const lastResult = () => E.brainResults().at(-1);
  const stopCalls = () => E.preview.calls.filter((c) => c.url === '/api/brain/preview/stop/77');
  const closedPr = (extra = {}) => ({ ...pr({ headRefOid: extra.headRefOid ?? remoteHead() }), state: 'CLOSED', closedAt: CLOSED_AT, mergedAt: null, ...extra });
  const closedGh = (extra = {}) => ({
    prs: [], closedPrs: extra.closedPrs ?? [closedPr()],
    events: { 77: [{ event: 'ready_for_review', actor: { login: 'bot' } }, { event: 'closed', actor: { login: 'someone' } }] },
    ...extra,
  });
  const task = (result = { runner: { phase: 'awaiting_qa', cost_usd: 3.5, host: 'mmv' } }) => ({ id: TASK, status: 'completed', result });

  it('已批准的 PR 被外部关闭 → Brain 回写 closed_unmerged（status 不动）、终态 span、停预览、本机记 closed；不合并', async () => {
    const head = remoteHead();
    seedState({ passed: true, approved: { head, round: 1 }, rounds: [{ round: 1, head, verdict: 'PASS', fails: 0 }] });
    const r = await go(closedGh(), { tasks: [task()] });
    expect(r.exitCode, r.stderr).toBe(0);
    const res = lastResult();
    expect(res.runner).toMatchObject({ phase: 'closed_unmerged', closed_reason: 'pr_closed_externally', cost_usd: 3.5, host: 'mmv' });
    expect(res.merge).toMatchObject({ merged: false, closed: true, closed_at: CLOSED_AT, head, closed_by: 'someone' });
    expect(res.handoff).toMatchObject({ task_id: TASK, verdict: 'CLOSED', next_steps: ['完成，无下一步'], artifacts: { pr_urls: ['https://github.com/x/y/pull/77'] } });
    expect(res.handoff.done.join('\n')).toContain('PR #77');
    expect(res.handoff.done.join('\n')).toContain('关闭未合并');
    // status 保持 completed：只写 result
    expect(E.brain.patches.filter((p) => p.body.status)).toEqual([]);
    expect(E.brain.spans).toContainEqual(expect.objectContaining({
      run_id: `coding-workflow:${TASK}`, occurrence_key: 'merge:77:closed', outcome: 'fail',
      evidence: expect.objectContaining({ run_terminal: true, reason: 'pr_closed_externally', closed_by: 'someone' }),
    }));
    expect(stopCalls()).toEqual([expect.objectContaining({ method: 'POST', auth: 'Bearer tok-1' })]);
    expect(state()).toMatchObject({ closed: { at: CLOSED_AT, head, by: 'someone', task_id: TASK }, preview_stopped: true });
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
  });

  it('幂等：本机已记 closed → 不再回写 Brain、不再上报 span、不再停预览', async () => {
    seedState({ passed: true, rounds: [], closed: { at: CLOSED_AT, head: remoteHead(), by: 'someone', task_id: TASK }, preview_stopped: true });
    const r = await go(closedGh(), { tasks: [task()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brainResults()).toEqual([]);
    expect(E.brain.spans).toEqual([]);
    expect(stopCalls()).toEqual([]);
  });

  it('换机后本机没有记录、但 Brain 已是 closed_unmerged → 只补本机标记，不重复回写', async () => {
    const r = await go(closedGh(), { tasks: [task({ runner: { phase: 'closed_unmerged' }, merge: { merged: false, closed: true } })] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brainResults()).toEqual([]);
    expect(E.brain.spans).toEqual([]);
    expect(state().closed).toMatchObject({ at: CLOSED_AT, task_id: TASK });
  });

  it('关闭时分支已删 → 经 refs/pull/77/head 取 task_id，照常回写与上报', async () => {
    const head = remoteHead();
    git(sb.origin, 'update-ref', 'refs/pull/77/head', head);
    git(sb.origin, 'update-ref', '-d', `refs/heads/${BRANCH}`);
    const r = await go(closedGh({ closedPrs: [closedPr({ headRefOid: head })] }), { tasks: [task()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('找不到 task_id');
    expect(lastResult()).toMatchObject({ runner: { phase: 'closed_unmerged' }, merge: { closed: true, head } });
    expect(E.brain.spans).toContainEqual(expect.objectContaining({ occurrence_key: 'merge:77:closed' }));
  });

  it('QA 还没通过（FAIL 修复中）的 PR 被关 → 也停预览、也回写 closed_unmerged', async () => {
    seedState({ passed: false, rounds: [{ round: 1, head: remoteHead(), verdict: 'FAIL', fails: 2 }] });
    const r = await go(closedGh(), { tasks: [task()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(stopCalls()).toHaveLength(1);
    expect(lastResult()).toMatchObject({ runner: { phase: 'closed_unmerged' }, merge: { merged: false, closed: true } });
  });

  it('commander 已上交主理人的 PR 被关 → Brain commander_human 标 resolved=pr_closed', async () => {
    seedState({ passed: false, rounds: [], escalated: { type: 'qa_stalled', at: '2026-10-10T09:00:00.000Z' } });
    fs.writeFileSync(path.join(sb.logDir, 'commander-77.json'), JSON.stringify({ interventions: [], human: { reason: 'commander_limit', escalation_at: '2026-10-10T09:00:00.000Z' } }));
    const r = await go(closedGh(), { tasks: [task()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(lastResult().commander_human).toMatchObject({ reason: 'commander_limit', resolved: 'pr_closed' });
  });

  it('守卫：列表里 state=MERGED 的不当作外部关闭', async () => {
    seedState({ passed: true, rounds: [] });
    const r = await go(closedGh({ closedPrs: [closedPr({ state: 'MERGED', mergedAt: CLOSED_AT })] }), { tasks: [task()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brainResults()).toEqual([]);
    expect(E.brain.spans.filter((s) => s.occurrence_key === 'merge:77:closed')).toEqual([]);
    expect(state().closed).toBeUndefined();
  });

  it('PR 被重开 → 清掉 closed 与 preview_stopped，Brain phase 回 awaiting_qa、merge 置空、记 reopened，各门照常接管', async () => {
    seedState({ passed: false, rounds: [], preview_stopped: true, closed: { at: CLOSED_AT, head: remoteHead(), by: 'someone', task_id: TASK } });
    const r = await go({ prs: [pr({ headRefOid: remoteHead() })] }, { tasks: [task({ runner: { phase: 'closed_unmerged', cost_usd: 3.5 }, merge: { merged: false, closed: true } })] });
    expect(r.exitCode, r.stderr).toBe(0);
    const s = state();
    expect(s.closed).toBeUndefined();
    expect(s.preview_stopped).toBeUndefined();
    expect(s.reopened).toEqual([expect.objectContaining({ closed_at: CLOSED_AT })]);
    const res = lastResult();
    expect(res.runner).toMatchObject({ phase: 'awaiting_qa', cost_usd: 3.5 });
    expect(res.runner.reopened).toHaveLength(1);
    expect(res.merge).toBeNull();
  });

  it('QA 修复会话跑到一半 PR 被关 → 修复不推送、不升级、不写 escalations；这一轮记 fix=pr_closed', async () => {
    // 第 1 次查（推 QA 记录）还开着，第 2 次查（推修复）已关
    const r = await go(green({ prStateSeq: { 77: ['OPEN', 'CLOSED'] } }), { mode: 'fail' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA FAIL');
    expect(originLog()).not.toContain('fix(ci): 修复 CI 失败');
    const s = state();
    expect(s.escalated).toBeUndefined();
    expect(s.rounds.at(-1)).toMatchObject({ round: 1, verdict: 'FAIL', fix: 'pr_closed' });
    expect(E.brainResults().filter((x) => x.escalations)).toEqual([]);
    expect(r.stderr).not.toContain('[coding-qa][P1]');
  });

  it('推送 QA 记录前 PR 已关 → 什么都不推，不计评估坏、不升级', async () => {
    const before = remoteHead();
    const r = await go(green({ prStates: { 77: 'CLOSED' } }), { mode: 'fail' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remoteHead()).toBe(before);
    const s = fs.existsSync(E.statePath()) ? state() : {};
    expect(s.escalated).toBeUndefined();
    expect(s.bad ?? 0).toBe(0);
    expect(r.stderr).toContain('PR #77 已关闭');
  });
});
