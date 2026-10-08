// build 活动：用 claude CLI 按 02-spec.md 的每条 S-n 以 TDD 写代码并在当前分支提交，写 <sprint_dir>/03-build.md。
// 程序只做后置检查：远端未变、历史未改写、md 链未被改/未被提交、03 合规、HEAD 前进、无新的未提交改动、未碰 agent 配置。
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

const SPEC_FILE = '02-spec.md';
const BUILD_FILE = '03-build.md';
const SPEC_ID_RE = /^S-\d+$/;
// 默认 = budget 2400s - 90s：超时由本活动先报 claude_timeout，并给 claude 退出后的检查阶段（含 ls-remote）留余量
const TIMEOUT = { envVar: 'CODING_WF_BUILD_TIMEOUT_MS', defaultMs: 2310000, reserveMs: 75000 };
// 允许 Bash 跑测试；deny 优先于 allow，推送与开 PR 留给 publish
const CLAUDE_TOOLS = ['--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'];

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

await runActivity(async (input) => {
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
  const failure = claudeFailure(run) ?? (await guardFailure({ worktree, dir, sprintDir, input, before }));
  if (failure) return failure;

  if (!fs.existsSync(buildPath)) return fail('fatal', 'build_report_missing');
  const errors = reportErrors(fs.readFileSync(buildPath, 'utf8'), { taskId: input.task_id, step: 'build', coversFile: SPEC_FILE, ids });
  if (errors.length > 0) return fail('fatal', 'build_report_invalid', { evidence: [{ errors }] });
  const commits = (await gitOut(worktree, ['rev-list', '--reverse', `${headBefore}..HEAD`]) ?? '').split('\n').filter(Boolean);
  if (commits.length === 0) return fail('fatal', 'build_no_commit');
  const uncommitted = await outOfScopeChanges(worktree, sprintDir, before.changes, 'build');
  if (uncommitted.length > 0) return fail('fatal', 'build_uncommitted', { evidence: [{ uncommitted_changes: uncommitted }] });
  // sprint 目录只允许新增/修改 03（CLAUDE.md、.claude/ 等放进 sprint 目录同样会影响后续会话）
  const polluted = await sprintChangesExcept(worktree, sprintDir, before.changes, BUILD_FILE, 'build');
  if (polluted.length > 0) return fail('fatal', 'build_sprint_polluted', { evidence: [{ files: polluted }] });
  const changed = await changedFilesSince(worktree, headBefore);
  if (changed === null) return gitCheckFailed('diff --name-only');
  const agentFiles = agentConfigFiles(changed);
  if (agentFiles.length > 0) return fail('fatal', 'build_touched_agent_config', { evidence: [{ files: agentFiles }] });

  return {
    status: 'completed',
    outputs: { build_file: BUILD_FILE, build_commits: commits },
    evidence: [`${BUILD_FILE} 已生成，${commits.length} 个提交`],
  };
});
