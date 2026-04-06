/**
 * PR Shepherd（牧羊人）- 主动追踪 open PR 的 CI 状态并触发自动合并
 *
 * 职责：
 * 1. 查询所有 pr_url IS NOT NULL AND pr_status IN ('open', 'ci_pending') 的任务
 * 2. 调用 gh CLI 检查每个 PR 的 CI 状态和 mergeable 属性
 * 3. 根据结果更新 pr_status：
 *    - CI 全通过 + mergeable → ci_passed，执行 gh pr merge --squash --auto
 *    - CI 失败 → ci_failed，提取失败类型，重派 /dev（最多 2 次）或 quarantine
 *    - 已合并 → merged，更新 pr_merged_at
 *    - 已关闭 → closed
 * 4. 异常时记录日志但不阻断 tick 主流程
 *
 * 注意：纯代码实现，不引入新 LLM agent。
 */

import { execSync } from 'child_process';

// 最多允许的 CI 修复重试次数
const MAX_CI_RETRY = 2;

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
  try {
    const output = execSync(
      `gh pr view "${prUrl}" --json state,statusCheckRollup,mergeable`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output);

    const state = data.state || 'UNKNOWN'; // OPEN, MERGED, CLOSED
    const mergeable = data.mergeable || 'UNKNOWN'; // MERGEABLE, CONFLICTING, UNKNOWN
    const checks = data.statusCheckRollup || [];

    // 分析 CI 状态
    const failedChecks = checks.filter(c =>
      c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' || c.conclusion === 'ACTION_REQUIRED'
    );
    const pendingChecks = checks.filter(c =>
      c.conclusion === null || c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING'
    );

    let ciStatus;
    if (state === 'MERGED') {
      ciStatus = 'merged';
    } else if (state === 'CLOSED') {
      ciStatus = 'closed';
    } else if (failedChecks.length > 0) {
      ciStatus = 'ci_failed';
    } else if (pendingChecks.length > 0 || checks.length === 0) {
      ciStatus = 'ci_pending';
    } else {
      // 全部通过（checks 存在且无失败无 pending）
      ciStatus = 'ci_passed';
    }

    return {
      state,
      mergeable,
      ciStatus,
      failedChecks: failedChecks.map(c => c.name || c.context || 'unknown'),
      allPassed: failedChecks.length === 0 && pendingChecks.length === 0 && checks.length > 0,
    };
  } catch (err) {
    throw new Error(`gh pr view failed for ${prUrl}: ${err.message}`);
  }
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
  try {
    execSync(`gh pr merge "${prUrl}" --squash --auto`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
        AND pr_status IN ('open', 'ci_pending')
        AND status NOT IN ('quarantined', 'cancelled')
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

      } else if (prInfo.ciStatus === 'ci_passed' && prInfo.mergeable === 'MERGEABLE') {
        // CI 全通过且可合并 → 执行 auto-merge
        try {
          executeMerge(task.pr_url);
          await pool.query(
            `UPDATE tasks SET pr_status = 'ci_passed' WHERE id = $1`,
            [task.id]
          );
          console.log(`[shepherd] PR auto-merge 已触发: ${task.title}`);
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
                  pr_status = NULL,
                  pr_url = NULL,
                  pr_merged_at = NULL,
                  retry_count = retry_count + 1,
                  completed_at = NULL,
                  payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
             WHERE id = $1`,
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

      } else if (prInfo.ciStatus === 'ci_passed' && prInfo.mergeable !== 'MERGEABLE') {
        // CI 通过但有冲突或 mergeable 未知，暂不处理
        await pool.query(`UPDATE tasks SET pr_status = 'ci_passed' WHERE id = $1`, [task.id]);
        console.log(`[shepherd] CI 通过但 mergeable=${prInfo.mergeable}: ${task.title}`);
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
