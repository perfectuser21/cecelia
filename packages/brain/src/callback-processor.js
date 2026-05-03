/**
 * callback-processor.js
 *
 * 共享 execution callback 处理函数。
 * 由 callback-worker（队列消费）和 routes/execution.js（HTTP fallback）共同引用。
 */

import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { executeDecision as executeThalamusDecision } from './decision-executor.js';
import { generateTaskEmbeddingAsync } from './embedding-service.js';
import { publishTaskCompleted, publishTaskFailed } from './events/taskEvents.js';
import { emit as emitEvent } from './event-bus.js';
import { recordSuccess as cbSuccess, recordFailure as cbFailure } from './circuit-breaker.js';
import { notifyTaskCompleted } from './notifier.js';
import { raise } from './alerting.js';
import { handleTaskFailure } from './quarantine.js';
import { updateDesireFromTask } from './desire-feedback.js';
import { resolveRelatedFailureMemories } from './routes/shared.js';

/**
 * processExecutionCallback(data, pool)
 *
 * 核心 callback 处理逻辑：状态映射、task 更新、下游触发。
 * task result 写入使用条件更新（仅 result 为空时写入），保证幂等性。
 *
 * @param {object} data - callback 数据，与 HTTP body 字段集对应
 * @param {object} pool - pg pool 实例
 * @returns {Promise<{success: boolean, newStatus: string}>}
 */
export async function processExecutionCallback(data, pool) {
  const {
    task_id,
    run_id,
    checkpoint_id,
    status,
    result,
    pr_url,
    duration_ms,
    iterations,
    exit_code,
    stderr,
  } = data;

  if (!task_id) throw new Error('task_id is required');

  console.log(`[callback-processor] Processing callback for task ${task_id}, status: ${status}`);

  // 1. Status mapping
  // 兼容两套 callback contract：
  //   - bridge / cecelia-run.sh：'AI Done' / 'AI Failed' / 'AI Quota Exhausted'
  //   - docker-executor.writeDockerCallback：'success' / 'failed' / 'timeout'
  // docker-executor 与本处理器的 contract 不一致曾导致跑成功的容器任务卡在
  // in_progress，60min 后被 tick 误判超时 → 三次失败 quarantine（修于本次）。
  let newStatus;
  if (status === 'AI Done' || status === 'success') {
    newStatus = 'completed';
  } else if (status === 'AI Failed' || status === 'failed' || status === 'timeout') {
    newStatus = 'failed';
  } else if (status === 'AI Quota Exhausted') {
    newStatus = 'quota_exhausted';
  } else {
    newStatus = 'in_progress';
  }

  // P1-1: Dev task completed without PR → completed_no_pr
  if (newStatus === 'completed' && !pr_url) {
    try {
      const taskRow = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
      const taskType = taskRow.rows[0]?.task_type;
      const isDecomposition = taskRow.rows[0]?.payload?.decomposition;
      if (taskType === 'dev' && !isDecomposition) {
        const isHarness = taskRow.rows[0]?.payload?.harness_mode;
        if (!isHarness) {
          newStatus = 'completed_no_pr';
          console.warn(`[callback-processor] Dev task ${task_id} completed without PR → completed_no_pr`);
        }
      }
    } catch (prCheckErr) {
      console.error(`[callback-processor] PR check error (non-fatal): ${prCheckErr.message}`);
    }
  }

  // P1-0: terminal failure guard
  if (newStatus === 'completed') {
    try {
      const terminalCheck = await pool.query(
        `SELECT payload->>'failure_class' AS failure_class FROM tasks WHERE id = $1`,
        [task_id]
      );
      if (terminalCheck.rows[0]?.failure_class === 'pipeline_terminal_failure') {
        console.warn(`[callback-processor] 终态守卫命中：task=${task_id} failure_class=pipeline_terminal_failure，拒绝覆盖为 completed`);
        return { skipped: true, reason: 'terminal_failure_guard' };
      }
    } catch (terminalCheckErr) {
      console.error(`[callback-processor] terminal failure check error（降级继续）: ${terminalCheckErr.message}`);
    }
  }

  // 2. Build update payload
  const lastRunResult = {
    run_id,
    checkpoint_id,
    status,
    duration_ms,
    iterations,
    pr_url: pr_url || null,
    completed_at: new Date().toISOString(),
    result_summary: (result !== null && typeof result === 'object') ? result.result : result,
  };

  // 3. ATOMIC transaction: task UPDATE + decision_log + progress step
  const client = await pool.connect();
  let findingsValue = null;
  try {
    await client.query('BEGIN');

    const isCompleted = newStatus === 'completed';

    const findingsRaw = (result !== null && typeof result === 'object')
      ? (result.findings || result.result || result)
      : result;
    findingsValue = findingsRaw
      ? (typeof findingsRaw === 'string' ? findingsRaw : JSON.stringify(findingsRaw))
      : null;

    if (!findingsValue && isCompleted) {
      console.warn(`[callback-processor] Task ${task_id} completed with empty findings/result`);
    }

    let prNumber = null;
    if (pr_url) {
      const prMatch = pr_url.match(/\/pull\/(\d+)/);
      prNumber = prMatch ? parseInt(prMatch[1], 10) : null;
    }

    const isFailed = newStatus === 'failed';
    const isQuotaExhausted = newStatus === 'quota_exhausted';
    let errorMessage = null;
    let blockedDetail = null;
    if (isFailed) {
      if (result === null) {
        const ts = new Date().toISOString();
        const exitCodeStr = exit_code != null ? exit_code : 'N/A';
        let fallback = `[callback: result=null] task=${task_id} exit_code=${exitCodeStr} at ${ts} | callback received but result was null`;
        const stderrTail = stderr ? String(stderr).slice(-300) : '';
        if (stderrTail) fallback += ` | stderr: ${stderrTail}`;
        errorMessage = fallback;
      } else if (typeof result === 'object') {
        errorMessage = result.result || result.error || result.stderr || JSON.stringify(result);
      } else {
        errorMessage = String(result);
      }
      errorMessage = errorMessage.slice(0, 2000);
      const stderrSource = stderr
        || (result !== null && typeof result === 'object' ? result.stderr : null)
        || (typeof result === 'string' ? result : '');
      blockedDetail = JSON.stringify({
        exit_code: exit_code != null ? exit_code : 1,
        stderr_tail: String(stderrSource || '').slice(-500),
        timestamp: new Date().toISOString(),
      });
    }

    // result 列存执行元数据（duration_ms 等），使用条件写入（仅 result 为空时写入）保证幂等性
    const EXEC_META_KEYS = ['duration_ms', 'total_cost_usd', 'num_turns', 'input_tokens', 'output_tokens'];
    let execMetaJson = null;
    if (result !== null && typeof result === 'object') {
      const hasAnyMetaKey = EXEC_META_KEYS.some(k => k in result);
      if (hasAnyMetaKey) {
        const execMeta = {};
        for (const k of EXEC_META_KEYS) execMeta[k] = result[k] ?? 0;
        execMetaJson = JSON.stringify(execMeta);
      }
    }

    await client.query(`
      UPDATE tasks
      SET
        status = $2,
        payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
          'last_run_result', $3::jsonb,
          'run_status', $4::text,
          'pr_url', $5::text
        ) || CASE WHEN $7::text IS NOT NULL THEN jsonb_build_object('findings', $7::text) ELSE '{}'::jsonb END
          || CASE WHEN $8::integer IS NOT NULL THEN jsonb_build_object('metadata', jsonb_build_object('pr_number', $8::integer)) ELSE '{}'::jsonb END,
        result = CASE WHEN result IS NULL AND $12::jsonb IS NOT NULL THEN $12::jsonb ELSE result END,
        completed_at = CASE WHEN $6 THEN NOW() ELSE completed_at END,
        quota_exhausted_at = CASE WHEN $11 THEN NOW() ELSE quota_exhausted_at END,
        pr_url = COALESCE($5::text, pr_url),
        pr_status = CASE WHEN $5::text IS NOT NULL THEN 'open' ELSE pr_status END,
        error_message = CASE WHEN $9::text IS NOT NULL THEN $9::text ELSE error_message END,
        blocked_detail = CASE WHEN $10::jsonb IS NOT NULL THEN $10::jsonb ELSE blocked_detail END
      WHERE id = $1 AND status IN ('in_progress', 'queued', 'dispatched')
    `, [
      task_id, newStatus, JSON.stringify(lastRunResult), status, pr_url || null,
      isCompleted, findingsValue, prNumber, errorMessage, blockedDetail,
      isQuotaExhausted, execMetaJson,
    ]);

    // decision_log（带 WHERE NOT EXISTS 防重复写入）
    await client.query(`
      INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
      SELECT $1, $2, $3::jsonb, $4::jsonb, $5
      WHERE NOT EXISTS (
        SELECT 1 FROM decision_log
        WHERE trigger = 'execution-callback'
          AND llm_output_json->>'run_id' = $6
          AND llm_output_json->>'status' = $7
      )
    `, [
      'execution-callback',
      `Task ${task_id} execution completed with status: ${status}`,
      JSON.stringify({ task_id, run_id, status, iterations }),
      JSON.stringify(lastRunResult),
      status === 'AI Done' ? 'success' : 'failed',
      String(run_id || ''),
      String(status || ''),
    ]);

    // Progress step（非阻塞）
    try {
      const { recordProgressStep } = await import('./progress-ledger.js');
      await recordProgressStep(task_id, run_id, {
        sequence: 1,
        name: 'task_execution',
        type: 'execution',
        status: status === 'AI Done' ? 'completed' : 'failed',
        startedAt: null,
        completedAt: new Date(),
        durationMs: duration_ms || null,
        inputSummary: null,
        outputSummary: findingsValue ? findingsValue.substring(0, 500) : null,
        findings: result && typeof result === 'object' ? result : {},
        errorCode: status !== 'AI Done' ? 'execution_failed' : null,
        errorMessage: status !== 'AI Done' ? `Task execution failed with status: ${status}` : null,
        retryCount: iterations || 0,
        artifacts: { pr_url: pr_url || null },
        metadata: { checkpoint_id: checkpoint_id || null, original_status: status },
        confidenceScore: status === 'AI Done' ? 1.0 : 0.2,
      });
      console.log(`[callback-processor] Progress step recorded for task ${task_id}`);
    } catch (progressErr) {
      console.error(`[callback-processor] Progress step recording failed: ${progressErr.message}`);
    }

    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  // Clean up activeProcesses registry（after commit）
  try {
    const { removeActiveProcess } = await import('./executor.js');
    removeActiveProcess(task_id);
  } catch { /* ignore */ }

  console.log(`[callback-processor] Task ${task_id} updated to ${newStatus} (atomic)`);

  // quota_exhausted → billing pause
  if (newStatus === 'quota_exhausted') {
    try {
      const { setBillingPause } = await import('./executor.js');
      const resetAt = (result && typeof result === 'object' && result.quota_reset_at)
        ? result.quota_reset_at
        : new Date(Date.now() + 60 * 60 * 1000).toISOString();
      setBillingPause(resetAt, 'quota_exhausted', pool);
      console.log(`[callback-processor] Billing pause SET: quota_exhausted task=${task_id}, reset_at=${resetAt}`);
    } catch (bpErr) {
      console.warn(`[callback-processor] setBillingPause failed (non-fatal): ${bpErr.message}`);
    }
  }

  // completed_no_pr 自动重排
  const MAX_NO_PR_RETRY = 3;
  if (newStatus === 'completed_no_pr') {
    try {
      const retryRow = await pool.query('SELECT retry_count FROM tasks WHERE id = $1', [task_id]);
      const currentRetry = retryRow.rows[0]?.retry_count ?? 0;
      if (currentRetry < MAX_NO_PR_RETRY) {
        const nextRunAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await pool.query(
          `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
           retry_count = retry_count + 1,
           completed_at = NULL,
           payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('next_run_at', $2::text)
           WHERE id = $1`,
          [task_id, nextRunAt]
        );
        console.log(`[callback-processor] completed_no_pr rescheduled: task=${task_id} retry=${currentRetry + 1}/${MAX_NO_PR_RETRY}`);
      }
    } catch (rescheduleErr) {
      console.error(`[callback-processor] reschedule error (non-fatal): ${rescheduleErr.message}`);
    }
  }

  // Post-commit downstream triggers
  if (newStatus === 'completed') {
    await emitEvent('task_completed', 'executor', { task_id, run_id, duration_ms });
    await cbSuccess('cecelia-run');
    notifyTaskCompleted({ task_id, title: `Task ${task_id}`, run_id, duration_ms }).catch(err =>
      console.error('[callback-processor] notifyTaskCompleted error:', err.message)
    );
    publishTaskCompleted(task_id, run_id, { pr_url, duration_ms, iterations });

    // Thalamus: task completed
    try {
      const thalamusEvent = {
        type: EVENT_TYPES.TASK_COMPLETED,
        task_id, run_id, duration_ms, has_issues: false,
      };
      const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
      console.log(`[callback-processor] Thalamus decision: level=${thalamusDecision.level}, actions=${thalamusDecision.actions.map(a => a.type).join(',')}`);
      if (thalamusDecision.actions?.[0]?.type !== 'fallback_to_tick') {
        await executeThalamusDecision(thalamusDecision);
      }
    } catch (thalamusErr) {
      console.error(`[callback-processor] Thalamus error: ${thalamusErr.message}`);
    }

    // Embedding（async fire-and-forget）
    Promise.resolve().then(async () => {
      const taskRow = await pool.query('SELECT title, description FROM tasks WHERE id = $1', [task_id]);
      if (taskRow.rows[0]) {
        generateTaskEmbeddingAsync(task_id, taskRow.rows[0].title, taskRow.rows[0].description)
          .catch(err => console.error('[callback-processor] embedding error:', err.message));
      }
    }).catch(() => {});

    // Closure resolve
    resolveRelatedFailureMemories(task_id, pool).catch(err =>
      console.warn(`[callback-processor] Closure resolve failed (non-fatal): ${err.message}`)
    );

    // Desire feedback
    updateDesireFromTask(task_id, 'completed', pool).catch(err =>
      console.warn(`[callback-processor] desire feedback failed (non-fatal): ${err.message}`)
    );

    // code-review trigger（fire-and-forget）
    Promise.resolve().then(async () => {
      const taskMeta = await pool.query('SELECT task_type, project_id FROM tasks WHERE id = $1', [task_id]);
      const task = taskMeta.rows[0];
      if (!task) return;
      if (task.task_type === 'dev' && task.project_id) {
        const { checkAndCreateCodeReviewTrigger } = await import('./code-review-trigger.js');
        await checkAndCreateCodeReviewTrigger(pool, task.project_id);
      }
    }).catch(err =>
      console.warn(`[callback-processor] code-review-trigger 失败（非致命）: ${err.message}`)
    );

  } else if (newStatus === 'failed') {
    await emitEvent('task_failed', 'executor', { task_id, run_id, status });
    publishTaskFailed(task_id, run_id, status);

    try {
      const { classifyFailure } = await import('./quarantine.js');
      const taskRow = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
      const taskPayload = taskRow.rows[0]?.payload || {};
      const errorMsg = (result !== null && typeof result === 'object')
        ? (result.result || result.error || result.stderr || JSON.stringify(result))
        : String(result || status);
      const classification = classifyFailure(errorMsg, { payload: taskPayload });
      const isTransientApiError = ['rate_limit', 'network', 'auth'].includes(classification.class);
      const isBillingCap = classification.class === 'billing_cap';

      if (isBillingCap || isTransientApiError) {
        console.log(`[callback-processor] 外部/凭据错误：跳过熔断计数（task=${task_id}）`);
      } else {
        await cbFailure('cecelia-run');
        raise('P2', 'task_failed', `任务失败：${task_id}（${status}）`).catch(() => {});
      }

      const skipCount = isTransientApiError;
      const quarantineResult = await handleTaskFailure(task_id, { skipCount });
      if (quarantineResult.quarantined) {
        console.log(`[callback-processor] Task ${task_id} quarantined: ${quarantineResult.result?.reason}`);
        raise('P1', 'task_quarantined', `任务隔离：${task_id}`).catch(() => {});
      }
    } catch (classifyErr) {
      console.error(`[callback-processor] Classification error: ${classifyErr.message}`);
    }

    // Thalamus: task failed
    try {
      const thalamusEvent = {
        type: EVENT_TYPES.TASK_FAILED,
        task_id, run_id, error: status, retry_count: iterations || 0,
      };
      const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
      await executeThalamusDecision(thalamusDecision);
    } catch (thalamusErr) {
      console.error(`[callback-processor] Thalamus error on failure: ${thalamusErr.message}`);
    }

    updateDesireFromTask(task_id, 'failed', pool).catch(err =>
      console.warn(`[callback-processor] desire feedback failed (non-fatal): ${err.message}`)
    );
  }

  // KR rollup
  if (newStatus === 'completed' || newStatus === 'failed') {
    try {
      const taskRowForKR = await pool.query('SELECT goal_id FROM tasks WHERE id = $1', [task_id]);
      const krId = taskRowForKR.rows[0]?.goal_id;
      if (krId) {
        const krTasks = await pool.query(
          "SELECT COUNT(*) as total, COUNT(CASE WHEN status='completed' THEN 1 END) as done FROM tasks WHERE goal_id = $1",
          [krId]
        );
        const { total, done } = krTasks.rows[0];
        const krProgress = total > 0 ? Math.round((parseInt(done) / parseInt(total)) * 100) : 0;
        const krValResult = await pool.query('SELECT target_value FROM key_results WHERE id = $1', [krId]);
        if (krValResult.rows.length > 0) {
          const targetVal = parseFloat(krValResult.rows[0].target_value ?? 100);
          const newValue = targetVal > 0
            ? Math.round((krProgress / 100) * targetVal * 100) / 100
            : krProgress;
          await pool.query(
            'UPDATE key_results SET current_value = $1, updated_at = NOW() WHERE id = $2',
            [newValue, krId]
          );
        }
      }
    } catch (rollupErr) {
      console.error(`[callback-processor] Progress rollup error: ${rollupErr.message}`);
    }
  }

  return { success: true, newStatus };
}
