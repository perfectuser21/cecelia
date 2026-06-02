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
 * 将 GitHub token 注入 HTTPS GitHub URL，用于 private repo 认证。
 * 对非 HTTPS URL 或已含认证信息的 URL 原样返回（幂等）。
 *
 * @param {string} url
 * @param {string|null|undefined} token
 * @returns {string}
 */
export function injectToken(url, token) {
  if (!token) return url;
  if (!url.startsWith('https://github.com/')) return url;
  return url.replace('https://', `https://x-access-token:${token}@`);
}

/**
 * 验 proposer 节点真把 propose_branch + sprintDir/task-plan.json push 到 origin。
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath - generator worktree（用来跑 git 命令）
 * @param {string} opts.branch - propose_branch 名
 * @param {string} opts.sprintDir - 'sprints/w8-langgraph-vN'
 * @param {string} [opts.baseRepo] - 主仓库（读 origin URL）
 * @param {Function} [opts.execFn] - 测试注入
 * @param {string} [opts.githubToken] - GitHub token，用于 private repo 认证
 * @throws {ContractViolation}
 */
export async function verifyProposerOutput(opts) {
  const { worktreePath, branch, sprintDir, execFn = execFile, githubToken } = opts;
  const baseRepo = opts.baseRepo || '/Users/administrator/perfect21/cecelia';

  // H17: baseRepo が remote URL（GitHub/SSH）の場合はそのまま githubUrl として使用。
  // git -C <url> はディレクトリ変更を試みるため URL では fatal になる。
  let githubUrl;
  if (/^(https?|ssh|git):\/\//.test(baseRepo)) {
    githubUrl = baseRepo;
  } else {
    // local path — baseRepo の origin remote から GitHub URL を読む
    try {
      const { stdout } = await execFn('git', ['-C', baseRepo, 'remote', 'get-url', 'origin'], {});
      githubUrl = stdout.trim();
    } catch (err) {
      throw new ContractViolation(
        `verifyProposerOutput: cannot read GitHub URL from baseRepo origin: ${err.message}`,
        { stage: 'github_url' },
      );
    }
  }

  // 1. ls-remote 验 branch 真在 origin
  try {
    const authedUrl = injectToken(githubUrl, githubToken);
    const { stdout } = await execFn('git', ['ls-remote', authedUrl, branch], {});
    if (!stdout.trim()) {
      throw new ContractViolation(
        `proposer_didnt_push: branch '${branch}' not found on origin (${githubUrl})`,
        { branch, githubUrl, stage: 'ls_remote' },
      );
    }
  } catch (err) {
    if (err instanceof ContractViolation) throw err;
    throw new ContractViolation(
      `verifyProposerOutput: ls-remote failed for ${branch}: ${err.message}`,
      { branch, stage: 'ls_remote_exec' },
    );
  }

  // 2. fetch 该 branch 然后 git show task-plan.json
  const taskPlanPath = `${sprintDir}/task-plan.json`;
  let content;
  try {
    const authedFetchUrl = injectToken(githubUrl, githubToken);
    await execFn('git', ['fetch', authedFetchUrl, `${branch}:refs/remotes/origin/${branch}`], { cwd: worktreePath });
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
 * 验 GAN 合同轮 proposer 真把【合同】（contract-draft.md / sprint-contract.md）push 到 origin 的 propose 分支。
 *
 * 与 verifyProposerOutput（验 task-plan.json）的关键区别 —— 这是修 GAN 永不收敛的根因：
 * GAN 每轮 proposer 的真实交付物是【合同】（reviewer 每轮审的就是它，GAN 收敛的也是它）。
 * task-plan.json 是 GAN 收敛【后】下游 inferTaskPlanNode 才读的产物，proposer SKILL 的 git add
 * 对它用 `2>/dev/null` 容忍 LLM 偶发漏写、inferTaskPlanNode 有 B32 兜底（代 push / fallback）。
 * 用 task-plan.json 当"proposer 这轮到底有没有产出（vs 被 429 静默吞掉）"的信号，会在
 * 合同有效但漏 task-plan.json 时误判 proposer_didnt_push → #3229 起连续 2 轮即 ABORT GAN，
 * pipeline 永远进不了 generator（H15 #2867 起潜伏，#3229 去掉 .catch 后致命暴露）。
 * 故 GAN 的 verifyProposer 必须验合同产物，不验 task-plan.json。
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath - 跑 git 命令的 worktree
 * @param {string} opts.branch - propose_branch 名
 * @param {string} opts.sprintDir
 * @param {string} [opts.baseRepo] - 读 origin URL
 * @param {Function} [opts.execFn] - 测试注入
 * @throws {ContractViolation}
 */
export async function verifyContractProposerOutput(opts) {
  const { worktreePath, branch, sprintDir, execFn = execFile } = opts;
  const baseRepo = opts.baseRepo || '/Users/administrator/perfect21/cecelia';

  // H17: baseRepo 是 remote URL（GitHub/SSH）直接用；否则从本地 origin remote 读 URL
  let githubUrl;
  if (/^(https?|ssh|git):\/\//.test(baseRepo)) {
    githubUrl = baseRepo;
  } else {
    try {
      const { stdout } = await execFn('git', ['-C', baseRepo, 'remote', 'get-url', 'origin']);
      githubUrl = stdout.trim();
    } catch (err) {
      throw new ContractViolation(
        `verifyContractProposerOutput: cannot read GitHub URL from baseRepo origin: ${err.message}`,
        { stage: 'github_url' },
      );
    }
  }

  // 1. ls-remote 验 branch 真在 origin（proposer 被 429 静默吞掉时分支根本不存在）
  try {
    const { stdout } = await execFn('git', ['ls-remote', githubUrl, branch]);
    if (!stdout.trim()) {
      throw new ContractViolation(
        `proposer_didnt_push: branch '${branch}' not found on origin (${githubUrl})`,
        { branch, githubUrl, stage: 'ls_remote' },
      );
    }
  } catch (err) {
    if (err instanceof ContractViolation) throw err;
    throw new ContractViolation(
      `verifyContractProposerOutput: ls-remote failed for ${branch}: ${err.message}`,
      { branch, stage: 'ls_remote_exec' },
    );
  }

  // 2. fetch 分支后 git show 合同文件（reviewer APPROVED 会把 contract-draft.md rename → sprint-contract.md）
  const candidates = [`${sprintDir}/contract-draft.md`, `${sprintDir}/sprint-contract.md`];
  try {
    await execFn('git', ['fetch', githubUrl, `${branch}:refs/remotes/origin/${branch}`], { cwd: worktreePath });
  } catch (err) {
    throw new ContractViolation(
      `proposer_didnt_push: branch '${branch}' fetch failed: ${err.message}`,
      { branch, stage: 'fetch' },
    );
  }
  let content = null;
  const showErrors = [];
  for (const p of candidates) {
    try {
      const { stdout } = await execFn('git', ['show', `origin/${branch}:${p}`], { cwd: worktreePath });
      content = stdout;
      break;
    } catch (err) {
      showErrors.push(`${p}: ${err.message}`);
    }
  }
  if (content === null) {
    throw new ContractViolation(
      `proposer_didnt_push: branch '${branch}' missing contract file (${candidates.join(' | ')}): ${showErrors.join('; ')}`,
      { branch, candidates, stage: 'git_show' },
    );
  }

  // 3. 合同非空（防 proposer 推了空壳）
  if (!content.trim()) {
    throw new ContractViolation(
      `proposer_empty_contract: branch '${branch}' 合同文件为空`,
      { branch, stage: 'empty' },
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
