/**
 * 合同冻结测试 — ground-truth 提案分支观测（remote 解析 + rn 扫描）。
 *
 * 被改的边：ground-truth ↔ git remote（ls-remote）。禁 mock 该边——
 * 通过既有 execCmd seam 注入假 exec（依赖注入，非 vi.mock git），返回真实 shape 的
 * ls-remote 输出，验证 remote 解析优先级与「双空不退 origin」。
 *
 * 期望 Generator 从 ground-truth.js 导出可测单元 observeProposalBranch(params)：
 *   observeProposalBranch({ taskPayload, shortTask, shortRun, execCmd, legacyBranchesForRun })
 *     → { proposeBranchRn, proposeBranch, proposeBranchSha, proposalRemote, proposalRemoteUnresolved }
 * remote 解析：parseBaseRepo(taskPayload.base_repo) ?? parseBaseRepo(taskPayload.repo)；
 * 解析到 → 对 "https://github.com/<owner>/<repo>.git" 跑 ls-remote；
 * 双空 → proposalRemoteUnresolved=true 且**不**执行 ls-remote（禁退 origin）。
 */
import { describe, it, expect, vi } from 'vitest';
import { observeProposalBranch } from '../../../packages/brain/src/orchestrator/ground-truth.js';

const SHORT_TASK = 'ff2b0fa9';
const SHORT_RUN = '7a8e5319';

// run 7a8e5319 生产实证：GitHub 上真实存在的两条提案分支（a10 / a13）。
const A10_SHA = '7f413df5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const A13_SHA = '7e78cee1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BRANCH_A10 = `cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a10`;
const BRANCH_A13 = `cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a13`;
const LS_REMOTE_OUTPUT = `${A10_SHA}\trefs/heads/${BRANCH_A10}\n${A13_SHA}\trefs/heads/${BRANCH_A13}\n`;

describe('observeProposalBranch remote 解析（ground-truth）', () => {
  it('base_repo 空 + repo=cecelia → ls-remote 命令串走 GitHub URL，不走 origin', () => {
    const execCmd = vi.fn(() => '');
    const out = observeProposalBranch({
      taskPayload: { repo: 'cecelia' },
      shortTask: SHORT_TASK,
      shortRun: SHORT_RUN,
      execCmd,
      legacyBranchesForRun: new Set(),
    });
    const lsCalls = execCmd.mock.calls.map((c) => String(c[0])).filter((c) => c.includes('ls-remote'));
    expect(lsCalls.length).toBeGreaterThanOrEqual(1);
    expect(lsCalls.some((c) => c.includes('https://github.com/perfectuser21/cecelia.git'))).toBe(true);
    // 禁退本地 origin：ls-remote 目标不得是裸 origin。
    expect(lsCalls.some((c) => /ls-remote\s+--heads\s+origin\b/.test(c))).toBe(false);
    expect(out.proposalRemoteUnresolved).toBe(false);
  });

  it('base_repo 与 repo 皆空 → 不执行 ls-remote origin，proposalRemoteUnresolved=true，rn=0', () => {
    const execCmd = vi.fn(() => '');
    const out = observeProposalBranch({
      taskPayload: {},
      shortTask: SHORT_TASK,
      shortRun: SHORT_RUN,
      execCmd,
      legacyBranchesForRun: new Set(),
    });
    const lsCalls = execCmd.mock.calls.map((c) => String(c[0])).filter((c) => c.includes('ls-remote'));
    expect(lsCalls.length).toBe(0);
    expect(out.proposalRemoteUnresolved).toBe(true);
    expect(out.proposeBranchRn).toBe(0);
  });
});

describe('observeProposalBranch 回归夹具（run 7a8e5319 复现 rn=0→rn=1）', () => {
  it('假 ls-remote 对 GitHub URL 返两条 propose 分支、对 origin 返空 → 新码 rn=1', () => {
    // 假 exec：只有走 GitHub URL 的 ls-remote 才返回两条分支；走 origin 返空。
    // 旧码退 origin → rn=0（生产误判）；新码走 URL → rn=1。
    const execCmd = vi.fn((cmd) => {
      const s = String(cmd);
      if (s.includes('ls-remote') && s.includes('github.com/perfectuser21/cecelia')) {
        return LS_REMOTE_OUTPUT;
      }
      return '';
    });
    const out = observeProposalBranch({
      taskPayload: { base_repo: '', repo: 'cecelia' },
      shortTask: SHORT_TASK,
      shortRun: SHORT_RUN,
      execCmd,
      legacyBranchesForRun: new Set(),
    });
    expect(out.proposeBranchRn).toBe(1);
    expect(out.proposeBranch).toBe(BRANCH_A13); // 最高 attempt 胜出
    expect(out.proposeBranchSha).toBe(A13_SHA);
    expect(out.proposalRemoteUnresolved).toBe(false);
  });

  it('假 ls-remote 仅对 origin 返分支（模拟旧码退 origin 的本地 workspace）→ rn=0', () => {
    // 新码不查 origin，故 URL 命令返空 → rn=0；这条锚定「退 origin 即误判」的根因。
    const execCmd = vi.fn((cmd) => {
      const s = String(cmd);
      if (s.includes('ls-remote') && /\borigin\b/.test(s)) return LS_REMOTE_OUTPUT;
      return '';
    });
    const out = observeProposalBranch({
      taskPayload: { base_repo: '', repo: 'cecelia' },
      shortTask: SHORT_TASK,
      shortRun: SHORT_RUN,
      execCmd,
      legacyBranchesForRun: new Set(),
    });
    expect(out.proposeBranchRn).toBe(0);
  });
});
