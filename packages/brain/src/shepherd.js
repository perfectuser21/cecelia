/**
 * PR Shepherd（牧羊人）- 主动追踪 open PR 的 CI 状态并触发自动合并
 *
 * 职责：
 * 1. 查询所有 pr_url IS NOT NULL AND pr_status IN ('open', 'ci_pending') 的任务
 * 2. 调用 gh CLI 检查每个 PR 的 CI 状态和 mergeable 属性
 * 3. 根据结果更新 pr_status：
 *    - CI 全通过 + mergeable → ci_passed，执行 gh pr merge --squash
 *    - CI 失败 → ci_failed，提取失败类型，重派 /dev（最多 2 次）或 quarantine
 *    - 已合并 → merged，更新 pr_merged_at
 *    - 已关闭 → closed
 * 4. 异常时记录日志但不阻断 tick 主流程
 *
 * 注意：纯代码实现，不引入新 LLM agent。
 */

import { spawnSync } from 'child_process';
import { isValidGithubPrUrl } from './lib/callback-utils.js';

// 最多允许的 CI 修复重试次数
const MAX_CI_RETRY = 2;

// reconcileTerminalOpenPRs 低频 gate + 非重入 guard（Fix B）
let _reconcileRunning = false;
let _lastReconcileAt = 0;
const RECONCILE_MIN_INTERVAL_MS = 5 * 60 * 1000; // 最多每 5 分钟运行一次
const RECONCILE_BATCH_LIMIT = 5;               // 单次最多处理任务数（Fix B: 小批）
const RECONCILE_DEFAULT_BUDGET_MS = 25000;     // 单次总预算（Fix B: 严格短预算）

// CI check 失败类型分类关键词
const CI_FAIL_PATTERNS = {
  lint: /lint|format|eslint|prettier/i,
  test: /test|vitest|jest|coverage|spec/i,
  version_check: /version.?check|version.?sync|version.?mismatch|semver/i,
};

/**
 * 使用 gh CLI 检查单个 PR 的状态
 * @param {string} prUrl - PR URL
 * @returns {{ state: string, mergeable: string, ciStatus: string, failedChecks: string[], allPassed: boolean }}
 */
export function checkPrStatus(prUrl) {
  // Fix A: validate URL before any gh invocation (fail closed)
  if (!isValidGithubPrUrl(prUrl)) {
    throw new Error(`Invalid GitHub PR URL rejected: ${String(prUrl).slice(0, 80)}`);
  }

  // Fix A: use spawnSync with args array — no shell expansion of prUrl
  let baseData;
  try {
    const sp = spawnSync(
      'gh', ['pr', 'view', prUrl, '--json', 'state,mergeable'],
      { encoding: 'utf-8', timeout: 30000 }
    );
    if (sp.status !== 0) throw new Error(sp.stderr || 'gh exited non-zero');
    baseData = JSON.parse(sp.stdout);
  } catch (err) {
    throw new Error(`gh pr view failed for ${prUrl}: ${err.message}`);
  }

  const state = baseData.state || 'UNKNOWN';
  const mergeable = baseData.mergeable || 'UNKNOWN';

  // Short-circuit for terminal states — no CI check query needed.
  if (state === 'MERGED') {
    return { state, mergeable, ciStatus: 'merged', failedChecks: [], allPassed: true };
  }
  if (state === 'CLOSED') {
    return { state, mergeable, ciStatus: 'closed', failedChecks: [], allPassed: false };
  }

  // Fetch CI checks separately; PAT may lack checks:read scope — fall back to no-checks.
  let checks = [];
  try {
    const sp2 = spawnSync(
      'gh', ['pr', 'view', prUrl, '--json', 'statusCheckRollup'],
      { encoding: 'utf-8', timeout: 30000 }
    );
    if (sp2.status === 0) {
      checks = JSON.parse(sp2.stdout).statusCheckRollup || [];
    }
  } catch {
    checks = [];
  }

  const failedChecks = checks.filter(c =>
    c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' || c.conclusion === 'ACTION_REQUIRED'
  );
  const pendingChecks = checks.filter(c =>
    c.conclusion === null || c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING'
  );

  let ciStatus;
  if (failedChecks.length > 0) {
    ciStatus = 'ci_failed';
  } else if (pendingChecks.length > 0) {
    ciStatus = 'ci_pending';
  } else if (checks.length === 0) {
    // No CI check config (or failed to fetch) — caller decides based on mergeable.
    ciStatus = 'ci_no_checks';
  } else {
    ciStatus = 'ci_passed';
  }

  return {
    state,
    mergeable,
    ciStatus,
    failedChecks: failedChecks.map(c => c.name || c.context || 'unknown'),
    allPassed: failedChecks.length === 0 && pendingChecks.length === 0 && checks.length > 0,
  };
}

/**
 * 根据失败的 check 名称分类 CI 失败类型
 * @param {string[]} failedChecks - 失败的 check 名称列表
 * @returns {'lint' | 'test' | 'version_check' | 'other'}
 */
export function classifyFailedChecks(failedChecks) {
  const combined = failedChecks.join(' ');
  if (CI_FAIL_PATTERNS.version_check.test(combined)) return 'version_check';
  if (CI_FAIL_PATTERNS.lint.test(combined)) return 'lint';
  if (CI_FAIL_PATTERNS.test.test(combined)) return 'test';
  return 'other';
}

/**
 * 对单个 PR 任务执行 auto-merge
 * @param {string} prUrl
 * @returns {boolean} 是否执行成功
 */
export function executeMerge(prUrl) {
  // Fix A: validate URL + use spawnSync (no shell interpolation)
  if (!isValidGithubPrUrl(prUrl)) {
    throw new Error(`Invalid GitHub PR URL rejected for merge: ${String(prUrl).slice(0, 80)}`);
  }
  try {
    const sp = spawnSync(
      'gh', ['pr', 'merge', prUrl, '--squash'],
      { encoding: 'utf-8', timeout: 30000 }
    );
    if (sp.status !== 0) throw new Error(sp.stderr || 'gh pr merge exited non-zero');
    return true;
  } catch (err) {
    throw new Error(`gh pr merge failed for ${prUrl}: ${err.message}`);
  }
}

/**
 * PR Shepherd 主函数 - 在 tick maintenance 阶段调用
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ processed: number, merged: number, failed: number, pending: number, errors: number }>}
 */
export async function shepherdOpenPRs(pool) {
  const result = { processed: 0, merged: 0, failed: 0, pending: 0, errors: 0 };

  // 查询所有需要 shepherd 的任务
  let rows;
  try {
    const queryResult = await pool.query(`
      SELECT id, title, pr_url, pr_status, retry_count, payload
      FROM tasks
      WHERE pr_url IS NOT NULL
        AND pr_status IN ('open', 'ci_pending', 'ci_passed')
        AND status NOT IN ('quarantined', 'cancelled', 'failed', 'completed')
        -- Sprint 1: harness_mode PR 由 sub-graph merge_pr node 自管，shepherd 不动
        AND COALESCE(payload->>'harness_mode', 'false') NOT IN ('true', 't')
      ORDER BY updated_at ASC
      LIMIT 20
    `);
    rows = queryResult.rows;
  } catch (dbErr) {
    console.error('[shepherd] DB query failed (non-fatal):', dbErr.message);
    return result;
  }

  if (rows.length === 0) return result;

  console.log(`[shepherd] 检查 ${rows.length} 个 open PR...`);

  for (const task of rows) {
    result.processed++;

    try {
      const prInfo = checkPrStatus(task.pr_url);

      if (prInfo.state === 'MERGED' || prInfo.ciStatus === 'merged') {
        // PR 已被外部合并 → 同步关闭任务，触发 KR 进度链
        await pool.query(
          `UPDATE tasks
           SET pr_status = 'merged',
               pr_merged_at = COALESCE(pr_merged_at, NOW()),
               status = 'completed',
               completed_at = COALESCE(completed_at, NOW())
           WHERE id = $1 AND status != 'completed'`,
          [task.id]
        );
        console.log(`[shepherd] PR 已合并，任务标记完成: ${task.title} (${task.pr_url})`);
        result.merged++;

      } else if (prInfo.state === 'CLOSED' || prInfo.ciStatus === 'closed') {
        await pool.query(`UPDATE tasks SET pr_status = 'closed' WHERE id = $1`, [task.id]);
        console.log(`[shepherd] PR 已关闭: ${task.title}`);

      } else if (prInfo.ciStatus === 'ci_passed' && (prInfo.mergeable === 'MERGEABLE' || prInfo.mergeable === 'UNKNOWN')) {
        // CI 全通过且可合并（MERGEABLE）或 GitHub 尚未计算 mergeability（UNKNOWN）→ 尝试 auto-merge。
        // GitHub 对 OPEN PR 在未计算 mergeability 或 PR 刚被合并时均会返回 UNKNOWN；
        // UNKNOWN 是瞬态值，不代表有冲突——应尝试合并，让 GitHub 返回真实错误（若有）。
        // 若不尝试，UNKNOWN 会导致 shepherd 无限轮询永不收口（回归场景三）。
        try {
          executeMerge(task.pr_url);
          // 重读 PR 最新 state；若已 MERGED 则推进 status=completed
          let merged = false;
          try {
            const after = checkPrStatus(task.pr_url);
            merged = after.state === 'MERGED' || after.ciStatus === 'merged';
          } catch (reloadErr) {
            console.warn(`[shepherd] reload PR state 失败 (non-fatal): ${reloadErr.message}`);
          }
          if (merged) {
            await pool.query(
              `UPDATE tasks
                 SET pr_status = 'merged',
                     pr_merged_at = COALESCE(pr_merged_at, NOW()),
                     status = 'completed',
                     completed_at = COALESCE(completed_at, NOW())
               WHERE id = $1`,
              [task.id]
            );
            console.log(`[shepherd] auto-merge 成功并推进 completed: ${task.title}`);
          } else {
            await pool.query(
              `UPDATE tasks SET pr_status = 'ci_passed' WHERE id = $1`,
              [task.id]
            );
            console.log(`[shepherd] auto-merge 已触发但 PR 还未 MERGED: ${task.title}`);
          }
          result.merged++;
        } catch (mergeErr) {
          // merge 失败不阻断，保持 ci_passed，下次 tick 重试
          console.error(`[shepherd] auto-merge 失败 (non-fatal): ${mergeErr.message}`);
          await pool.query(
            `UPDATE tasks SET pr_status = 'ci_passed',
              payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
             WHERE id = $1`,
            [task.id, JSON.stringify({ shepherd_merge_error: mergeErr.message })]
          );
          result.errors++;
        }

      } else if (prInfo.ciStatus === 'ci_failed') {
        const failType = classifyFailedChecks(prInfo.failedChecks);
        const currentRetry = task.retry_count ?? 0;

        await pool.query(
          `UPDATE tasks SET pr_status = 'ci_failed',
            payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
           WHERE id = $1`,
          [task.id, JSON.stringify({
            ci_fail_type: failType,
            failed_checks: prInfo.failedChecks,
          })]
        );

        if (failType !== 'other' && currentRetry < MAX_CI_RETRY) {
          // 可自动修复类型：重排回 queued
          const retryContext = buildRetryContext(failType, prInfo.failedChecks, task.pr_url);
          await pool.query(
            `UPDATE tasks
              SET status = 'queued',
                  claimed_by = NULL,
                  claimed_at = NULL,
                  pr_status = NULL,
                  pr_url = NULL,
                  pr_merged_at = NULL,
                  retry_count = retry_count + 1,
                  completed_at = NULL,
                  payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
             WHERE id = $1
               AND status NOT IN ('completed', 'failed', 'cancelled', 'quarantined')`,
            [task.id, JSON.stringify({
              ci_fix_retry: true,
              ci_fix_context: retryContext,
              previous_pr_url: task.pr_url,
            })]
          );
          console.log(`[shepherd] CI 失败重排 (${failType}): ${task.title} retry=${currentRetry + 1}/${MAX_CI_RETRY}`);
          result.failed++;
        } else {
          // other 类型或超过最大重试 → quarantine
          try {
            const { quarantineTask } = await import('./quarantine.js');
            await quarantineTask(task.id, 'ci_failure', {
              failure_class: failType,
              failed_checks: prInfo.failedChecks,
              retry_count: currentRetry,
            });
            console.log(`[shepherd] CI 失败超限 quarantine: ${task.title} (type=${failType}, retry=${currentRetry})`);
          } catch (qErr) {
            console.error(`[shepherd] quarantine 失败 (non-fatal): ${qErr.message}`);
          }
          result.failed++;
        }

      } else if (prInfo.ciStatus === 'ci_pending') {
        // CI 还在跑，更新 pr_status
        if (task.pr_status !== 'ci_pending') {
          await pool.query(`UPDATE tasks SET pr_status = 'ci_pending' WHERE id = $1`, [task.id]);
        }
        result.pending++;

      } else if (prInfo.ciStatus === 'ci_passed' && prInfo.mergeable === 'CONFLICTING') {
        // CI 通过但有合并冲突 → 不尝试合并，等 agent 解决冲突后重新提交
        await pool.query(`UPDATE tasks SET pr_status = 'ci_passed' WHERE id = $1`, [task.id]);
        console.log(`[shepherd] CI 通过但 PR 有合并冲突 mergeable=CONFLICTING: ${task.title}`);
      }

    } catch (prErr) {
      console.error(`[shepherd] 检查 PR 失败 (non-fatal): ${task.title} - ${prErr.message}`);
      result.errors++;
    }
  }

  console.log(`[shepherd] 完成: processed=${result.processed} merged=${result.merged} failed=${result.failed} pending=${result.pending} errors=${result.errors}`);
  return result;
}

/**
 * 终态任务 PR 对账（missed-webhook reconciliation）
 *
 * 扫描 status=completed + pr_url IS NOT NULL + pr_status IN ('open','ci_pending','ci_passed')
 * + pr_merged_at IS NULL 的任务，向 GitHub 读取外部真相：
 *   - state=MERGED → 写 pr_status=merged, pr_merged_at, payload.run_status=merged, 清 current_run_id
 *   - 仍 OPEN/CONFLICTING/CI pending → 保持原状，等待下次 reconcile
 *
 * 禁止：requeue、retry_count+1、executeMerge、生成新 Run。
 *
 * @param {import('pg').Pool} pool
 * @param {object} [opts]
 * @param {number} [opts.budget_ms] - 单次总预算 ms（超限后跳过剩余任务）
 * @param {number} [opts.batch_limit] - 单次最多处理数量
 * @param {boolean} [opts._testForceGate] - 测试用：强制触发低频 gate 检查（跳过）
 * @returns {Promise<{ processed: number, reconciled: number, errors: number }>}
 */
/** 仅用于测试：重置模块级 gate 状态 */
export function _resetReconcileGateForTesting() {
  _reconcileRunning = false;
  _lastReconcileAt = 0;
}

export async function reconcileTerminalOpenPRs(pool, opts = {}) {
  // Fix B: 低频 gate — 生产约 78 候选，每次串行 30s×20 会拖垮 tick
  const budgetMs = opts.budget_ms ?? RECONCILE_DEFAULT_BUDGET_MS;
  const batchLimit = opts.batch_limit ?? RECONCILE_BATCH_LIMIT;

  // Fix B: 非重入 guard
  if (_reconcileRunning) {
    console.log('[shepherd:reconcile] 正在运行中，跳过（非重入）');
    return { processed: 0, reconciled: 0, errors: 0, skipped: true, reason: 'running' };
  }

  // Fix B: 低频 gate（_testForceGate=true 时强制触发 gate 拒绝，测试 gate 本身）
  if (opts._testForceGate) {
    return { processed: 0, reconciled: 0, errors: 0, skipped: true, reason: 'gate' };
  }
  const now = Date.now();
  if (_lastReconcileAt > 0 && (now - _lastReconcileAt) < RECONCILE_MIN_INTERVAL_MS) {
    return { processed: 0, reconciled: 0, errors: 0, skipped: true, reason: 'too_soon' };
  }

  _reconcileRunning = true;
  _lastReconcileAt = now;
  const startMs = now;
  const result = { processed: 0, reconciled: 0, errors: 0 };

  try {
    let rows;
    try {
      const queryResult = await pool.query(`
        SELECT id, title, pr_url, pr_status, payload
        FROM tasks
        WHERE pr_url IS NOT NULL
          AND status = 'completed'
          AND pr_status IN ('open', 'ci_pending', 'ci_passed')
          AND pr_merged_at IS NULL
          AND COALESCE(payload->>'harness_mode', 'false') NOT IN ('true', 't')
        ORDER BY updated_at ASC
        LIMIT ${batchLimit}
      `);
      rows = queryResult.rows;
    } catch (dbErr) {
      console.error('[shepherd:reconcile] DB query failed (non-fatal):', dbErr.message);
      return result;
    }

    if (rows.length === 0) return result;

    console.log(`[shepherd:reconcile] 对账 ${rows.length} 个 terminal+open PR 任务 (budget=${budgetMs}ms)...`);

    for (const task of rows) {
      // Fix B: 严格短总预算 — 超限后提前退出
      if (budgetMs > 0 && (Date.now() - startMs) >= budgetMs) {
        console.log(`[shepherd:reconcile] 总预算 ${budgetMs}ms 耗尽，提前退出（剩余 ${rows.length - result.processed} 任务延后）`);
        break;
      }

      result.processed++;
      try {
        // Fix A: canonical URL 校验（fail closed）
        if (!isValidGithubPrUrl(task.pr_url)) {
          console.error(`[shepherd:reconcile] 非法 pr_url 已拒绝（fail closed）: ${String(task.pr_url).slice(0, 80)}`);
          result.errors++;
          continue;
        }

        let prState;
        try {
          // Fix A: spawnSync with args array（无 shell 展开）
          const sp = spawnSync(
            'gh', ['pr', 'view', task.pr_url, '--json', 'state,mergeable,mergedAt'],
            { encoding: 'utf-8', timeout: 30000 }
          );
          if (sp.status !== 0) throw new Error(sp.stderr || 'gh exited non-zero');
          prState = JSON.parse(sp.stdout);
        } catch (ghErr) {
          console.warn(`[shepherd:reconcile] gh pr view 失败 (non-fatal): ${task.pr_url} — ${ghErr.message}`);
          result.errors++;
          continue;
        }

        if (prState.state === 'MERGED') {
          const mergedAt = prState.mergedAt || new Date().toISOString();
          const { rowCount } = await pool.query(
            `UPDATE tasks
             SET pr_status = 'merged',
                 pr_merged_at = $2::timestamptz,
                 payload = COALESCE(payload, '{}'::jsonb)
                   || jsonb_build_object('run_status', 'merged', 'current_run_id', NULL)
             WHERE id = $1
               AND pr_merged_at IS NULL`,
            [task.id, mergedAt]
          );
          // Fix E: 只有 rowCount>0 才计入 reconciled（rowCount=0 意味幂等跳过）
          if (rowCount > 0) {
            console.log(`[shepherd:reconcile] missed-webhook 补账: ${task.title} (${task.pr_url})`);
            result.reconciled++;
          }
        }
        // OPEN/CONFLICTING/CI pending → 不处理，保持原状等待下次 tick
      } catch (taskErr) {
        console.error(`[shepherd:reconcile] 对账失败 (non-fatal): ${task.title} - ${taskErr.message}`);
        result.errors++;
      }
    }

    console.log(`[shepherd:reconcile] 完成: processed=${result.processed} reconciled=${result.reconciled} errors=${result.errors}`);
    return result;
  } finally {
    _reconcileRunning = false;
  }
}

/**
 * 根据 CI 失败类型构建重试上下文
 * @param {string} failType
 * @param {string[]} failedChecks
 * @param {string} prUrl
 * @returns {string}
 */
function buildRetryContext(failType, failedChecks, prUrl) {
  const base = `[CI-FIX-RETRY] 上次 PR (${prUrl}) CI 失败，失败的 checks: ${failedChecks.join(', ')}。`;
  switch (failType) {
    case 'lint':
      return base + '请修复 lint/format 错误后重新提交 PR。';
    case 'test':
      return base + '请修复失败的测试用例后重新提交 PR。';
    case 'version_check':
      return base + '请同步版本号（package.json、package-lock.json、.brain-versions、DEFINITION.md）后重新提交 PR。';
    default:
      return base + '请分析 CI 错误日志并修复后重新提交 PR。';
  }
}
