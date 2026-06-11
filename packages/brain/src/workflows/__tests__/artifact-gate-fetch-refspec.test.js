/**
 * artifact-gate-fetch-refspec.test.js — verifyContractArtifactsForPr 读合同分支前用显式 refspec fetch。
 *
 * 合同 Step 9 / 已知约束：
 *  `git fetch origin <branch>` 只更新 FETCH_HEAD，不更新 refs/remotes/origin/<branch>；
 *  后续 `git show origin/<branch>:...` 必 `invalid object name` → catch fail-open → 门没关。
 *  修复：fetch 用显式 refspec `<branch>:refs/remotes/origin/<branch>`（与 git-fence.js 同约定）。
 */
import { describe, it, expect, vi } from 'vitest';
import { verifyContractArtifactsForPr } from '../harness-task.graph.js';

describe('verifyContractArtifactsForPr — fetch 显式 refspec（修 fail-open）', () => {
  it('git fetch 参数含 <branch>:refs/remotes/origin/<branch>', async () => {
    const calls = [];
    const execFile = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: '' };
    });

    const res = await verifyContractArtifactsForPr(
      { prBranch: 'cp-abc-pr', sprintDir: 'sprints/x', worktreePath: '/tmp/wt' },
      {
        execFile,
        readContract: async () => '- [ARTIFACT] foo\n  Test: node -e "process.exit(0)"',
        runGate: async () => ({ ok: true, failures: [] }),
        mkWorktree: async () => '/tmp/cg-checkout',
        rmWorktree: async () => {},
      }
    );

    const fetchCall = calls.find((c) => c.args.includes('fetch'));
    expect(fetchCall, 'verifyContractArtifactsForPr 必须 fetch 合同分支').toBeTruthy();
    // 关键断言：必须用显式 refspec，而非裸 prBranch
    expect(fetchCall.args).toContain('cp-abc-pr:refs/remotes/origin/cp-abc-pr');
    expect(fetchCall.args).not.toContain('cp-abc-pr'); // 裸分支名（无 refspec）不应单独出现
    expect(res.ran).toBe(true);
    expect(res.ok).toBe(true);
  });
});
