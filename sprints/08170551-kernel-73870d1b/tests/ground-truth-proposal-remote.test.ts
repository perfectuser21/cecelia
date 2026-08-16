/**
 * 冻结合同测试 — ground-truth 提案分支 remote 解析 + 观测（修法 A）。
 *
 * Golden Path Step 2：ground-truth 以 `parseBaseRepo(base_repo) ?? parseBaseRepo(repo)`
 * 解析 proposalRemote；命中 GitHub URL 而非本地 origin；两者皆解析不到时**不退 origin**，
 * 置 proposalRemoteUnresolved=true 且不执行 `git ls-remote origin`。
 *
 * 目标（Generator 需从 ground-truth.js 导出，供 collectGroundTruth 内联块复用）：
 *   - resolveProposalRemote(taskPayload) -> { remote: string|null, unresolved: boolean }
 *   - observeProposalBranch({ execCmd, taskPayload, shortTask, shortRun, legacyBranchesForRun })
 *       -> { proposeBranchRn, proposalRemoteUnresolved, remote }
 *
 * 禁 mock 边：ground-truth ↔ git 子进程（外层进程边界，用注入的 execCmd 打桩，
 * 断言真实命令串与真实 rN 计数逻辑，非 mock 被改的解析逻辑本身）。
 */
import { describe, it, expect } from 'vitest';
import {
  resolveProposalRemote,
  observeProposalBranch,
} from '../../../packages/brain/src/orchestrator/ground-truth.js';

describe('resolveProposalRemote [BEHAVIOR]', () => {
  it('base_repo 空 + repo=cecelia 解析到 GitHub URL 而非 origin', () => {
    const r = resolveProposalRemote({ base_repo: '', repo: 'cecelia' });
    expect(r.unresolved).toBe(false);
    expect(r.remote).toContain('https://github.com/perfectuser21/cecelia.git');
    expect(r.remote).not.toBe('origin');
  });

  it('base_repo 为完整 URL 时直接解析', () => {
    const r = resolveProposalRemote({
      base_repo: 'https://github.com/perfectuser21/cecelia.git',
    });
    expect(r.unresolved).toBe(false);
    expect(r.remote).toContain('https://github.com/perfectuser21/cecelia.git');
  });

  it('base_repo 与 repo 皆空 unresolved 为 true 且 remote 不退 origin', () => {
    const r = resolveProposalRemote({});
    expect(r.unresolved).toBe(true);
    expect(r.remote).not.toBe('origin');
    expect(r.remote == null).toBe(true);
  });
});

describe('observeProposalBranch [BEHAVIOR]', () => {
  // 回归夹具：复现生产 run 7a8e5319 / task ff2b0fa9。
  // 假 ls-remote 对 GitHub URL 返回两条 propose 分支、对 origin 返回空。
  const shortTask = 'ff2b0fa9';
  const shortRun = '7a8e5319';
  const urlBranches = [
    '7f413df5aaaa\trefs/heads/cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a10',
    '7e78cee1bbbb\trefs/heads/cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a13',
  ].join('\n');

  function fakeExec(calls) {
    return (cmd) => {
      calls.push(cmd);
      if (cmd.includes('https://github.com/perfectuser21/cecelia.git')) return urlBranches;
      return ''; // origin / 其它 remote 返回空（复现旧码 rn=0）
    };
  }

  it('回归夹具 base_repo 空 repo=cecelia 用 GitHub URL 观测到 rn 等于 1', () => {
    const calls = [];
    const r = observeProposalBranch({
      execCmd: fakeExec(calls),
      taskPayload: { base_repo: '', repo: 'cecelia' },
      shortTask,
      shortRun,
      legacyBranchesForRun: new Set(),
    });
    expect(r.proposeBranchRn).toBe(1);
    expect(r.proposalRemoteUnresolved).toBe(false);
    // 断言真实发出的 ls-remote 命中 GitHub URL，而不是本地 origin
    const lsRemoteCall = calls.find((c) => c.includes('git ls-remote'));
    expect(lsRemoteCall).toContain('https://github.com/perfectuser21/cecelia.git');
    expect(lsRemoteCall).not.toMatch(/git ls-remote --heads origin\b/);
  });

  it('base_repo 与 repo 皆空 不执行 ls-remote origin 且 proposalRemoteUnresolved 为 true', () => {
    const calls = [];
    const r = observeProposalBranch({
      execCmd: fakeExec(calls),
      taskPayload: {},
      shortTask,
      shortRun,
      legacyBranchesForRun: new Set(),
    });
    expect(r.proposalRemoteUnresolved).toBe(true);
    expect(r.proposeBranchRn).toBe(0);
    // 关键：未解析出 remote 时禁止退回 origin 去执行 ls-remote
    expect(calls.some((c) => /git ls-remote/.test(c))).toBe(false);
  });
});
