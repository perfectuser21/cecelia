#!/usr/bin/env node
/**
 * 独立行为 oracle（非 vitest；evaluator manual:bash 直接跑）——
 * 复现生产 run 7a8e5319 / task ff2b0fa9 的提案分支观测：
 * 假 ls-remote 对 GitHub URL 返回两条 propose 分支、对 origin 返回空。
 * 实调 ground-truth 导出的 observeProposalBranch（真实 rN 计数逻辑，非 mock）。
 *
 * 断言：base_repo 空 + repo=cecelia → observeProposalBranch 用 GitHub URL 观测到 rn>=1；
 *       base_repo 与 repo 皆空 → 不发 ls-remote、proposalRemoteUnresolved===true。
 * 未实现导出时抛错退非 0（RED）；实现后打印 OK 退 0（GREEN）。
 */
import { observeProposalBranch, resolveProposalRemote } from '../../../packages/brain/src/orchestrator/ground-truth.js';

const urlBranches = [
  '7f413df5aaaa\trefs/heads/cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a10',
  '7e78cee1bbbb\trefs/heads/cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a13',
].join('\n');

const calls = [];
const fakeExec = (cmd) => {
  calls.push(cmd);
  return cmd.includes('https://github.com/perfectuser21/cecelia.git') ? urlBranches : '';
};

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// 1) 有 repo 兜底 → 用 URL 观测 rn=1
const resolved = observeProposalBranch({
  execCmd: fakeExec,
  taskPayload: { base_repo: '', repo: 'cecelia' },
  shortTask: 'ff2b0fa9',
  shortRun: '7a8e5319',
  legacyBranchesForRun: new Set(),
});
if (resolved.proposeBranchRn < 1) fail(`期望 rn>=1，实得 ${resolved.proposeBranchRn}`);
if (resolved.proposalRemoteUnresolved !== false) fail('resolved 场景 unresolved 应为 false');
const lsCall = calls.find((c) => c.includes('git ls-remote'));
if (!lsCall || !lsCall.includes('https://github.com/perfectuser21/cecelia.git')) {
  fail('ls-remote 未命中 GitHub URL');
}
if (/git ls-remote --heads origin\b/.test(lsCall)) fail('禁止退回 origin');

// 2) 皆空 → 不发 ls-remote、unresolved=true
const calls2 = [];
const unresolved = observeProposalBranch({
  execCmd: (cmd) => { calls2.push(cmd); return ''; },
  taskPayload: {},
  shortTask: 'ff2b0fa9',
  shortRun: '7a8e5319',
  legacyBranchesForRun: new Set(),
});
if (unresolved.proposalRemoteUnresolved !== true) fail('皆空场景 unresolved 应为 true');
if (calls2.some((c) => /git ls-remote/.test(c))) fail('皆空场景禁止执行 ls-remote origin');

// 3) resolveProposalRemote 纯函数一致性
const pure = resolveProposalRemote({ base_repo: '', repo: 'cecelia' });
if (pure.unresolved !== false || !String(pure.remote).includes('https://github.com/perfectuser21/cecelia.git')) {
  fail('resolveProposalRemote 未解析到 GitHub URL');
}

console.log('OK: observeProposalBranch 用 GitHub URL 观测 rn=1，皆空不退 origin');
