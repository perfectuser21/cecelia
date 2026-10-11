// 合并门（决策 a1fdbc51，对应旧 harness「merge 前 head == 锚定 SHA」）：runner 亲自合并，且只合并「被批准的那个 head」——
// 必需检查全部登记全绿 + QA 与裁判在该 head 上通过。批准后分支上再出现的提交：只是记录（本 PR 的版本碎片、本 sprint 的 QA 报告/
// 裁决/截图）或从 main 合进来的 merge 提交 → 改绑到新 head；动了别的文件 → 撤销批准，新 head 重新 QA + 裁判。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, BRANCH, SPRINT, TASK } from './helpers/qa-env.mjs';

describe('合并门（绑定 head SHA）', () => {
  let sb;
  const E = useQaEnv({ onReady: (e) => ({ sb } = e) });
  const { pr, green, go, addToBranch, remoteHead, state, seedState, qaCalls, ghCalls } = E;
  const approve = (h = remoteHead()) => seedState({ passed: true, approved: { head: h, round: 1 }, rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'PASS', fails: 0 }] });
  const mergeCalls = () => ghCalls().filter((a) => a[1] === 'merge');
  const lastResult = () => E.brainResults().at(-1);

  it('合并成功 → Brain 任务回写 merge（merged=true、合并的 head），完成以合并为准（审计 #7）', async () => {
    const head = remoteHead();
    approve(head);
    // Brain 里真有这个任务（生产同样），回写必须成功
    const r = await go(green({ prs: [pr({ headRefOid: head })] }), { tasks: [{ id: TASK, status: 'in_progress' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    // 合并带 --delete-branch，远端分支已删：task_id 必须在合并前取到，回写不能被静默跳过
    expect(r.stderr).not.toContain('找不到 task_id');
    expect(r.stderr).not.toContain('合并门回写 Brain 任务');
    expect(lastResult()).toMatchObject({ merge: { merged: true, head } });
  });

  // 审计 #35 + #22：合并时汇总全链花费（链路 + QA + CI 修复）写进 Brain，并把这次交付的真实复盘写进 learnings
  it('合并成功 → result.cost_usd 汇总链路/QA/CI 修复花费；POST learnings-received（带 task_id、合同对抗/QA/CI 修复复盘）', async () => {
    const head = remoteHead();
    seedState({ passed: true, approved: { head, round: 2 }, cost_usd: 1.2, rounds: [
      { round: 1, head: 'a'.repeat(40), verdict: 'FAIL', fails: 2, report: `${SPRINT}/05-qa-report-r1.md` },
      { round: 2, head, verdict: 'PASS', fails: 0, report: `${SPRINT}/05-qa-report-r2.md` },
    ] });
    fs.mkdirSync(sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(sb.logDir, 'cifix-77.json'), JSON.stringify({ cost_usd: 0.8, attempts: [{ head: 'b'.repeat(40), result: 'pushed', checks: ['brain-unit (3)'] }] }));
    const task = { id: TASK, status: 'completed', result: {
      runner: { cost_usd: 3.5 }, coding_workflow: { gan: { verdict: 'APPROVED', rounds: 3, trend: 'converging' } },
    } };
    const r = await go(green({ prs: [pr({ headRefOid: head })] }), { tasks: [task] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(lastResult()).toMatchObject({ merge: { merged: true, head }, cost_usd: { chain: 3.5, qa: 1.2, ci_fix: 0.8, total: 5.5 } });
    expect(E.brain.learnings).toHaveLength(1);
    const l = E.brain.learnings[0];
    expect(l).toMatchObject({ task_id: TASK, branch_name: BRANCH, pr_number: 77, repo: 'cecelia', issues_found: [] });
    const text = l.next_steps_suggested.join('\n');
    for (const s of ['合同对抗 3 轮 APPROVED', '真人 QA 2 轮', '第 1 轮 FAIL（2 处失败', 'CI 修复 1 次', 'brain-unit (3)', '$5.5']) expect(text).toContain(s);
  });

  // 决策 b34e346a：合并门合并成功上报「合并」span
  it('合并成功 → 上报合并 span（pass，幂等键带 PR 号）', async () => {
    const head = remoteHead();
    approve(head);
    const r = await go(green({ prs: [pr({ headRefOid: head })] }), { tasks: [{ id: TASK, status: 'completed' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brain.spans).toContainEqual(expect.objectContaining({ run_id: `coding-workflow:${TASK}`, occurrence_key: 'merge:77', outcome: 'pass' }));
  });

  // 金丝雀 4：合并后 result.handoff 还是派发时合成的初版（pr_urls 空），runner.phase 停在 awaiting_qa；
  // Notion「最近执行」按最差 span 显示失败。合并即终态：刷新交接单与阶段，合并 span 标 run_terminal
  it('合并成功 → runner.phase=merged（保留原字段）；handoff 刷新为合并交接单（PR 链接、分支、无下一步，非合成）', async () => {
    const head = remoteHead();
    approve(head);
    const task = { id: TASK, status: 'completed', result: {
      runner: { host: 'mmv', phase: 'awaiting_qa', cost_usd: 3.5, automerge: { merge: 'awaiting_qa', ready: true } },
      handoff: { schema_version: 1, task_id: TASK, title: '修个 bug', verdict: 'PASS', done: ['完成：修个 bug'], not_done: [], next_steps: [], synthesized: true,
        artifacts: { docs: [], branch: null, pr_urls: [], sprint_dir: null }, created_at: '2026-10-10T10:05:49.999Z' },
    } };
    const r = await go(green({ prs: [pr({ headRefOid: head })] }), { tasks: [task] });
    expect(r.exitCode, r.stderr).toBe(0);
    const res = lastResult();
    expect(res.runner).toMatchObject({ host: 'mmv', phase: 'merged', cost_usd: 3.5, automerge: { merge: 'merged', ready: true } });
    expect(res.handoff).toMatchObject({
      task_id: TASK, title: '修个 bug', verdict: 'PASS', synthesized: false, next_steps: ['完成，无下一步'],
      artifacts: { branch: BRANCH, pr_urls: ['https://github.com/x/y/pull/77'] },
    });
    expect(res.handoff.done.join('\n')).toContain(`PR #77 已合并（head ${head.slice(0, 9)}）`);
    expect(Date.parse(res.handoff.created_at)).toBeGreaterThan(Date.parse('2026-10-10T10:05:49.999Z'));
  });

  it('合并 span 标 run_terminal（运行结果以合并为准，不被 GAN 中途的 FAIL 轮决定）', async () => {
    const head = remoteHead();
    approve(head);
    const r = await go(green({ prs: [pr({ headRefOid: head })] }), { tasks: [{ id: TASK, status: 'completed' }] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brain.spans.find((s) => s.occurrence_key === 'merge:77').evidence).toMatchObject({ run_terminal: true });
  });

  // 审计 #6：合并失败不能静默挂着
  it('合并失败且 PR 冲突 → 升级 merge_conflict（P1 + Brain escalations），不再重试', async () => {
    approve();
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })], mergeExit: 1, mergeable: 'CONFLICTING' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toContain('[coding-qa][P1]');
    expect(state().escalated).toMatchObject({ type: 'merge_conflict', pr: 77 });
    expect(lastResult().escalations).toEqual([expect.objectContaining({ type: 'merge_conflict' })]);
  });

  it('合并失败因为落后 main → 程序 gh pr update-branch（之后的 main 合入按改绑处理），不升级', async () => {
    approve();
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })], mergeExit: 1, mergeStateStatus: 'BEHIND' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(ghCalls()).toContainEqual(['pr', 'update-branch', '77']);
    expect(state().escalated).toBeUndefined();
  });

  it('其他原因合并失败：累计 3 次 → 升级 merge_failed', async () => {
    seedState({ passed: true, approved: { head: remoteHead(), round: 1 }, rounds: [], merge_failures: 2 });
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })], mergeExit: 1 }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(state()).toMatchObject({ merge_failures: 3, escalated: { type: 'merge_failed' } });
  });


  it('批准的 head 上必需检查全部登记全绿 → gh pr merge --squash --match-head-commit <该 head>；记 merged', async () => {
    const head = remoteHead();
    approve(head);
    const r = await go(green({ prs: [pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', head]]);
    expect(state()).toMatchObject({ merged: { head } });
    expect(qaCalls()).toEqual([]);
  });

  it('必需检查未全部登记 / 还在跑 / 有红 → 不合并', async () => {
    for (const gh of [
      green({ prs: [pr({ headRefOid: remoteHead() })], requiredContexts: ['ci-passed', 'Smoke Glob Runner Passed'] }),
      green({ prs: [pr({ headRefOid: remoteHead() })], required: { 77: [{ name: 'ci-passed', bucket: 'pending' }] } }),
      green({ prs: [pr({ headRefOid: remoteHead() })], required: { 77: [{ name: 'ci-passed', bucket: 'fail' }] } }),
    ]) {
      approve();
      const r = await go(gh, { extra: { CODING_WF_CIFIX: '0' } });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(mergeCalls()).toEqual([]);
      await E.closeBrain();
    }
  });

  it('批准后分支上出现改代码的提交 → 撤销批准、不合并（新 head 重新 QA）', async () => {
    const approvedHead = remoteHead();
    approve(approvedHead);
    addToBranch('src/feature.js', 'export const MARKER_CODE = 2;\n');
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([]);
    // 撤销本身算本轮动作：同一轮不立刻重跑 QA
    expect(qaCalls()).toEqual([]);
    expect(state()).toMatchObject({ passed: false, revoked: [expect.objectContaining({ reason: 'head_changed_after_approval', from: approvedHead, files: ['src/feature.js'] })] });
  });

  it('记录范围只认本 PR 的版本碎片与本 sprint 的 QA 报告/裁决/截图：批准后改 01 需求、或写别的 sprint → 撤销批准', async () => {
    for (const rel of [`${SPRINT}/01-intent.md`, 'sprints/other-sprint/x.md', 'changes/sub/x.md']) {
      approve();
      addToBranch(rel, `改了 ${rel}\n`);
      const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
      expect(r.exitCode, r.stderr).toBe(0);
      expect(mergeCalls(), rel).toEqual([]);
      expect(state().passed, rel).toBe(false);
      await E.closeBrain();
      fs.rmSync(sb.ghLog, { force: true });
    }
  });

  it('批准后补的是本 sprint 的 QA 报告/裁决/截图 → 改绑并合并', async () => {
    approve();
    addToBranch(`${SPRINT}/05-qa-report-r2.md`, '# r2\n');
    addToBranch(`${SPRINT}/06-judge-r2.md`, '# j2\n');
    addToBranch(`${SPRINT}/qa-r2/a.png`, 'png');
    const head = remoteHead();
    const r = await go(green({ prs: [pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', head]]);
  });

  it('批准后只补了 changes/ 碎片 → 改绑新 head 并按新 head 合并', async () => {
    approve();
    addToBranch('changes/frag.md', '## Brain {VERSION} — x\n');
    const head = remoteHead();
    const r = await go(green({ prs: [pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', head]]);
    expect(state()).toMatchObject({ passed: true, approved: { head } });
  });

  it('批准后只是把 main 合进分支（merge 提交）→ 不算 PR 自身改动，改绑并合并', async () => {
    approve();
    git(sb.seed, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(sb.seed, 'other.txt'), 'main moved\n');
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', 'chore: main moved');
    git(sb.seed, 'push', '-q', 'origin', 'main');
    git(sb.seed, 'checkout', '-q', BRANCH);
    git(sb.seed, 'merge', '-q', '--no-edit', 'main');
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
    const head = remoteHead();
    const r = await go(green({ prs: [pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', head]]);
  });
});
