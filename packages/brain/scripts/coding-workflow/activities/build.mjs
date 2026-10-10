// build 活动：用 claude CLI 按 02-spec.md 的每条 S-n 以 TDD 写代码并在当前分支提交，写 <sprint_dir>/03-build.md。
// 程序做后置检查：远端未变、历史未改写、md 链未被改/未被提交、03 合规、HEAD 前进、无新的未提交改动、未碰 agent 配置；
// 再跑 CI 门禁本地预检（lib/ci-precheck.mjs），红了起修复会话至多 2 轮，每轮修完重新过全部后置检查。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail } from '../lib/protocol.mjs';
import { parseFrontmatter, extractAnchors, reportErrors } from '../lib/md-chain.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, gitOut, headSha, snapshotChanges, outOfScopeChanges, sprintChangesExcept,
} from '../lib/claude.mjs';
import {
  chainTamperFailure, remoteChangeFailure, remoteSnapshot, currentBranch, isAncestor, changedFilesSince, agentConfigFiles,
} from '../lib/guards.mjs';
import { defaultChecks, runPrechecks } from '../lib/ci-precheck.mjs';
import { intentHeading, prKindOf } from '../lib/pr-kind.mjs';

const spend = { usd: 0 };

const SPEC_FILE = '02-spec.md';
const BUILD_FILE = '03-build.md';
const SPEC_ID_RE = /^S-\d+$/;
// 默认 = budget 2400s - 90s：超时由本活动先报 claude_timeout，并给 claude 退出后的检查阶段（含 ls-remote）留余量
const TIMEOUT = { envVar: 'CODING_WF_BUILD_TIMEOUT_MS', defaultMs: 2310000, reserveMs: 75000 };
// 允许 Bash 跑测试；deny 优先于 allow，推送与开 PR 留给 publish
const CLAUDE_TOOLS = ['--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'];
const PRECHECK_FIX_ROUNDS = 2;
const PRECHECK_FIX_TIMEOUT_MS = 10 * 60 * 1000;
const posInt = (v, d) => (/^[1-9][0-9]*$/.test(v ?? '') ? Number(v) : d);

/** 02-spec.md 里的全部 S-n；文件不存在返回 null。 */
function specIds(specPath) {
  if (!fs.existsSync(specPath)) return null;
  const text = fs.readFileSync(specPath, 'utf8');
  return extractAnchors(parseFrontmatter(text)?.body ?? text).filter((id) => SPEC_ID_RE.test(id));
}

/** git 查询本身失败：不能当成"没问题"，交给重试。 */
const gitCheckFailed = (check) => fail('retryable', 'git_check_failed', { evidence: [{ check }] });

/** 运行后检查：远端、历史/分支、md 链。有问题返回 fail，否则 null。 */
async function guardFailure({ worktree, dir, sprintDir, input, before }) {
  const remote = await remoteChangeFailure(worktree, before.remote);
  if (remote) return remote;
  const headAfter = await headSha(worktree);
  const branchAfter = await currentBranch(worktree);
  const ancestor = await isAncestor(worktree, before.head);
  if (ancestor === null) return gitCheckFailed('merge-base --is-ancestor');
  if (branchAfter !== before.branch || !ancestor) {
    const evidence = { head_before: before.head, head_after: headAfter, branch_before: before.branch, branch_after: branchAfter };
    return fail('fatal', 'build_history_rewritten', { evidence: [evidence] });
  }
  const tampered = chainTamperFailure(dir, input);
  if (tampered) return tampered;
  const committed = await changedFilesSince(worktree, before.head, sprintDir);
  if (committed === null) return gitCheckFailed('diff --name-only');
  if (committed.length > 0) return fail('fatal', 'chain_tampered', { evidence: [{ committed_sprint_files: committed }] });
  return null;
}

/** 会话结束后的工作区检查：无未提交改动、sprint 目录只动 03、不碰 agent 配置。有问题返回 fail，否则 null。 */
async function postFailure({ worktree, sprintDir, before }) {
  const uncommitted = await outOfScopeChanges(worktree, sprintDir, before.changes, 'build');
  if (uncommitted.length > 0) return fail('fatal', 'build_uncommitted', { evidence: [{ uncommitted_changes: uncommitted }] });
  // sprint 目录只允许新增/修改 03（CLAUDE.md、.claude/ 等放进 sprint 目录同样会影响后续会话）
  const polluted = await sprintChangesExcept(worktree, sprintDir, before.changes, BUILD_FILE, 'build');
  if (polluted.length > 0) return fail('fatal', 'build_sprint_polluted', { evidence: [{ files: polluted }] });
  const changed = await changedFilesSince(worktree, before.head);
  if (changed === null) return gitCheckFailed('diff --name-only');
  const agentFiles = agentConfigFiles(changed);
  if (agentFiles.length > 0) return fail('fatal', 'build_touched_agent_config', { evidence: [{ files: agentFiles }] });
  return null;
}

const failedNames = (results) => results.filter((r) => !r.ok).map((r) => r.name);

/**
 * CI 门禁本地预检（审计 P1 #4）：跑门禁 → 有红则起修复会话（至多 PRECHECK_FIX_ROUNDS 轮，每轮修完重新过全部后置检查）→ 重跑。
 * 修复会话越界（改合同/历史/agent 配置等）→ { failure }；修不好或会话失败 → 不卡链路，summary 标明未过的门禁交给 CI 与 CI 修复环。
 */
async function precheckLoop({ worktree, dir, sprintDir, input, before }) {
  const feature = prKindOf(intentHeading(dir)) === 'feat';
  const checks = process.env.CODING_WF_PRECHECKS ? JSON.parse(process.env.CODING_WF_PRECHECKS) : defaultChecks({ branch: before.branch, feature });
  const env = { PR_LABELS: feature ? 'feature' : '' };
  let results = await runPrechecks(worktree, { checks, env });
  let rounds = 0;
  while (failedNames(results).length > 0 && rounds < PRECHECK_FIX_ROUNDS) {
    rounds += 1;
    const failures = results.filter((r) => !r.ok).map((r) => `### ${r.name}\n\`\`\`\n${r.output_tail}\n\`\`\``).join('\n\n');
    const prompt = loadPrompt('ci-precheck-fix', {
      BRANCH: before.branch, SPRINT_DIR: dir, INTENT_PATH: path.join(dir, '01-intent.md'), SPEC_PATH: path.join(dir, SPEC_FILE), FAILURES: failures,
    });
    const timeoutMs = posInt(process.env.CODING_WF_PRECHECK_FIX_TIMEOUT_MS, PRECHECK_FIX_TIMEOUT_MS);
    const run = await runClaude({ args: ['-p', prompt, '--permission-mode', 'acceptEdits', ...CLAUDE_TOOLS], cwd: worktree, timeoutMs, tag: 'ci-precheck-fix', isolateRemote: true });
    spend.usd += run.cost_usd ?? 0;
    const violation = (await guardFailure({ worktree, dir, sprintDir, input, before })) ?? (await postFailure({ worktree, sprintDir, before }));
    if (violation) return { failure: violation };
    if (claudeFailure(run)) break;
    results = await runPrechecks(worktree, { checks, env });
  }
  const failures = failedNames(results);
  return { summary: { passed: failures.length === 0, rounds, failures } };
}

async function main(input) {
  const { worktree, sprint_dir: sprintDir } = input;
  const { dir } = validateBase(input);

  const specPath = path.join(dir, SPEC_FILE);
  const ids = specIds(specPath);
  if (ids === null) return fail('fatal', 'spec_missing');
  if (ids.length === 0) return fail('fatal', 'spec_ids_missing');
  const headBefore = await headSha(worktree);
  if (!headBefore) return fail('fatal', 'git_head_unavailable');

  const buildPath = path.join(dir, BUILD_FILE);
  const prompt = loadPrompt('build', {
    TASK_ID: input.task_id,
    SPEC_PATH: specPath,
    BUILD_PATH: buildPath,
    SPEC_IDS: ids.join(','),
    SPRINT_DIR: dir,
  });

  // 旧产物会被当成新产物，先删
  fs.rmSync(buildPath, { force: true });
  const before = {
    head: headBefore,
    branch: await currentBranch(worktree),
    remote: await remoteSnapshot(worktree),
    changes: await snapshotChanges(worktree),
  };
  // 运行前就查不到远端，事后无从比对：不启动 claude
  if (before.remote === null) return fail('retryable', 'remote_check_failed', { evidence: [{ remote_before: null }] });

  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', ...CLAUDE_TOOLS];
  const timeoutMs = claudeTimeoutMs(input.budget, TIMEOUT);
  const run = await runClaude({ args, cwd: worktree, timeoutMs, tag: 'build', isolateRemote: true });
  spend.usd += run.cost_usd ?? 0;
  const failure = claudeFailure(run) ?? (await guardFailure({ worktree, dir, sprintDir, input, before }));
  if (failure) return failure;

  if (!fs.existsSync(buildPath)) return fail('fatal', 'build_report_missing');
  const errors = reportErrors(fs.readFileSync(buildPath, 'utf8'), { taskId: input.task_id, step: 'build', coversFile: SPEC_FILE, ids });
  if (errors.length > 0) return fail('fatal', 'build_report_invalid', { evidence: [{ errors }] });
  const headAfterBuild = await headSha(worktree);
  if (headAfterBuild === headBefore) return fail('fatal', 'build_no_commit');
  const post = await postFailure({ worktree, sprintDir, before });
  if (post) return post;

  const precheck = await precheckLoop({ worktree, dir, sprintDir, input, before });
  if (precheck.failure) return precheck.failure;
  const commits = (await gitOut(worktree, ['rev-list', '--reverse', `${headBefore}..HEAD`]) ?? '').split('\n').filter(Boolean);

  return {
    status: 'completed',
    outputs: { build_file: BUILD_FILE, build_commits: commits, ci_precheck: precheck.summary },
    evidence: [`${BUILD_FILE} 已生成，${commits.length} 个提交；CI 门禁预检${precheck.summary.passed ? '通过' : `未过：${precheck.summary.failures.join('、')}`}`],
  };
}

// 会话花费进 metrics（审计 #35）：本活动所有 claude 会话累加，成功失败都计
await runActivity(async (input) => {
  const result = await main(input);
  return { ...result, metrics: { ...(result?.metrics ?? {}), cost_usd: Math.round(spend.usd * 10000) / 10000 } };
});
