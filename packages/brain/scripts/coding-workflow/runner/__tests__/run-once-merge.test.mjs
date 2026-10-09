// 合并门（决策 a1fdbc51，对应旧 harness「merge 前 head == 锚定 SHA」）：runner 亲自合并，且只合并「被批准的那个 head」——
// 必需检查全部登记全绿 + QA 与裁判在该 head 上通过。批准后分支上再出现的提交：只是记录（本 PR 的版本碎片、本 sprint 的 QA 报告/
// 裁决/截图）或从 main 合进来的 merge 提交 → 改绑到新 head；动了别的文件 → 撤销批准，新 head 重新 QA + 裁判。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, BRANCH, SPRINT } from './helpers/qa-env.mjs';

describe('合并门（绑定 head SHA）', () => {
  let sb;
  const E = useQaEnv({ onReady: (e) => ({ sb } = e) });
  const { pr, green, go, addToBranch, remoteHead, state, seedState, qaCalls, ghCalls } = E;
  const approve = (h = remoteHead()) => seedState({ passed: true, approved: { head: h, round: 1 }, rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'PASS', fails: 0 }] });
  const mergeCalls = () => ghCalls().filter((a) => a[1] === 'merge');
  const lastResult = () => E.brainResults().at(-1);

  it('合并成功 → Brain 任务回写 merge（merged=true、合并的 head），完成以合并为准（审计 #7）', async () => {
    approve();
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(lastResult()).toMatchObject({ merge: { merged: true, head: remoteHead() } });
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
    approve();
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', remoteHead()]]);
    expect(state()).toMatchObject({ merged: { head: remoteHead() } });
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
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', remoteHead()]]);
  });

  it('批准后只补了 changes/ 碎片 → 改绑新 head 并按新 head 合并', async () => {
    approve();
    addToBranch('changes/frag.md', '## Brain {VERSION} — x\n');
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', remoteHead()]]);
    expect(state()).toMatchObject({ passed: true, approved: { head: remoteHead() } });
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
    const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--delete-branch', '--match-head-commit', remoteHead()]]);
  });
});
