// SPDX-License-Identifier: MIT
// H15 — contract-verify.js 治本第一步
// Spec: docs/superpowers/specs/2026-05-10-h15-contract-verify-design.md
//
// 8 days 12+ critical bug 同根因 — 把 docker exit_code=0 当节点 success，没主动验副作用。
// 本 module 抽 SSOT helper：每节点显式校副作用真发生，失败 throw ContractViolation
// → LangGraph retryPolicy 自动 retry 3 次。

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const execFile = promisify(execFileCb);

/**
 * Contract violation = 节点产出与契约不符。
 * LangGraph retryPolicy.retryOn 默认 retry 普通 Error；不在 PERMANENT_ERROR_RE 名单上 → retry。
 */
export class ContractViolation extends Error {
  constructor(msg, details = {}) {
    super(msg);
    this.name = 'ContractViolation';
    this.details = details;
  }
}

/**
 * 验 proposer 节点真把 propose_branch + sprintDir/task-plan.json push 到 origin。
 * 若 branch 不在 origin 且传入 githubToken，brain 代为 git push（worktree commits 已存在）。
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath - generator worktree（用来跑 git 命令）
 * @param {string} opts.branch - propose_branch 名
 * @param {string} opts.sprintDir - 'sprints/w8-langgraph-vN'
 * @param {string} [opts.baseRepo] - 主仓库（读 origin URL）
 * @param {string} [opts.githubToken] - 若传入，branch 缺失时 brain 代为 push
 * @param {Function} [opts.execFn] - 测试注入
 * @throws {ContractViolation}
 */
export async function verifyProposerOutput(opts) {
  const { worktreePath, branch, sprintDir, githubToken, execFn = execFile } = opts;
  const baseRepo = opts.baseRepo || '/Users/administrator/perfect21/cecelia';

  // 显式从 baseRepo 读 GitHub URL（worktree 的 origin remote 可能是本地路径）
  let githubUrl;
  try {
    const { stdout } = await execFn('git', ['-C', baseRepo, 'remote', 'get-url', 'origin']);
    githubUrl = stdout.trim();
  } catch (err) {
    throw new ContractViolation(
      `verifyProposerOutput: cannot read GitHub URL from baseRepo origin: ${err.message}`,
      { stage: 'github_url' },
    );
  }

  // 1. ls-remote 验 branch 真在 origin；缺失时 brain 代为 push（B32）
  let branchOnOrigin = false;
  try {
    const { stdout } = await execFn('git', ['ls-remote', githubUrl, branch]);
    branchOnOrigin = !!stdout.trim();
  } catch (err) {
    throw new ContractViolation(
      `verifyProposerOutput: ls-remote failed for ${branch}: ${err.message}`,
      { branch, stage: 'ls_remote_exec' },
    );
  }

  if (!branchOnOrigin) {
    if (githubToken) {
      // B32: proposer 容器没跑 git push，但 worktree commits 已存在 → brain 代为 push
      const pushUrl = githubUrl.replace(/^https:\/\//, `https://${githubToken}@`);
      console.warn(`[contract-verify] branch '${branch}' missing on origin — brain pushing from worktree (B32)`);
      try {
        await execFn('git', ['-C', worktreePath, 'push', pushUrl, `${branch}:${branch}`]);
      } catch (pushErr) {
        throw new ContractViolation(
          `proposer_didnt_push: brain fallback push failed for '${branch}': ${pushErr.message}`,
          { branch, githubUrl, stage: 'brain_push' },
        );
      }
      // 复验：push 后再确认 origin 有该 branch
      try {
        const { stdout: afterPush } = await execFn('git', ['ls-remote', githubUrl, branch]);
        if (!afterPush.trim()) {
          throw new ContractViolation(
            `proposer_didnt_push: branch '${branch}' still missing after brain push`,
            { branch, githubUrl, stage: 'ls_remote_after_push' },
          );
        }
      } catch (err) {
        if (err instanceof ContractViolation) throw err;
        throw new ContractViolation(
          `verifyProposerOutput: ls-remote (post-push) failed for ${branch}: ${err.message}`,
          { branch, stage: 'ls_remote_after_push_exec' },
        );
      }
    } else {
      throw new ContractViolation(
        `proposer_didnt_push: branch '${branch}' not found on origin (${githubUrl})`,
        { branch, githubUrl, stage: 'ls_remote' },
      );
    }
  }

  // 2. fetch 该 branch 然后 git show task-plan.json
  const taskPlanPath = `${sprintDir}/task-plan.json`;
  let content;
  try {
    await execFn('git', ['fetch', githubUrl, `${branch}:refs/remotes/origin/${branch}`], { cwd: worktreePath });
    const { stdout } = await execFn('git', ['show', `origin/${branch}:${taskPlanPath}`], { cwd: worktreePath });
    content = stdout;
  } catch (err) {
    throw new ContractViolation(
      `proposer_didnt_push: branch '${branch}' missing ${taskPlanPath}: ${err.message}`,
      { branch, taskPlanPath, stage: 'git_show' },
    );
  }

  // 3. parseable + tasks.length >= 1
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ContractViolation(
      `proposer_invalid_task_plan: ${taskPlanPath} 不是 valid JSON: ${err.message}`,
      { taskPlanPath, stage: 'parse' },
    );
  }
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length < 1) {
    throw new ContractViolation(
      `proposer_empty_task_plan: ${taskPlanPath} 缺 tasks array 或为空`,
      { taskPlanPath, parsed, stage: 'tasks_count' },
    );
  }
}

/**
 * 验 generator 节点真创了 PR + diff 含 requiredArtifacts。
 *
 * @param {Object} opts
 * @param {string} opts.pr_url - 'https://github.com/perfectuser21/cecelia/pull/N'
 * @param {string[]} [opts.requiredArtifacts] - 必须出现在 PR diff 里的相对路径列表（空/缺省则跳过 diff 校验）
 * @param {Function} [opts.execFn]
 * @throws {ContractViolation}
 */
export async function verifyGeneratorOutput(opts) {
  const { pr_url, requiredArtifacts = [], execFn = execFile } = opts;
  if (!pr_url || typeof pr_url !== 'string') {
    throw new ContractViolation(
      `generator_no_pr_url: pr_url is null/empty (容器 stdout 没解析到 PR URL)`,
      { pr_url, stage: 'pr_url_missing' },
    );
  }
  // gh pr view 验 PR 真存在
  try {
    await execFn('gh', ['pr', 'view', pr_url, '--json', 'number,state']);
  } catch (err) {
    throw new ContractViolation(
      `generator_pr_not_found: gh pr view ${pr_url} 失败: ${err.message}`,
      { pr_url, stage: 'gh_view' },
    );
  }
  // gh pr diff 验 requiredArtifacts 真出现在 diff
  if (Array.isArray(requiredArtifacts) && requiredArtifacts.length > 0) {
    let diffOut;
    try {
      const { stdout } = await execFn('gh', ['pr', 'diff', pr_url]);
      diffOut = stdout;
    } catch (err) {
      throw new ContractViolation(
        `generator_pr_diff_failed: gh pr diff ${pr_url} 失败: ${err.message}`,
        { pr_url, stage: 'gh_diff' },
      );
    }
    const missing = requiredArtifacts.filter((p) => !diffOut.includes(p));
    if (missing.length > 0) {
      throw new ContractViolation(
        `generator_missing_artifacts: PR ${pr_url} diff 缺 ${missing.length} file(s): ${missing.join(', ')}`,
        { pr_url, missing, stage: 'artifacts_in_diff' },
      );
    }
  }
}

/**
 * 验 evaluator worktree 含必要 contract artifacts。
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath
 * @param {string[]} opts.expectedFiles - 相对 worktreePath 的 path list
 * @param {Function} [opts.statFn]
 * @throws {ContractViolation}
 */
export async function verifyEvaluatorWorktree(opts) {
  const {
    worktreePath,
    expectedFiles,
    statFn = (p) => stat(p).then(() => true).catch(() => false),
  } = opts;
  const missing = [];
  for (const rel of expectedFiles) {
    const full = path.join(worktreePath, rel);
    const exists = await statFn(full);
    if (!exists) missing.push(rel);
  }
  if (missing.length > 0) {
    throw new ContractViolation(
      `evaluator_worktree_missing: ${missing.length} file(s) not in ${worktreePath}: ${missing.join(', ')}`,
      { worktreePath, missing, stage: 'files_exist' },
    );
  }
}
