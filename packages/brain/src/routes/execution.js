import { Router } from 'express';
import pool from '../db.js';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { runTickSafe, getTickStatus } from '../tick.js';
import { generatePrdFromTask, generatePrdFromGoalKR, generateTrdFromGoal, generateTrdFromGoalKR, validatePrd, validateTrd, prdToJson, trdToJson, PRD_TYPE_MAP } from '../templates.js';
import { compareGoalProgress, generateDecision, executeDecision, rollbackDecision } from '../decision.js';
import { planNextTask, getPlanStatus, handlePlanInput, getGlobalState, selectTopAreas, selectActiveInitiativeForArea, ACTIVE_AREA_COUNT } from '../planner.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from '../thalamus.js';
import { executeDecision as executeThalamusDecision } from '../decision-executor.js';
import { generateTaskEmbeddingAsync } from '../embedding-service.js';
import { publishTaskCompleted, publishTaskFailed } from '../events/taskEvents.js';
import { emit as emitEvent } from '../event-bus.js';
import { recordSuccess as cbSuccess, recordFailure as cbFailure, reset as resetCB } from '../circuit-breaker.js';
import { notifyTaskCompleted } from '../notifier.js';
import { getAvailableMemoryMB } from '../platform-utils.js';
import { raise } from '../alerting.js';
import { handleTaskFailure, classifyFailure } from '../quarantine.js';
import { triggerCeceliaRun, checkCeceliaRunAvailable } from '../executor.js';
import { updateDesireFromTask } from '../desire-feedback.js';
import { checkAndCreateCodeReviewTrigger } from '../code-review-trigger.js';
import { getActiveExecutionPaths, INVENTORY_CONFIG, resolveRelatedFailureMemories } from './shared.js';

const router = Router();
const execAsync = promisify(exec);
const HEARTBEAT_PATH = new URL('../../../HEARTBEAT.md', import.meta.url);

router.post('/execution-callback', async (req, res) => {
  try {
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
      stderr
    } = req.body;

    if (!task_id) {
      return res.status(400).json({
        success: false,
        error: 'task_id is required'
      });
    }

    console.log(`[execution-callback] Received callback for task ${task_id}, status: ${status}`);

    // ── 幂等性保护：run_id + status 组合去重 ──
    // 网络重试或外部系统重复调用时，同一 run_id + status 不应重复处理
    if (run_id && status) {
      try {
        const dupCheck = await pool.query(
          `SELECT id FROM decision_log
           WHERE trigger = 'execution-callback'
             AND llm_output_json->>'run_id' = $1
             AND llm_output_json->>'status' = $2
           LIMIT 1`,
          [String(run_id), String(status)]
        );
        if (dupCheck.rows.length > 0) {
          console.log(`[execution-callback] 幂等保护: run_id=${run_id} status=${status} 已处理过，跳过`);
          return res.json({ success: true, duplicate: true });
        }
      } catch (idempotencyErr) {
        // 幂等检查失败不阻塞主流程，降级为无保护模式
        console.warn(`[execution-callback] 幂等检查失败（降级继续）: ${idempotencyErr.message}`);
      }
    }

    // 1. Determine new status
    let newStatus;
    if (status === 'AI Done') {
      newStatus = 'completed';
    } else if (status === 'AI Failed') {
      newStatus = 'failed';
    } else if (status === 'AI Quota Exhausted') {
      // quota_exhausted: 配额耗尽，不计入 failure_count，不触发隔离
      newStatus = 'quota_exhausted';
    } else {
      newStatus = 'in_progress'; // Unknown status, keep in progress
    }

    // P1-1: Dev task completed without PR → completed_no_pr
    // Only dev tasks are expected to produce PRs. Decomposition tasks are exempt.
    if (newStatus === 'completed' && !pr_url) {
      try {
        const taskRow = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const taskType = taskRow.rows[0]?.task_type;
        const isDecomposition = taskRow.rows[0]?.payload?.decomposition;
        if (taskType === 'dev' && !isDecomposition) {
          // Harness 模式的 dev task 不降级 — 由 sprint_evaluate 验证，不需要 PR
          const isHarness = taskRow.rows[0]?.payload?.harness_mode;
          if (!isHarness) {
            newStatus = 'completed_no_pr';
            console.warn(`[execution-callback] Dev task ${task_id} completed without PR → completed_no_pr`);
          }
        }
      } catch (prCheckErr) {
        console.error(`[execution-callback] PR check error (non-fatal): ${prCheckErr.message}`);
      }
    }

    // P1-0: terminal failure guard — 不允许 execution-callback 覆盖 pipeline_terminal_failure 终态
    // 场景：orchestrator 在 Xian 执行期间将 content-pipeline 设为 failed + failure_class=pipeline_terminal_failure，
    //       Xian 完成后调用 execution-callback(AI Done) 试图将状态改回 completed。
    // 即使主 UPDATE 有 WHERE status='in_progress' 保护，也需此守卫覆盖竞态情形。
    if (newStatus === 'completed') {
      try {
        const terminalCheck = await pool.query(
          `SELECT payload->>'failure_class' AS failure_class FROM tasks WHERE id = $1`,
          [task_id]
        );
        if (terminalCheck.rows[0]?.failure_class === 'pipeline_terminal_failure') {
          console.warn(`[execution-callback] 终态守卫命中：task=${task_id} failure_class=pipeline_terminal_failure，拒绝覆盖为 completed`);
          return res.json({ success: true, skipped: true, reason: 'terminal_failure_guard' });
        }
      } catch (terminalCheckErr) {
        console.error(`[execution-callback] terminal failure check error（降级继续）: ${terminalCheckErr.message}`);
      }
    }

    // 2. Build the update payload
    const lastRunResult = {
      run_id,
      checkpoint_id,
      status,
      duration_ms,
      iterations,
      pr_url: pr_url || null,
      completed_at: new Date().toISOString(),
      result_summary: (result !== null && typeof result === 'object') ? result.result : result
    };

    // 3. ATOMIC: DB update + activeProcess cleanup in a single transaction
    //    This eliminates the race window where tick could see stale state.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update task in database (idempotency: only update if still in_progress)
      // Note: $6 (isCompleted) avoids reusing $2 in CASE WHEN, which causes
      // "inconsistent types deduced for parameter $2" (text vs character varying).
      const isCompleted = newStatus === 'completed';

      // Extract findings from result for storage in payload.
      // decomp-checker reads payload.findings to pass context to follow-up tasks.
      // result can be a string (text output) or an object with a findings/result field.
      const findingsRaw = (result !== null && typeof result === 'object')
        ? (result.findings || result.result || result)
        : result;
      const findingsValue = findingsRaw
        ? (typeof findingsRaw === 'string' ? findingsRaw : JSON.stringify(findingsRaw))
        : null;

      if (!findingsValue && isCompleted) {
        console.warn(`[execution-callback] Task ${task_id} completed with empty findings/result`);
      }

      // Extract pr_number from pr_url for metadata tracking ($8)
      let prNumber = null;
      if (pr_url) {
        const prMatch = pr_url.match(/\/pull\/(\d+)/);
        prNumber = prMatch ? parseInt(prMatch[1], 10) : null;
      }

      // Extract error info for failure path ($9 errorMessage, $10 blockedDetail)
      // Only populated when task fails; null on success so DB keeps existing values.
      const isFailed = newStatus === 'failed';
      const isQuotaExhausted = newStatus === 'quota_exhausted';
      let errorMessage = null;
      let blockedDetail = null;
      if (isFailed) {
        // Build human-readable error message from result payload
        if (result === null) {
          // Fallback: cecelia-run crashed/killed before producing a result object
          const ts = new Date().toISOString();
          const exitCodeStr = exit_code != null ? exit_code : 'N/A';
          let fallback = `[callback: result=null] task=${task_id} exit_code=${exitCodeStr} at ${ts} | callback received but result was null`;
          const stderrTail = stderr ? String(stderr).slice(-300) : '';
          if (stderrTail) {
            fallback += ` | stderr: ${stderrTail}`;
          }
          errorMessage = fallback;
        } else if (typeof result === 'object') {
          errorMessage = result.result || result.error || result.stderr || JSON.stringify(result);
        } else {
          errorMessage = String(result);
        }
        errorMessage = errorMessage.slice(0, 2000); // cap at 2000 chars

        // Build structured blocked_detail: { exit_code, stderr_tail, timestamp }
        const stderrSource = stderr
          || (result !== null && typeof result === 'object' ? result.stderr : null)
          || (typeof result === 'string' ? result : '');
        const blockedDetailObj = {
          exit_code: exit_code != null ? exit_code : (isFailed ? 1 : 0),
          stderr_tail: String(stderrSource || '').slice(-500),
          timestamp: new Date().toISOString(),
        };
        blockedDetail = JSON.stringify(blockedDetailObj);
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
          completed_at = CASE WHEN $6 THEN NOW() ELSE completed_at END,
          quota_exhausted_at = CASE WHEN $11 THEN NOW() ELSE quota_exhausted_at END,
          pr_url = COALESCE($5::text, pr_url),
          pr_status = CASE WHEN $5::text IS NOT NULL THEN 'open' ELSE pr_status END,
          error_message = CASE WHEN $9::text IS NOT NULL THEN $9::text ELSE error_message END,
          blocked_detail = CASE WHEN $10::jsonb IS NOT NULL THEN $10::jsonb ELSE blocked_detail END
        WHERE id = $1 AND status = 'in_progress'
      `, [task_id, newStatus, JSON.stringify(lastRunResult), status, pr_url || null, isCompleted, findingsValue, prNumber, errorMessage, blockedDetail, isQuotaExhausted]);

      // Log the execution result（带 WHERE NOT EXISTS 防重复写入）
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
        String(status || '')
      ]);

      // Record progress step for completed execution
      try {
        const { recordProgressStep } = await import('../progress-ledger.js');
        await recordProgressStep(task_id, run_id, {
          sequence: 1, // 简化版：每个任务记录为单步骤
          name: 'task_execution',
          type: 'execution',
          status: status === 'AI Done' ? 'completed' : 'failed',
          startedAt: null, // execution-callback 时不知道开始时间
          completedAt: new Date(),
          durationMs: duration_ms || null,
          inputSummary: null,
          outputSummary: findingsValue ? findingsValue.substring(0, 500) : null,
          findings: result && typeof result === 'object' ? result : {},
          errorCode: status !== 'AI Done' ? 'execution_failed' : null,
          errorMessage: status !== 'AI Done' ? `Task execution failed with status: ${status}` : null,
          retryCount: iterations || 0,
          artifacts: { pr_url: pr_url || null },
          metadata: {
            checkpoint_id: checkpoint_id || null,
            original_status: status
          },
          confidenceScore: status === 'AI Done' ? 1.0 : 0.2
        });
        console.log(`[execution-callback] Progress step recorded for task ${task_id}`);
      } catch (progressErr) {
        // Progress ledger errors should not break the main flow
        console.error(`[execution-callback] Progress step recording failed: ${progressErr.message}`);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Clean up executor's activeProcesses registry (after commit, safe to do)
    try {
      const { removeActiveProcess } = await import('../executor.js');
      removeActiveProcess(task_id);
    } catch { /* ignore if executor not available */ }

    console.log(`[execution-callback] Task ${task_id} updated to ${newStatus} (atomic)`);

    // quota_exhausted → 设置全局 billing pause（阻止后续派发直到配额恢复）
    if (newStatus === 'quota_exhausted') {
      try {
        const { setBillingPause } = await import('../executor.js');
        // 尝试从 result 读取 quota_reset_at，否则默认 1 小时后
        const resetAt = (result && typeof result === 'object' && result.quota_reset_at)
          ? result.quota_reset_at
          : new Date(Date.now() + 60 * 60 * 1000).toISOString();
        setBillingPause(resetAt, 'quota_exhausted', pool);
        console.log(`[execution-callback] Billing pause SET: quota_exhausted task=${task_id}, reset_at=${resetAt}`);
      } catch (bpErr) {
        console.warn(`[execution-callback] setBillingPause failed (non-fatal): ${bpErr.message}`);
      }
    }

    // ── task_run_metrics: 从 result JSON 解析 LLM 指标并写入 ──
    try {
      const r = (result !== null && typeof result === 'object') ? result : {};
      const usage = r.usage || {};
      const modelUsage = r.modelUsage || {};

      // 主模型：cost 最高的那个
      let primaryModel = null;
      let maxCost = -1;
      for (const [modelId, mu] of Object.entries(modelUsage)) {
        const c = mu.costUSD || 0;
        if (c > maxCost) { maxCost = c; primaryModel = modelId; }
      }

      const inputTokens  = usage.input_tokens || 0;
      const cacheRead    = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      const totalInputs  = inputTokens + cacheRead;
      const cacheHitRate = totalInputs > 0 ? parseFloat((cacheRead / totalInputs).toFixed(4)) : null;

      // 排队时长：从 tasks 表读 queued_at / started_at
      let queuedDurationMs = null;
      try {
        const tRow = await pool.query('SELECT queued_at, started_at FROM tasks WHERE id = $1', [task_id]);
        const t = tRow.rows[0];
        if (t?.queued_at && t?.started_at) {
          queuedDurationMs = new Date(t.started_at) - new Date(t.queued_at);
        }
      } catch { /* non-fatal */ }

      const exitStatus = status === 'AI Done' ? 'success' : 'failed';

      await pool.query(`
        INSERT INTO task_run_metrics (
          task_id, run_id,
          execution_duration_ms, queued_duration_ms,
          model_id, num_turns,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cache_hit_rate, cost_usd,
          exit_status, failure_category, retry_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (task_id, run_id) DO UPDATE SET
          execution_duration_ms  = COALESCE(EXCLUDED.execution_duration_ms, task_run_metrics.execution_duration_ms),
          queued_duration_ms     = COALESCE(EXCLUDED.queued_duration_ms, task_run_metrics.queued_duration_ms),
          model_id               = COALESCE(EXCLUDED.model_id, task_run_metrics.model_id),
          num_turns              = COALESCE(EXCLUDED.num_turns, task_run_metrics.num_turns),
          input_tokens           = COALESCE(EXCLUDED.input_tokens, task_run_metrics.input_tokens),
          output_tokens          = COALESCE(EXCLUDED.output_tokens, task_run_metrics.output_tokens),
          cache_read_tokens      = COALESCE(EXCLUDED.cache_read_tokens, task_run_metrics.cache_read_tokens),
          cache_creation_tokens  = COALESCE(EXCLUDED.cache_creation_tokens, task_run_metrics.cache_creation_tokens),
          cache_hit_rate         = COALESCE(EXCLUDED.cache_hit_rate, task_run_metrics.cache_hit_rate),
          cost_usd               = COALESCE(EXCLUDED.cost_usd, task_run_metrics.cost_usd),
          exit_status            = COALESCE(EXCLUDED.exit_status, task_run_metrics.exit_status),
          failure_category       = COALESCE(EXCLUDED.failure_category, task_run_metrics.failure_category),
          retry_count            = COALESCE(EXCLUDED.retry_count, task_run_metrics.retry_count),
          updated_at             = NOW()
      `, [
        task_id,
        run_id || null,
        duration_ms || null,
        queuedDurationMs,
        primaryModel,
        r.num_turns || null,
        inputTokens || null,
        usage.output_tokens || null,
        cacheRead || null,
        usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || null,
        cacheHitRate,
        r.total_cost_usd || null,
        exitStatus,
        req.body.failure_class || null,
        iterations || 0,
      ]);
      console.log(`[execution-callback] task_run_metrics upserted for task ${task_id}`);
    } catch (metricsErr) {
      // Non-fatal: metrics write failure should not disrupt main flow
      console.warn(`[execution-callback] task_run_metrics write failed (non-fatal): ${metricsErr.message}`);
    }

    // ── task_execution_metrics: per-task consumption record ──
    try {
      const accountId = req.body.account_id || null;
      const durationMs = typeof duration_ms === 'number' ? duration_ms : null;
      const estRequests = durationMs ? Math.round((durationMs / 30000) * 10) / 10 : null;
      await pool.query(
        `INSERT INTO task_execution_metrics (task_id, account_id, duration_ms, est_requests, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [task_id, accountId, durationMs, estRequests, newStatus]
      );
      console.log(`[execution-callback] task_execution_metrics recorded task=${task_id} account=${accountId} duration=${durationMs}ms`);
    } catch (execMetricsErr) {
      console.warn(`[execution-callback] task_execution_metrics write failed (non-fatal): ${execMetricsErr.message}`);
    }

    // ── watchdog: flush RSS/CPU metrics to DB ──
    try {
      const { cleanupMetrics } = await import('../watchdog.js');
      await cleanupMetrics(task_id, pool, {
        runId: run_id || null,
        exitStatus: status === 'AI Done' ? 'success' : 'failed',
      });
    } catch { /* ignore */ }

    // P1-2: completed_no_pr 自动重排（retry_count < MAX_NO_PR_RETRY 时重新入队）
    const MAX_NO_PR_RETRY = 3;
    let rescheduled = false;
    if (newStatus === 'completed_no_pr') {
      try {
        const retryRow = await pool.query(
          'SELECT retry_count FROM tasks WHERE id = $1',
          [task_id]
        );
        const currentRetry = retryRow.rows[0]?.retry_count ?? 0;
        if (currentRetry < MAX_NO_PR_RETRY) {
          const nextRunAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          await pool.query(
            `UPDATE tasks
             SET status = 'queued',
                 retry_count = retry_count + 1,
                 completed_at = NULL,
                 payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('next_run_at', $2::text)
             WHERE id = $1`,
            [task_id, nextRunAt]
          );
          rescheduled = true;
          console.log(`[execution-callback] completed_no_pr rescheduled: task=${task_id} retry=${currentRetry + 1}/${MAX_NO_PR_RETRY} next_run_at=${nextRunAt}`);
        } else {
          console.log(`[execution-callback] completed_no_pr max retries reached: task=${task_id} retry_count=${currentRetry}`);
        }
      } catch (rescheduleErr) {
        console.error(`[execution-callback] reschedule error (non-fatal): ${rescheduleErr.message}`);
      }
    }

    // Record to EventBus, Circuit Breaker, and Notifier
    if (newStatus === 'completed') {
      await emitEvent('task_completed', 'executor', { task_id, run_id, duration_ms });
      await cbSuccess('cecelia-run');

      // 好奇心评分：research/curiosity 任务完成后异步重新计算（fire-and-forget）
      Promise.resolve().then(async () => {
        try {
          const taskMeta = await pool.query(
            'SELECT task_type, trigger_source FROM tasks WHERE id = $1',
            [task_id]
          );
          const t = taskMeta.rows[0];
          if (t && (t.task_type === 'research' || t.trigger_source === 'curiosity')) {
            const { calculateCuriosityScore } = await import('../curiosity-scorer.js');
            await calculateCuriosityScore();
            console.log(`[execution-callback] curiosity score recalculated after task ${task_id}`);
          }
        } catch (csErr) {
          console.warn('[execution-callback] curiosity score update failed (non-blocking):', csErr.message);
        }
      }).catch(err => console.error('[routes] silent error:', err));
      notifyTaskCompleted({ task_id, title: `Task ${task_id}`, run_id, duration_ms }).catch(err => console.error('[routes] silent error:', err));

      // 主动沟通：对话订阅模式 — 只有 Alex 问过的任务完成才发飞书通知（fire-and-forget）
      //   触发条件：working_memory 中存在 task_interest:<task_id>（由 orchestrator-chat 在检测到任务询问时写入）
      //   通知后删除订阅记录，避免重复
      Promise.resolve().then(async () => {
        // 检查是否有对应任务的订阅
        const interestRow = await pool.query(
          `SELECT key FROM working_memory
           WHERE key = $1
             AND updated_at > NOW() - INTERVAL '48 hours'
           LIMIT 1`,
          [`task_interest:${task_id}`]
        );
        if (interestRow.rows.length === 0) {
          console.log(`[execution-callback] 任务 ${task_id} 无订阅，跳过飞书通知`);
          return;
        }

        const { notifyTaskCompletion } = await import('../proactive-mouth.js');
        const { callLLM } = await import('../llm-caller.js');
        const taskRow = await pool.query('SELECT title, task_type, payload FROM tasks WHERE id = $1', [task_id]);
        if (taskRow.rows[0]) {
          const taskFindings = taskRow.rows[0].payload?.findings || null;
          await notifyTaskCompletion(pool, callLLM, {
            id: task_id,
            title: taskRow.rows[0].title,
            task_type: taskRow.rows[0].task_type,
            duration_ms,
            pr_url,
            result: taskFindings
          });
          // 通知后删除订阅记录
          await pool.query(`DELETE FROM working_memory WHERE key = $1`, [`task_interest:${task_id}`]);
          console.log(`[execution-callback] 已通知 Alex 任务 ${task_id} 完成（对话订阅）`);
        }
      }).catch(err => console.error('[routes] silent error:', err));

      // Publish WebSocket event: task completed
      publishTaskCompleted(task_id, run_id, { pr_url, duration_ms, iterations });

      // Thalamus: Analyze task completion event
      try {
        const thalamusEvent = {
          type: EVENT_TYPES.TASK_COMPLETED,
          task_id,
          run_id,
          duration_ms,
          has_issues: false
        };
        const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
        console.log(`[execution-callback] Thalamus decision: level=${thalamusDecision.level}, actions=${thalamusDecision.actions.map(a => a.type).join(',')}`);

        // Execute thalamus decision if not fallback
        if (thalamusDecision.actions?.[0]?.type !== 'fallback_to_tick') {
          await executeThalamusDecision(thalamusDecision);
        }
      } catch (thalamusErr) {
        console.error(`[execution-callback] Thalamus error: ${thalamusErr.message}`);
        // Continue with normal flow if thalamus fails
      }

      // Generate embedding for completed task (async, fire-and-forget)
      {
        const taskRow = await pool.query('SELECT title, description FROM tasks WHERE id = $1', [task_id]);
        if (taskRow.rows[0]) {
          generateTaskEmbeddingAsync(task_id, taskRow.rows[0].title, taskRow.rows[0].description).catch(err => console.error('[routes] silent error:', err));
        }
      }

      // 闭环回写：dev 任务完成后，将相关 failure_pattern 的 memory_stream 标记为 resolved
      resolveRelatedFailureMemories(task_id, pool).catch(err =>
        console.warn(`[execution-callback] Closure resolve failed (non-fatal): ${err.message}`)
      );

      // P0-B：欲望反馈闭环 - 任务完成 → 回写对应 desire 状态
      updateDesireFromTask(task_id, 'completed', pool).catch(err =>
        console.warn(`[execution-callback] desire feedback failed (non-fatal): ${err.message}`)
      );

      // 任务完成 → learnings 闭环：把完成结果写入 learnings 表（让反刍系统消化）
      try {
        const taskMeta = await pool.query(
          'SELECT title, task_type, description FROM tasks WHERE id = $1',
          [task_id]
        );
        if (taskMeta.rows[0]) {
          const { title: taskTitle, task_type: taskType } = taskMeta.rows[0];
          const findingsSummary = findingsValue ? findingsValue.substring(0, 800) : null;
          const learningContent = [
            `任务完成：${taskTitle}`,
            `类型：${taskType}`,
            findingsSummary ? `产出摘要：${findingsSummary}` : null,
            pr_url ? `PR：${pr_url}` : null,
          ].filter(Boolean).join('\n');

          const crypto = await import('crypto');
          const contentHash = crypto.createHash('sha256').update(learningContent).digest('hex');

          // 去重：同一 hash 不重复写
          const existing = await pool.query(
            'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
            [contentHash]
          );
          if (!existing.rows.length) {
            await pool.query(
              `INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested)
               VALUES ($1, 'task_completion', 'task_completed', $2, $3, $4, 1, true, false)`,
              [
                `完成：${taskTitle}`,
                learningContent,
                JSON.stringify({ task_id, task_type: taskType, pr_url: pr_url || null }),
                contentHash
              ]
            );
            console.log(`[execution-callback] 任务完成写入 learnings: ${taskTitle}`);
          }
        }
      } catch (learningErr) {
        console.warn(`[execution-callback] learnings 写入失败（非致命）: ${learningErr.message}`);
      }

      // content_publish 完成 → 写入 zenithjoy.publish_logs（fire-and-forget）
      Promise.resolve().then(async () => {
        try {
          const pubTaskRow = await pool.query(
            'SELECT task_type, payload FROM tasks WHERE id = $1',
            [task_id]
          );
          const pubTask = pubTaskRow.rows[0];
          if (!pubTask || pubTask.task_type !== 'content_publish') return;

          const { platform, pipeline_keyword, parent_pipeline_id, content_type } = pubTask.payload || {};
          if (!platform) return;

          // 规范化 platform：publish_logs 只接受固定枚举值
          const VALID_PLATFORMS = ['wechat', 'douyin', 'xiaohongshu', 'zhihu', 'toutiao', 'kuaishou', 'weibo', 'channels'];
          if (!VALID_PLATFORMS.includes(platform)) {
            console.warn(`[execution-callback] publish_logs: platform '${platform}' 不在枚举列表，跳过`);
            return;
          }

          // 规范化 content_type → works 表枚举（long_form_article / image_text / video）
          const CONTENT_TYPE_MAP = {
            article: 'long_form_article',
            long_form: 'long_form_article',
            long_form_article: 'long_form_article',
            image_text: 'image_text',
            'image-text': 'image_text',
            'solo-company-case': 'image_text',
            video: 'video',
          };
          const normalizedContentType = CONTENT_TYPE_MAP[content_type] || 'image_text';

          // Upsert zenithjoy.works（以 parent_pipeline_id 为 content_id，幂等）
          const workTitle = pipeline_keyword || `pipeline:${parent_pipeline_id || task_id}`;
          const contentId = parent_pipeline_id || task_id;

          const workUpsert = await pool.query(
            `INSERT INTO zenithjoy.works (content_id, title, content_type, status)
             VALUES ($1, $2, $3, 'published')
             ON CONFLICT (content_id) DO UPDATE SET
               status = 'published',
               updated_at = NOW()
             RETURNING id`,
            [contentId, workTitle, normalizedContentType]
          );
          const workId = workUpsert.rows[0]?.id;
          if (!workId) return;

          // 幂等检查 publish_logs（同一 work_id + platform 不重复写）
          const existing = await pool.query(
            `SELECT id FROM zenithjoy.publish_logs WHERE work_id = $1 AND platform = $2`,
            [workId, platform]
          );
          if (existing.rows.length > 0) {
            console.log(`[execution-callback] publish_logs 已存在 work_id=${workId} platform=${platform}，跳过`);
            return;
          }

          await pool.query(
            `INSERT INTO zenithjoy.publish_logs
               (work_id, platform, status, published_at, response)
             VALUES ($1, $2, 'published', NOW(), $3)`,
            [
              workId,
              platform,
              JSON.stringify({ task_id, pipeline_keyword: pipeline_keyword || null, parent_pipeline_id: parent_pipeline_id || null })
            ]
          );
          console.log(`[execution-callback] publish_logs 写入成功: work_id=${workId} platform=${platform} keyword=${pipeline_keyword}`);
        } catch (plErr) {
          console.warn(`[execution-callback] publish_logs 写入失败（非致命）: ${plErr.message}`);
        }
      }).catch(err => console.warn(`[execution-callback] publish_logs 异步异常: ${err.message}`));

      // 小任务积累触发：dev 任务完成后检查是否需要触发 code_review（fire-and-forget）
      Promise.resolve().then(async () => {
        const taskMeta = await pool.query('SELECT task_type, project_id FROM tasks WHERE id = $1', [task_id]);
        const task = taskMeta.rows[0];
        if (!task) return; // task 已不存在（已被清理或 DB 异常），静默跳过
        const { task_type: taskType, project_id: projectId } = task;
        if (taskType === 'dev' && projectId) {
          await checkAndCreateCodeReviewTrigger(pool, projectId);
        }
      }).catch(err => console.warn(`[execution-callback] code-review-trigger 失败（非致命）: ${err.message}`));
    } else if (newStatus === 'failed') {
      await emitEvent('task_failed', 'executor', { task_id, run_id, status });

      // Publish WebSocket event: task failed
      publishTaskFailed(task_id, run_id, status);

      // === Failure Classification & Smart Retry ===
      let failureHandled = false;
      let quarantined = false;
      let isBillingCap = false;
      let isTransientApiError = false;
      try {
        // Extract error message from result
        // Note: typeof null === 'object', so we must check result !== null first
        // to avoid TypeError when result is null (e.g. claude CLI fails with Spending cap reached)
        const errorMsg = (result !== null && typeof result === 'object')
          ? (result.result || result.error || result.stderr || JSON.stringify(result))
          : String(result || status);

        // Classify the failure
        const { classifyFailure } = await import('../quarantine.js');
        const taskRow = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const taskPayload = taskRow.rows[0]?.payload || {};
        const taskType = taskRow.rows[0]?.task_type;
        const classification = classifyFailure(errorMsg, { payload: taskPayload });
        isBillingCap = classification.class === 'billing_cap';
        // rate_limit / network / auth 均不代表 cecelia-run 系统故障，跳过熔断计数：
        //   rate_limit — 429 限流，外部 API 问题
        //   network    — 网络抖动，外部环境问题
        //   auth       — 凭据过期/无效（如 OAuth token expired），是凭据问题而非 cecelia-run 健康问题
        isTransientApiError = classification.class === 'rate_limit'
          || classification.class === 'network'
          || classification.class === 'auth';

        console.log(`[execution-callback] Failure classified: task=${task_id} class=${classification.class} pattern=${classification.pattern}`);

        // Store classification in task payload
        await pool.query(
          `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [task_id, JSON.stringify({
            failure_class: classification.class,
            failure_detail: { pattern: classification.pattern, error_excerpt: errorMsg.slice(0, 500) },
          })]
        );

        const strategy = classification.retry_strategy;

        if (strategy && strategy.should_retry) {
          // Smart retry: 标记为 blocked（等待 TTL 自动释放），而非立即重入队列
          const retryCount = (taskPayload.failure_count || 0) + 1;
          await pool.query(
            `UPDATE tasks SET status = 'blocked',
             blocked_at = NOW(),
             blocked_reason = $2,
             blocked_until = $3,
             started_at = NULL,
             payload = COALESCE(payload, '{}'::jsonb) || $4::jsonb
             WHERE id = $1 AND status = 'failed'`,
            [task_id, classification.class, strategy.next_run_at, JSON.stringify({
              failure_count: retryCount,
              smart_retry: { class: classification.class, attempt: retryCount, scheduled_at: strategy.next_run_at },
            })]
          );
          console.log(`[execution-callback] Task blocked: task=${task_id} class=${classification.class} blocked_until=${strategy.next_run_at}`);
          failureHandled = true;

          // Spending cap: 标记账号级 spending cap（不全局阻塞，降级链自动换号）
          if (strategy.billing_pause) {
            const { markSpendingCap } = await import('../account-usage.js');
            const cappedAccount = taskPayload.dispatched_account;
            if (cappedAccount) {
              markSpendingCap(cappedAccount, strategy.next_run_at);
              console.log(`[execution-callback] Billing cap: 标记 ${cappedAccount} capped until ${strategy.next_run_at}，下次派发自动换号`);
            } else {
              console.warn(`[execution-callback] Billing cap 检测到但 task payload 缺少 dispatched_account，无法精准标记`);
            }
          }
        } else if (strategy && strategy.needs_human_review) {
          // No retry, mark for human review
          await pool.query(
            `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
            [task_id, JSON.stringify({ needs_human_review: true })]
          );
          console.log(`[execution-callback] Needs human review: task=${task_id} class=${classification.class}`);
        }

        // === Dev 任务失败智能重试（补充 quarantine 未处理的 code_error / transient）===
        // 仅当 quarantine 未处理（failureHandled=false）且 task_type=dev 时触发
        // 注：taskType 和 taskPayload 在此 try 块内有效
        if (!failureHandled && taskType === 'dev') {
          try {
            const { classifyDevFailure } = await import('../dev-failure-classifier.js');
            const retryCount = taskPayload.retry_count || 0;
            const devClassification = classifyDevFailure(result, status, { retryCount });

            console.log(`[execution-callback] Dev failure classified: task=${task_id} class=${devClassification.class} retryable=${devClassification.retryable} retry=${retryCount}`);

            if (devClassification.retryable) {
              await pool.query(
                `UPDATE tasks SET status = 'queued', started_at = NULL,
                 payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
                 WHERE id = $1 AND status = 'failed'`,
                [task_id, JSON.stringify({
                  next_run_at: devClassification.next_run_at,
                  retry_count: retryCount + 1,
                  retry_reason: devClassification.retry_reason,
                  previous_failure: devClassification.previous_failure,
                  dev_retry: {
                    class: devClassification.class,
                    attempt: retryCount + 1,
                    scheduled_at: devClassification.next_run_at,
                  },
                })]
              );
              console.log(`[execution-callback] Dev smart retry: task=${task_id} class=${devClassification.class} attempt=${retryCount + 1} next_run_at=${devClassification.next_run_at}`);
              failureHandled = true;
            } else {
              console.log(`[execution-callback] Dev failure not retryable: task=${task_id} class=${devClassification.class} reason=${devClassification.reason}`);

              // CI 诊断：非重试性失败时，用 gh 获取真实 CI 日志并分类
              try {
                const { diagnoseCiFailure } = await import('../ci-diagnostics.js');
                const ciDiagnosis = await diagnoseCiFailure(
                  { prUrl: pr_url, taskId: task_id },
                  {} // 使用默认 execFn（真实 gh 命令）
                );
                if (ciDiagnosis) {
                  await pool.query(
                    `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
                    [task_id, JSON.stringify({ ci_diagnosis: ciDiagnosis })]
                  );
                  console.log(`[execution-callback] CI diagnosis stored: task=${task_id} class=${ciDiagnosis.failure_class} retryable=${ciDiagnosis.retryable}`);
                }
              } catch (ciDiagErr) {
                console.warn(`[execution-callback] CI diagnosis failed (non-fatal): ${ciDiagErr.message}`);
              }
            }
          } catch (devClassifyErr) {
            console.error(`[execution-callback] Dev classification error: ${devClassifyErr.message}`);
          }
        }
      } catch (classifyErr) {
        console.error(`[execution-callback] Classification error: ${classifyErr.message}`);
      }

      // Circuit breaker 旁路：以下失败类型不计入熔断，属于外部/API 错误而非 cecelia-run 系统故障
      //   billing_cap  — 账号费用上限，等 reset 时间
      //   rate_limit   — 429 限流，指数退避后自动恢复
      //   network      — 网络抖动，与 cecelia-run 健康状况无关
      //   auth         — 凭据过期/无效（OAuth token expired 等），是凭据问题而非系统故障
      if (isBillingCap || isTransientApiError) {
        const bypassReason = isBillingCap ? 'billing_cap' : (isTransientApiError ? 'rate_limit/network/auth' : 'unknown');
        console.log(`[execution-callback] 外部/凭据错误（${bypassReason}）：跳过熔断计数（task=${task_id}）`);
      } else {
        await cbFailure('cecelia-run');
        raise('P2', 'task_failed', `任务失败：${task_id}（${status}）`).catch(err => console.error('[routes] silent error:', err));
      }

      // Check if task should be quarantined (only if not already handled by smart retry)
      if (!failureHandled) {
        try {
          const quarantineResult = await handleTaskFailure(task_id);
          if (quarantineResult.quarantined) {
            quarantined = true;
            console.log(`[execution-callback] Task ${task_id} quarantined: ${quarantineResult.result?.reason}`);
            raise('P1', 'task_quarantined', `任务隔离：${task_id}（${quarantineResult.result?.reason || '反复失败'}）`).catch(err => console.error('[routes] silent error:', err));
          }
        } catch (quarantineErr) {
          console.error(`[execution-callback] Quarantine check error: ${quarantineErr.message}`);
        }
      }

      // Thalamus: Analyze task failure event (more complex, may need deeper analysis)
      if (!quarantined) {
        try {
          const thalamusEvent = {
            type: EVENT_TYPES.TASK_FAILED,
            task_id,
            run_id,
            error: status,
            retry_count: iterations || 0
          };
          const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
          console.log(`[execution-callback] Thalamus decision for failure: level=${thalamusDecision.level}, actions=${thalamusDecision.actions.map(a => a.type).join(',')}`);

          // Execute thalamus decision
          await executeThalamusDecision(thalamusDecision);
        } catch (thalamusErr) {
          console.error(`[execution-callback] Thalamus error on failure: ${thalamusErr.message}`);
        }
      }

      // P0-B：欲望反馈闭环 - 任务失败 → 回写对应 desire 状态
      updateDesireFromTask(task_id, 'failed', pool).catch(err =>
        console.warn(`[execution-callback] desire feedback failed (non-fatal): ${err.message}`)
      );

    }

    // 5. Rollup progress to KR and O
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        // Get the task's goal_id (which is a KR)
        const taskRow = await pool.query('SELECT goal_id FROM tasks WHERE id = $1', [task_id]);
        const krId = taskRow.rows[0]?.goal_id;

        if (krId) {
          // Calculate KR progress from its tasks
          const krTasks = await pool.query(
            "SELECT COUNT(*) as total, COUNT(CASE WHEN status='completed' THEN 1 END) as done FROM tasks WHERE goal_id = $1",
            [krId]
          );
          const { total, done } = krTasks.rows[0];
          const krProgress = total > 0 ? Math.round((parseInt(done) / parseInt(total)) * 100) : 0;

          // 更新 key_results.current_value（任务完成比例 × target_value）
          const krValResult = await pool.query('SELECT target_value FROM key_results WHERE id = $1', [krId]);
          if (krValResult.rows.length > 0) {
            const targetVal = parseFloat(krValResult.rows[0].target_value ?? 100);
            const newValue = targetVal > 0
              ? Math.round((krProgress / 100) * targetVal * 100) / 100
              : krProgress;
            await pool.query('UPDATE key_results SET current_value = $1, updated_at = NOW() WHERE id = $2', [newValue, krId]);
          }
        }
      } catch (rollupErr) {
        console.error(`[execution-callback] Progress rollup error: ${rollupErr.message}`);
      }
    }

    // 5b. 探索型任务闭环已移除
    if (newStatus === 'completed') {

      // 5c0. initiative_plan 完成 → 自动创建 decomp_review task 触发 Vivian 质检
      try {
        const ipRow = await pool.query(
          'SELECT task_type, project_id, goal_id, title FROM tasks WHERE id = $1',
          [task_id]
        );
        const ipTask = ipRow.rows[0];
        if (ipTask?.task_type === 'initiative_plan') {
          console.log(`[execution-callback] initiative_plan ${task_id} completed → auto-creating decomp_review task`);
          const { createTask } = await import('../actions.js');
          await createTask({
            title: `[Vivian质检] ${ipTask.title}`,
            description: `initiative_plan 任务「${ipTask.title}」已完成，Vivian 审查拆解质量。\n原始 initiative_plan task_id: ${task_id}`,
            priority: 'P0',
            project_id: ipTask.project_id,
            goal_id: ipTask.goal_id,
            task_type: 'decomp_review',
            trigger_source: 'execution_callback_auto',
            payload: { parent_task_id: task_id, review_scope: 'initiative_plan' }
          });
          console.log(`[execution-callback] decomp_review task created for initiative_plan ${task_id}`);
        }
      } catch (decompAutoErr) {
        console.error(`[execution-callback] auto decomp_review creation failed (non-fatal): ${decompAutoErr.message}`);
      }

      // 5c1. Decomp Review 闭环：Vivian 审查完成 → 激活/修正/拒绝
      try {
        const decompReviewResult = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const decompReviewRow = decompReviewResult.rows[0];

        if (decompReviewRow?.task_type === 'decomp_review') {
          console.log(`[execution-callback] Decomp review task completed, processing verdict...`);

          // 从 result 中提取 verdict 和 findings
          const verdictRaw = (result !== null && typeof result === 'object')
            ? (result.verdict || result.result?.verdict)
            : null;
          const findingsRaw = (result !== null && typeof result === 'object')
            ? (result.findings || result.result?.findings || result)
            : {};

          // verdict 归一化
          const validVerdicts = ['approved', 'needs_revision', 'rejected'];
          const verdict = validVerdicts.includes(verdictRaw) ? verdictRaw : 'approved';

          const { processReviewResult } = await import('../review-gate.js');
          await processReviewResult(pool, task_id, verdict, findingsRaw);

          // 计划调整：如果 findings 包含 plan_adjustment，执行调整
          if (findingsRaw?.plan_adjustment && decompReviewRow?.payload?.review_scope === 'plan_adjustment') {
            try {
              const { executePlanAdjustment } = await import('../progress-reviewer.js');
              await executePlanAdjustment(pool, findingsRaw, decompReviewRow.payload?.plan_context);
              console.log(`[execution-callback] Plan adjustment executed for project ${decompReviewRow.payload?.entity_id}`);
            } catch (adjErr) {
              console.error(`[execution-callback] Plan adjustment error: ${adjErr.message}`);
            }
          }

          console.log(`[execution-callback] Decomp review processed: verdict=${verdict}`);
        }
      } catch (decompReviewErr) {
        console.error(`[execution-callback] Decomp review handling error: ${decompReviewErr.message}`);
      }

      // 5c2. 秋米拆解完成 → 触发 Vivian 审查 + KR 状态更新
      try {
        const decompCheckResult = await pool.query('SELECT task_type, payload, goal_id FROM tasks WHERE id = $1', [task_id]);
        const decompCheckRow = decompCheckResult.rows[0];

        // 只处理秋米的拆解任务（不是 Vivian 的 decomp_review）
        if (decompCheckRow?.payload?.decomposition === 'true'
            && decompCheckRow?.task_type !== 'decomp_review'
            && decompCheckRow?.goal_id) {
          const krId = decompCheckRow.goal_id;

          // 检查 KR 是否处于 decomposing 状态（key_results 表）
          const krCheckResult = await pool.query(
            'SELECT id, title, status FROM key_results WHERE id = $1 AND status = $2',
            [krId, 'decomposing']
          );

          if (krCheckResult.rows.length > 0) {
            // 找到秋米创建的 Project（通过 okr_projects.kr_id）
            const projectCheckResult = await pool.query(`
              SELECT id, title AS name FROM okr_projects
              WHERE kr_id = $1
              ORDER BY created_at DESC LIMIT 1
            `, [krId]);

            if (projectCheckResult.rows.length > 0) {
              const project = projectCheckResult.rows[0];

              // 触发 Vivian 审查
              const { shouldTriggerReview, createReviewTask } = await import('../review-gate.js');
              const needsReview = await shouldTriggerReview(pool, 'project', project.id);

              if (needsReview) {
                await createReviewTask(pool, {
                  entityType: 'project',
                  entityId: project.id,
                  entityName: project.name,
                  parentKrId: krId,
                });
                console.log(`[execution-callback] Vivian review triggered for KR ${krId} project ${project.id}`);
              }

              // 创建用户确认门：okr_decomp_review pending_action
              try {
                const krTitle = krCheckResult.rows[0].title;
                const projectName = project.name;

                // 查询拆解产出的 Initiatives（通过 okr_scopes → okr_initiatives）
                const initiativesResult = await pool.query(`
                  SELECT oi.title AS name
                  FROM okr_scopes os
                  JOIN okr_initiatives oi ON oi.scope_id = os.id
                  WHERE os.project_id = $1
                  ORDER BY oi.created_at ASC
                `, [project.id]);
                const initiatives = initiativesResult.rows.map(r => r.name);

                // 签名去重：同一 KR 24h 内不重复创建
                const existingApproval = await pool.query(`
                  SELECT id FROM pending_actions
                  WHERE action_type = 'okr_decomp_review'
                    AND status = 'pending_approval'
                    AND (params->>'kr_id') = $1
                    AND created_at > NOW() - INTERVAL '24 hours'
                  LIMIT 1
                `, [krId]);

                if (existingApproval.rows.length === 0) {
                  await pool.query(`
                    INSERT INTO pending_actions
                      (action_type, category, params, context, priority, source, expires_at, status)
                    VALUES
                      ('okr_decomp_review', 'approval', $1, $2, 'urgent', 'okr_decomposer',
                       NOW() + INTERVAL '72 hours', 'pending_approval')
                  `, [
                    JSON.stringify({ kr_id: krId, project_id: project.id }),
                    JSON.stringify({
                      kr_title: krTitle,
                      project_name: projectName,
                      initiatives,
                      decomposed_at: new Date().toISOString()
                    })
                  ]);
                  console.log(`[execution-callback] OKR 确认门已创建：KR ${krId}「${krTitle}」，${initiatives.length} 个 Initiative`);
                } else {
                  console.log(`[execution-callback] OKR 确认门已存在（去重跳过）：KR ${krId}`);
                }
              } catch (approvalErr) {
                console.error(`[execution-callback] 创建 OKR 确认门失败（非阻塞）: ${approvalErr.message}`);
              }
            }

            // 更新 KR 状态: decomposing → reviewing（key_results 表）
            await pool.query(
              `UPDATE key_results SET status = 'reviewing', updated_at = NOW() WHERE id = $1`,
              [krId]
            );
            console.log(`[execution-callback] KR ${krId} → reviewing (秋米拆解完成)`);
          }
        }
      } catch (decompTriggerErr) {
        console.error(`[execution-callback] Decomp → review trigger error: ${decompTriggerErr.message}`);
      }

      // 5c-strategy. strategy_session 闭环：解析 KR JSON → 写入 goals 表
      try {
        const ssTaskResult = await pool.query('SELECT task_type, goal_id FROM tasks WHERE id = $1', [task_id]);
        const ssTaskRow = ssTaskResult.rows[0];

        if (ssTaskRow?.task_type === 'strategy_session') {
          console.log(`[execution-callback] strategy_session task completed, parsing KR JSON...`);

          const outputStr = typeof result === 'string' ? result
            : (result?.result || result?.output || JSON.stringify(result || ''));

          let parsedOutput = null;
          const jsonMatch = outputStr.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsedOutput = JSON.parse(jsonMatch[0]);
            } catch (jsonParseErr) {
              console.error(`[execution-callback] strategy_session JSON parse error: ${jsonParseErr.message}`);
            }
          }

          if (parsedOutput && Array.isArray(parsedOutput.krs) && parsedOutput.krs.length > 0) {
            const meetingSummary = parsedOutput.meeting_summary || '';
            const krs = parsedOutput.krs;

            await pool.query(
              `UPDATE tasks SET payload = jsonb_set(COALESCE(payload, '{}'), '{meeting_summary}', $1::jsonb) WHERE id = $2`,
              [JSON.stringify(meetingSummary), task_id]
            );

            // 查找关联 objective（migration 181：goals(area_okr).id = objectives.id）
            let krObjectiveId = null;
            if (ssTaskRow.goal_id) {
              const objCheck = await pool.query('SELECT id FROM objectives WHERE id = $1', [ssTaskRow.goal_id]);
              if (objCheck.rows.length > 0) {
                krObjectiveId = ssTaskRow.goal_id;
              }
            }
            if (!krObjectiveId) {
              console.warn(`[execution-callback] strategy_session KR 无关联 Objective（goal_id=${ssTaskRow.goal_id || 'null'}）— KR 将成为孤岛`);
            }

            for (const kr of krs) {
              const krTitle = kr.title || '(untitled KR)';
              const krDomain = kr.domain || null;
              const krOwnerRole = kr.owner_role ? kr.owner_role.toLowerCase() : null;
              const krPriority = ['P0', 'P1', 'P2'].includes(kr.priority) ? kr.priority : 'P1';

              await pool.query(
                `INSERT INTO key_results (title, status, owner_role, objective_id, metadata)
                 VALUES ($1, 'pending', $2, $3, $4)`,
                [krTitle, krOwnerRole, krObjectiveId, JSON.stringify({ priority: krPriority, domain: krDomain })]
              );
              console.log(`[execution-callback] strategy_session KR created: "${krTitle}" domain=${krDomain} owner=${krOwnerRole} objective_id=${krObjectiveId}`);
            }

            console.log(`[execution-callback] strategy_session: ${krs.length} KRs written to goals`);
          } else {
            console.warn(`[execution-callback] strategy_session: no valid krs found in output`);
            await pool.query(
              `UPDATE tasks SET payload = jsonb_set(COALESCE(payload, '{}'), '{strategy_raw_output}', $1::jsonb) WHERE id = $2`,
              [JSON.stringify(outputStr.slice(0, 2000)), task_id]
            );
          }
        }
      } catch (strategySessionErr) {
        console.error(`[execution-callback] strategy_session handling error: ${strategySessionErr.message}`);
      }

      // 5c. Review 闭环：发现问题 → 自动创建修复 Task
      try {
        const taskResult = await pool.query('SELECT task_type, project_id, goal_id, title FROM tasks WHERE id = $1', [task_id]);
        const taskRow = taskResult.rows[0];

        if (taskRow?.task_type === 'review') {
          console.log(`[execution-callback] Review task completed, checking for issues...`);

          // 解析结果，查找 L1/L2 问题
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result || {});
          const hasL1 = /L1[：:]/i.test(resultStr) || /\bL1\b.*问题/i.test(resultStr);
          const hasL2 = /L2[：:]/i.test(resultStr) || /\bL2\b.*问题/i.test(resultStr);

          if (hasL1 || hasL2) {
            console.log(`[execution-callback] Review found issues (L1: ${hasL1}, L2: ${hasL2}), creating fix task...`);

            // 提取问题描述作为 PRD
            const issueLevel = hasL1 ? 'L1 (阻塞级)' : 'L2 (功能级)';
            const prdContent = `# PRD - 修复 Review 发现的问题

## 背景
Review 任务 "${taskRow.title}" 发现了 ${issueLevel} 问题需要修复。

## 问题描述
${resultStr.substring(0, 2000)}

## 目标
修复 Review 发现的所有 ${issueLevel} 问题。

## 验收标准
- [ ] 所有 L1 问题已修复
- [ ] 所有 L2 问题已修复
- [ ] 修复后代码通过测试
- [ ] 再次 Review 无新问题

## 技术要点
根据 Review 报告中的具体建议进行修复。`;

            const { createTask: createFixTask } = await import('../actions.js');
            await createFixTask({
              title: `修复: ${taskRow.title.replace(/^(每日质检|Review)[：:]\s*/i, '')}`,
              description: `Review 发现 ${issueLevel} 问题，需要修复`,
              task_type: 'dev',
              priority: hasL1 ? 'P0' : 'P1',
              project_id: taskRow.project_id,
              goal_id: taskRow.goal_id,
              prd_content: prdContent,
              payload: {
                triggered_by: 'review',
                review_task_id: task_id,
                issue_level: hasL1 ? 'L1' : 'L2'
              }
            });

            console.log(`[execution-callback] Created fix task for review issues`);
          } else {
            console.log(`[execution-callback] Review passed, no L1/L2 issues found`);
          }
        }
      } catch (reviewErr) {
        console.error(`[execution-callback] Review handling error: ${reviewErr.message}`);
      }

      // 5c6. 断链 #1: suggestion_plan 完成 → 创建 architecture_design (M1 scan) 任务
      try {
        const spAdRow = await pool.query(
          'SELECT task_type, project_id, goal_id, title FROM tasks WHERE id = $1',
          [task_id]
        );
        const spAdTask = spAdRow.rows[0];

        if (spAdTask?.task_type === 'suggestion_plan') {
          const projectId = spAdTask.project_id;
          const existing = await pool.query(
            `SELECT id FROM tasks
             WHERE project_id = $1 AND task_type = 'architecture_design'
               AND status IN ('queued', 'in_progress')
             LIMIT 1`,
            [projectId]
          );
          if (existing.rows.length > 0) {
            console.log(`[execution-callback] architecture_design already queued for project ${projectId}, skip`);
          } else {
            const { createTask: createAdTask } = await import('../actions.js');
            await createAdTask({
              title: `[M1 Scan] architecture_design — ${spAdTask.title}`,
              description: `suggestion_plan「${spAdTask.title}」已完成，开始 M1 全量扫描代码库，建立 system_modules 知识库。\n原始 suggestion_plan task_id: ${task_id}`,
              priority: 'P1',
              project_id: projectId,
              goal_id: spAdTask.goal_id,
              task_type: 'architecture_design',
              trigger_source: 'execution_callback_auto',
              payload: { mode: 'scan', parent_task_id: task_id }
            });
            console.log(`[execution-callback] 断链#1 修复: architecture_design (M1 scan) created for suggestion_plan ${task_id}`);
          }
        }
      } catch (spAdErr) {
        console.error(`[execution-callback] suggestion_plan → architecture_design creation failed (non-fatal): ${spAdErr.message}`);
      }

      // 5c7. 断链 #3: architecture_design 完成 → M1 创建 initiative_plan / M2 验证 dev 任务
      try {
        const adRow = await pool.query(
          'SELECT task_type, project_id, goal_id, title, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const adTask = adRow.rows[0];

        if (adTask?.task_type === 'architecture_design') {
          const mode = adTask.payload?.mode || 'scan';
          const projectId = adTask.project_id;
          if (mode === 'scan') {
            const existingIp = await pool.query(
              `SELECT id FROM tasks
               WHERE project_id = $1 AND task_type = 'initiative_plan'
                 AND status IN ('queued', 'in_progress')
               LIMIT 1`,
              [projectId]
            );
            if (existingIp.rows.length > 0) {
              console.log(`[execution-callback] initiative_plan already queued for project ${projectId}, skip`);
            } else {
              const { createTask: createIpTask } = await import('../actions.js');
              await createIpTask({
                title: `[秋米] initiative_plan — ${adTask.title}`,
                description: `architecture_design (M1 scan)「${adTask.title}」已完成，秋米开始拆解规划 Initiatives。\n原始 architecture_design task_id: ${task_id}`,
                priority: 'P1',
                project_id: projectId,
                goal_id: adTask.goal_id,
                task_type: 'initiative_plan',
                trigger_source: 'execution_callback_auto',
                payload: { parent_task_id: task_id, architecture_scan_task_id: task_id }
              });
              console.log(`[execution-callback] 断链#3 修复: initiative_plan created for architecture_design(scan) ${task_id}`);
            }
          } else {
            // M2 design 完成 → 验证 dev 任务已存在（日志告警）
            const devTasks = await pool.query(
              `SELECT COUNT(*) AS cnt FROM tasks
               WHERE project_id = $1 AND task_type = 'dev' AND status IN ('queued', 'in_progress')`,
              [projectId]
            );
            const devCnt = parseInt(devTasks.rows[0]?.cnt || 0);
            if (devCnt === 0) {
              // 检查是否已有历史 dev 任务（全部完成则不告警，否则是 pipeline 断链）
              const histDevRow = await pool.query(
                `SELECT COUNT(*) AS cnt FROM tasks WHERE project_id = $1 AND task_type = 'dev'`,
                [projectId]
              );
              const histDevCnt = parseInt(histDevRow.rows[0]?.cnt || 0);
              if (histDevCnt === 0) {
                // 从未注册过 dev 任务 → architect Mode 2 断链，写 cecelia_events 告警
                console.warn(`[execution-callback] 断链#3 告警: architecture_design(design) ${task_id} 完成但 project ${projectId} 无任何 dev 任务，创建告警`);
                const { createTask: createAlertTask } = await import('../actions.js');
                await createAlertTask({
                  title: `[告警] Initiative pipeline 断链: architect Mode 2 未注册 Tasks`,
                  description: `architecture_design(design) task ${task_id} 已完成，但 project ${projectId} 下从未创建过 dev 任务。\n\n可能原因：/architect Mode 2 未正确调用 POST /api/brain/tasks 注册 Tasks 到 Brain。\n\n请检查该 architecture_design task 的执行日志。`,
                  priority: 'P1',
                  project_id: projectId,
                  goal_id: adTask.goal_id,
                  task_type: 'cecelia_events',
                  trigger_source: 'execution_callback_断链3',
                  payload: { event_type: 'pipeline_gap', architecture_design_task_id: task_id, project_id: projectId }
                });
              } else {
                console.log(`[execution-callback] 断链#3: architecture_design(design) ${task_id} 完成，project ${projectId} 所有 dev 任务已完成（共 ${histDevCnt} 个）`);
              }
            } else {
              console.log(`[execution-callback] 断链#3: architecture_design(design) ${task_id} 完成，project ${projectId} 有 ${devCnt} 个 dev 任务就绪`);
            }
          }
        }
      } catch (adErr) {
        console.error(`[execution-callback] architecture_design callback handling failed (non-fatal): ${adErr.message}`);
      }

      // 5c8. 断链 #4: code_review 完成 → 根据 decision 路由
      // scope=initiative 的 code_review 根据 decision 决定后续：
      // - PASS（默认）→ initiative_verify
      // - NEEDS_FIX → 创建修复 dev task（代码问题，不进 verify）
      // - CRITICAL_BLOCK / TEST_BLOCK → cecelia_events P0告警，停止 pipeline
      try {
        const crRow = await pool.query(
          'SELECT task_type, project_id, goal_id, title, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const crTask = crRow.rows[0];
        const crPayload = crTask?.payload || {};
        const isInitiativeCodeReview = crTask?.task_type === 'code_review' && crPayload.scope === 'initiative';

        if (isInitiativeCodeReview) {
          const projectId = crTask.project_id;
          const resultObj = typeof result === 'object' && result !== null ? result : {};
          const decision = resultObj.decision || 'PASS';
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result || '');
          const hasTestBlock = resultStr.includes('TEST_BLOCK') || resultStr.includes('[BLOCK]');
          const { createTask: createCrFollowTask } = await import('../actions.js');

          if (decision === 'CRITICAL_BLOCK') {
            // 停止 pipeline：写入 P0 告警事件（CRITICAL_BLOCK = L1 安全/架构问题，必须人工介入）
            await pool.query(
              `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3)`,
              ['initiative_pipeline_blocked', 'execution_callback', JSON.stringify({
                project_id: projectId, alert_type: 'critical_block', code_review_task_id: task_id
              })]
            );
            console.warn(`[execution-callback] 断链#4 CRITICAL_BLOCK: initiative pipeline blocked, project=${projectId}`);
          } else if (hasTestBlock) {
            // 集成测试失败：创建修复 task（与 NEEDS_FIX 修复 task 独立，不计入轮次）
            const existingTestFix = await pool.query(
              `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'dev' AND status IN ('queued', 'in_progress') AND payload->>'fix_type' = 'integration_test_failure' LIMIT 1`,
              [projectId]
            );
            if (existingTestFix.rows.length === 0) {
              await createCrFollowTask({
                title: `[修复] 集成测试失败 — ${crTask.title}`,
                description: `Initiative 集成测试失败（TEST_BLOCK），需修复集成测试后重新走 code_review。\n原始 code_review task_id: ${task_id}\n请检查最后一个 dev task 的集成测试日志，修复测试失败原因。`,
                priority: 'P0',
                project_id: projectId,
                goal_id: crTask.goal_id,
                task_type: 'dev',
                trigger_source: 'execution_callback_auto',
                payload: { fix_type: 'integration_test_failure', parent_task_id: task_id }
              });
              console.log(`[execution-callback] 断链#4 TEST_BLOCK: 创建集成测试修复 dev task project=${projectId}`);
            } else {
              console.log(`[execution-callback] 断链#4 TEST_BLOCK: 已有集成测试修复 task，跳过 project=${projectId}`);
            }
          } else if (decision === 'NEEDS_FIX') {
            // 代码问题: 检查修复轮次上限，防止死循环
            const MAX_FIX_ROUNDS = 3;
            const fixCountRow = await pool.query(
              `SELECT COUNT(*)::int as cnt FROM tasks WHERE project_id = $1 AND task_type = 'dev' AND payload->>'fix_type' = 'code_review_issues'`,
              [projectId]
            );
            const fixRound = fixCountRow.rows[0]?.cnt || 0;
            const nextFixRound = fixRound + 1;
            if (nextFixRound > MAX_FIX_ROUNDS) {
              await pool.query(
                `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3)`,
                ['initiative_max_fixes_exceeded', 'execution_callback', JSON.stringify({
                  project_id: projectId, fix_round: fixRound, code_review_task_id: task_id
                })]
              );
              console.warn(`[execution-callback] 断链#4 NEEDS_FIX: 超过 ${MAX_FIX_ROUNDS} 轮修复 → P0告警 project=${projectId}`);
            } else {
              const existingFix = await pool.query(
                `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'dev' AND status IN ('queued', 'in_progress') AND title LIKE '[修复]%' LIMIT 1`,
                [projectId]
              );
              if (existingFix.rows.length === 0) {
                await createCrFollowTask({
                  title: `[修复] code_review 问题修复 R${nextFixRound} — ${crTask.title}`,
                  description: `Initiative code_review 发现代码问题（NEEDS_FIX），需修复后重新走 code_review。\n原始 code_review task_id: ${task_id}\n修复轮次: ${nextFixRound}/${MAX_FIX_ROUNDS}\n修复清单参见 code_review 报告。`,
                  priority: 'P1',
                  project_id: projectId,
                  goal_id: crTask.goal_id,
                  task_type: 'dev',
                  trigger_source: 'execution_callback_auto',
                  payload: { fix_type: 'code_review_issues', parent_task_id: task_id, revision_round: nextFixRound }
                });
                console.log(`[execution-callback] 断链#4 NEEDS_FIX R${nextFixRound}: 创建修复 dev task project=${projectId}`);
              }
            }
          } else {
            // PASS: 创建 initiative_verify
            const existingIv = await pool.query(
              `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'initiative_verify' AND status IN ('queued', 'in_progress') LIMIT 1`,
              [projectId]
            );
            if (existingIv.rows.length > 0) {
              console.log(`[execution-callback] initiative_verify already queued for project ${projectId}, skip`);
            } else {
              await createCrFollowTask({
                title: `[验收] initiative_verify — ${crTask.title}`,
                description: `code_review「${crTask.title}」已完成（PASS），开始 Initiative 验收（DoD 检查）。\n原始 code_review task_id: ${task_id}`,
                priority: 'P1',
                project_id: projectId,
                goal_id: crTask.goal_id,
                task_type: 'initiative_verify',
                trigger_source: 'execution_callback_auto',
                payload: { parent_task_id: task_id, code_review_task_id: task_id }
              });
              console.log(`[execution-callback] 断链#4 PASS: initiative_verify created project=${projectId}`);
            }
          }
        } else if (crTask?.task_type === 'code_review') {
          console.log(`[execution-callback] code_review=${task_id} scope=${crPayload.scope || 'none'}, not initiative-level, skip`);
        }
      } catch (crErr) {
        console.error(`[execution-callback] code_review routing failed (non-fatal): ${crErr.message}`);
      }

      // 5c8b. Codex Gate 审查任务完成 → 将审查结论写入任务自身 + 父任务的 review_result
      // 适用类型：prd_review, spec_review, code_review_gate, initiative_review
      const REVIEW_TASK_TYPES = new Set(['prd_review', 'spec_review', 'code_review_gate', 'initiative_review']);
      try {
        const reviewRow = await pool.query(
          'SELECT task_type, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const reviewTask = reviewRow.rows[0];

        if (reviewTask && REVIEW_TASK_TYPES.has(reviewTask.task_type)) {
          const reviewPayload = reviewTask.payload || {};
          const parentTaskId = reviewPayload.parent_task_id;

          // 从 req.body 提取审查结论
          const resultObj = typeof result === 'object' && result !== null ? result : {};
          const decision = resultObj.decision || (typeof result === 'string' ? result : 'PASS');
          const summary = resultObj.summary || (typeof result === 'string' ? result : '');
          const l1Count = resultObj.l1_count ?? 0;
          const l2Count = resultObj.l2_count ?? 0;

          // 构建 review_result 字符串
          const reviewResultText = [
            `决定: ${decision}`,
            summary ? `摘要: ${summary}` : '',
            `L1问题: ${l1Count}, L2问题: ${l2Count}`,
          ].filter(Boolean).join('\n');

          // 1. 写入审查任务自身的 review_result
          await pool.query(
            'UPDATE tasks SET review_result = $1 WHERE id = $2',
            [reviewResultText, task_id]
          );
          console.log(`[execution-callback] review_result 写入 ${reviewTask.task_type} task ${task_id}, decision=${decision}`);

          // 2. 写入父任务的 review_result（供父任务查看审查结论）
          if (parentTaskId) {
            await pool.query(
              'UPDATE tasks SET review_result = $1 WHERE id = $2',
              [reviewResultText, parentTaskId]
            );
            console.log(`[execution-callback] review_result 写入 parent task ${parentTaskId}, decision=${decision}`);
          } else {
            console.warn(`[execution-callback] ${reviewTask.task_type} ${task_id} 无 parent_task_id，仅写入自身 review_result`);
          }
        }
      } catch (reviewErr) {
        console.error(`[execution-callback] review_result 写入失败 (non-fatal): ${reviewErr.message}`);
      }

      // 5c11. 串行调度: dev task 完成（有 sequence_order）→ 解锁并注入上下文到下一个串行 task
      // 适用场景：Initiative 内有明确依赖顺序的 dev tasks
      // 触发条件：payload.sequence_order != null && payload.depends_on_prev = true（由下一个 task 携带）
      // 独立 task（sequence_order=null）直接走断链#5，不受影响
      try {
        const seqRow = await pool.query(
          'SELECT task_type, project_id, goal_id, title, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const seqTask = seqRow.rows[0];
        if (seqTask?.task_type === 'dev' && seqTask.project_id && seqTask.payload?.sequence_order != null) {
          const projectId = seqTask.project_id;
          const currentSeq = Number(seqTask.payload.sequence_order);
          // 找 sequence_order = currentSeq + 1 且 status = 'blocked' 且 depends_on_prev = true 的下一个 task
          const nextTaskRow = await pool.query(
            `SELECT id, title, payload FROM tasks
             WHERE project_id = $1 AND task_type = 'dev' AND status = 'blocked'
               AND (payload->>'sequence_order')::int = $2
               AND payload->>'depends_on_prev' = 'true'
             LIMIT 1`,
            [projectId, currentSeq + 1]
          );
          if (nextTaskRow.rows.length > 0) {
            const nextTask = nextTaskRow.rows[0];
            // 构建 prev_task_result 上下文（注入到下一个 task 的 payload）
            const prevTaskResult = {
              task_id: task_id,
              summary: typeof result === 'object' && result !== null
                ? (result.summary || result.findings || 'completed')
                : String(result || 'completed'),
              pr_url: pr_url || null,
              sequence_order: currentSeq
            };
            const newPayload = { ...(nextTask.payload || {}), prev_task_result: prevTaskResult };
            // 原子性：更新 payload + unblock（blocked → queued）
            await pool.query(
              `UPDATE tasks SET status = 'queued', payload = $1::jsonb,
               blocked_at = NULL, blocked_reason = NULL, blocked_detail = NULL,
               blocked_until = NULL, started_at = NULL, updated_at = NOW()
               WHERE id = $2 AND status = 'blocked'`,
              [JSON.stringify(newPayload), nextTask.id]
            );
            console.log(`[execution-callback] 串行调度: task=${task_id} (seq=${currentSeq}) → 解锁 next=${nextTask.id} (seq=${currentSeq + 1}) with prev_task_result`);
          } else {
            console.log(`[execution-callback] 串行调度: task=${task_id} (seq=${currentSeq}) 无下一个串行 task，由断链#5 继续`);
          }
        }
      } catch (serialErr) {
        console.error(`[execution-callback] dev 串行调度失败 (non-fatal): ${serialErr.message}`);
      }

      // 5c-harness. Harness v2.0 官方三层断链
      // Layer 1: sprint_planner 完成 → sprint_contract_propose（第1个Sprint协商）
      // Layer 2: sprint_contract_propose 完成 → sprint_contract_review
      //          sprint_contract_review APPROVED → sprint_generate
      //          sprint_contract_review REVISION → sprint_contract_propose（带反馈重来）
      // Layer 3: sprint_generate 完成 → sprint_evaluate
      //          sprint_evaluate PASS → 检查PRD是否完成 → 下一个contract_propose或arch_review
      //          sprint_evaluate FAIL → sprint_fix → sprint_evaluate
      try {
        const harnessRow = await pool.query(
          'SELECT task_type, project_id, goal_id, title, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const harnessTask = harnessRow.rows[0];
        const harnessPayload = harnessTask?.payload || {};
        const { createTask: createHarnessTask } = await import('../actions.js');

        // Layer 1: sprint_planner 完成 → 创建第1个 sprint_contract_propose
        if (harnessTask?.task_type === 'sprint_planner') {
          const sprintDir = 'sprints/sprint-1';
          await createHarnessTask({
            title: `[Contract] sprint-1 P1`,
            description: `Generator 根据 PRD 提出 Sprint 1 的合同草案（功能清单+验收标准）。\nPRD task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'sprint_contract_propose',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: sprintDir,
              sprint_num: 1,
              planner_task_id: task_id,
              propose_round: 1,
              harness_mode: true
            }
          });
          console.log(`[execution-callback] harness: sprint_planner ${task_id} → sprint_contract_propose created`);
        }

        // Layer 2a: sprint_contract_propose 完成 → sprint_contract_review
        if (harnessTask?.task_type === 'sprint_contract_propose') {
          await createHarnessTask({
            title: `[Contract Review] sprint-${harnessPayload.sprint_num} R${harnessPayload.propose_round || 1}`,
            description: `Evaluator 审查合同草案，找出不清晰的验收标准和遗漏的边界情况。\npropose task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'sprint_contract_review',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              sprint_num: harnessPayload.sprint_num,
              planner_task_id: harnessPayload.planner_task_id,
              propose_task_id: task_id,
              propose_round: harnessPayload.propose_round || 1,
              harness_mode: true
            }
          });
          console.log(`[execution-callback] harness: sprint_contract_propose ${task_id} → sprint_contract_review created`);
        }

        // Layer 2b: sprint_contract_review 完成 → APPROVED/REVISION 路由
        if (harnessTask?.task_type === 'sprint_contract_review') {
          // SC-1: 严格解析 verdict — 当 result 是对象且含 verdict 字段时，直接用严格等号，不走文本正则
          let reviewVerdict = 'REVISION';
          if (result !== null && typeof result === 'object' && result.verdict) {
            // 对象类型优先：严格比较（不用正则，避免 "部分 APPROVED" 误判）
            reviewVerdict = result.verdict.toUpperCase() === 'APPROVED' ? 'APPROVED' : 'REVISION';
          } else {
            // 降级：文本正则（兼容旧格式）
            const reviewResultRaw = typeof result === 'object' ? (result?.decision || result?.result || '') : (result || '');
            const reviewText = typeof reviewResultRaw === 'string' ? reviewResultRaw : JSON.stringify(reviewResultRaw);
            if (/"verdict"\s*:\s*"APPROVED"/i.test(reviewText) || /\bAPPROVED\b/.test(reviewText)) {
              reviewVerdict = 'APPROVED';
            }
          }
          console.log(`[execution-callback] harness: sprint_contract_review verdict=${reviewVerdict}`);

          if (reviewVerdict === 'APPROVED') {
            // 合同获批 → 创建 sprint_generate（Generator 写代码）
            await createHarnessTask({
              title: `[Generator] sprint-${harnessPayload.sprint_num} 写代码`,
              description: `Generator 根据已批准的 Sprint Contract 写代码。\ncontract_review task_id: ${task_id}`,
              priority: 'P1',
              project_id: harnessTask.project_id,
              goal_id: harnessTask.goal_id,
              task_type: 'sprint_generate',
              trigger_source: 'execution_callback_harness',
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                sprint_num: harnessPayload.sprint_num,
                planner_task_id: harnessPayload.planner_task_id,
                harness_mode: true
              }
            });
            console.log(`[execution-callback] harness: sprint_contract_review APPROVED → sprint_generate created (sprint ${harnessPayload.sprint_num})`);
          } else {
            // 合同被挑战 → 重新提案（带反馈）
            const nextRound = (harnessPayload.propose_round || 1) + 1;
            await createHarnessTask({
              title: `[Contract] sprint-${harnessPayload.sprint_num} P${nextRound}`,
              description: `Generator 根据 Evaluator 反馈修改合同草案（第${nextRound}轮）。\nreview task_id: ${task_id}`,
              priority: 'P1',
              project_id: harnessTask.project_id,
              goal_id: harnessTask.goal_id,
              task_type: 'sprint_contract_propose',
              trigger_source: 'execution_callback_harness',
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                sprint_num: harnessPayload.sprint_num,
                planner_task_id: harnessPayload.planner_task_id,
                propose_round: nextRound,
                review_feedback_task_id: task_id,
                harness_mode: true
              }
            });
            console.log(`[execution-callback] harness: sprint_contract_review REVISION → sprint_contract_propose R${nextRound} created`);
          }
        }

        // Layer 3a: sprint_generate 完成 → 创建 sprint_evaluate
        if (harnessTask?.task_type === 'sprint_generate' || (harnessTask?.task_type === 'dev' && harnessPayload.harness_mode)) {
          const { createTask: createHarnessTask } = await import('../actions.js');
          const sprintLabelEval = harnessPayload.sprint_dir ? harnessPayload.sprint_dir.split('/').pop() : 'sprint';
          await createHarnessTask({
            title: `[Evaluator] ${sprintLabelEval} R1`,
            description: `Evaluator 对 Generator 的代码进行对抗性验证。读取 sprint-contract.md，逐条测试运行中的代码。\n原始 sprint_generate task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'sprint_evaluate',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              sprint_num: harnessPayload.sprint_num,
              dev_task_id: harnessPayload.dev_task_id || task_id,
              planner_task_id: harnessPayload.planner_task_id,
              eval_round: 1,
              harness_mode: true
            }
          });
          console.log(`[execution-callback] harness: sprint_generate ${task_id} → sprint_evaluate created`);
        }

        // sprint_evaluate 完成 → 根据 verdict 路由
        if (harnessTask?.task_type === 'sprint_evaluate') {
          // Bug fix: result=null 表示 Evaluator 会话崩溃（未能写回结果）
          // 此场景不应创建 sprint_fix（无 evaluation.md 可读），而应重试 sprint_evaluate
          if (result === null) {
            const evalRound = harnessPayload.eval_round || 0;
            const MAX_EVAL_ROUNDS = 15;
            if (evalRound >= MAX_EVAL_ROUNDS) {
              // 安全阀：超过最大轮次，记录警告并停止循环（不再派发任何任务）
              console.error(`[execution-callback] harness: sprint_evaluate result=null at round ${evalRound} >= MAX(${MAX_EVAL_ROUNDS}), stopping loop`);
            } else {
              // 重试：Evaluator 会话崩溃，重新派发 sprint_evaluate（而非 sprint_fix）
              console.warn(`[execution-callback] harness: sprint_evaluate result=null (session crash) at round ${evalRound}, retrying evaluation`);
              await createHarnessTask({
                title: `[Evaluator] ${harnessPayload.sprint_dir ? harnessPayload.sprint_dir.split('/').pop() : 'sprint'} R${evalRound + 1} (retry)`,
                description: `Evaluator 会话崩溃（result=null），重新派发评估。\n原始 sprint_evaluate task_id: ${task_id}`,
                priority: 'P1',
                project_id: harnessTask.project_id,
                goal_id: harnessTask.goal_id,
                task_type: 'sprint_evaluate',
                trigger_source: 'execution_callback_harness',
                payload: {
                  sprint_dir: harnessPayload.sprint_dir,
                  sprint_num: harnessPayload.sprint_num,
                  dev_task_id: harnessPayload.dev_task_id,
                  planner_task_id: harnessPayload.planner_task_id,
                  eval_round: evalRound + 1,
                  harness_mode: true,
                  retry_reason: 'evaluator_session_crash'
                }
              });
              console.log(`[execution-callback] harness: sprint_evaluate result=null → sprint_evaluate retry (round=${evalRound + 1})`);
            }
          } else {
          // verdict 解析：兼容对象和字符串（cecelia-run webhook 可能传纯文本）
          let resultObj = typeof result === 'object' && result !== null ? result : {};
          if (typeof result === 'string') {
            // 尝试完整 JSON 解析
            try {
              const parsed = JSON.parse(result);
              if (parsed && typeof parsed === 'object' && parsed.verdict) resultObj = parsed;
            } catch {
              // 非 JSON，尝试正则提取 verdict
              const verdictMatch = result.match(/"verdict"\s*:\s*"(PASS|FAIL)"/i);
              if (verdictMatch) {
                resultObj = { verdict: verdictMatch[1].toUpperCase() };
              }
            }
          }
          // Bug fix: 先检查 nested result.result.verdict（对象嵌套场景）
          // 场景：Evaluator 回调 { result: { verdict: "PASS", ... } }
          if (!resultObj.verdict && typeof resultObj.result === 'object' && resultObj.result !== null && resultObj.result.verdict) {
            resultObj.verdict = resultObj.result.verdict;
          }
          // 如果顶层没有 verdict，从 summary/findings/result 字符串中提取
          if (!resultObj.verdict) {
            const resultStr = typeof resultObj.result === 'string' ? resultObj.result : '';
            const textToSearch = resultObj.summary || resultObj.findings || resultStr || (typeof result === 'string' ? result : '');
            if (typeof textToSearch === 'string') {
              const verdictMatch = textToSearch.match(/"verdict"\s*:\s*"(PASS|FAIL)"/i);
              if (verdictMatch) {
                resultObj.verdict = verdictMatch[1].toUpperCase();
              }
            }
          }
          const verdict = resultObj.verdict || 'FAIL';
          console.log(`[execution-callback] harness: sprint_evaluate verdict=${verdict} (result type=${typeof result})`);
          const devTaskId = harnessPayload.dev_task_id;

          if (verdict === 'PASS') {
            // 官方流程: PASS → 触发下一个 Sprint 的合同协商
            // Generator（sprint_generate）决定是否还有更多 Sprint 需要做
            // 通过 result.more_sprints 字段传递（true=继续，false/missing=全部完成）
            const sprintNum = harnessPayload.sprint_num || 1;
            const moreSprints = resultObj.more_sprints !== false; // 默认继续，除非明确说false

            console.log(`[execution-callback] harness: sprint_evaluate PASS sprint=${sprintNum} more_sprints=${moreSprints}`);

            if (moreSprints) {
              // 开始下一个 Sprint 的合同协商
              const nextSprintNum = sprintNum + 1;
              const nextSprintDir = `sprints/sprint-${nextSprintNum}`;
              // 幂等检查
              const existingNext = await pool.query(
                `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'sprint_contract_propose'
                 AND (payload->>'sprint_num')::int = $2 AND status IN ('queued','in_progress') LIMIT 1`,
                [harnessTask.project_id, nextSprintNum]
              );
              if (existingNext.rows.length === 0) {
                await createHarnessTask({
                  title: `[Contract] sprint-${nextSprintNum} P1`,
                  description: `Sprint ${sprintNum} PASS。Generator 提出 Sprint ${nextSprintNum} 的合同草案。`,
                  priority: 'P1',
                  project_id: harnessTask.project_id,
                  goal_id: harnessTask.goal_id,
                  task_type: 'sprint_contract_propose',
                  trigger_source: 'execution_callback_harness',
                  payload: {
                    sprint_dir: nextSprintDir,
                    sprint_num: nextSprintNum,
                    planner_task_id: harnessPayload.planner_task_id,
                    propose_round: 1,
                    prev_sprint_num: sprintNum,
                    harness_mode: true
                  }
                });
                console.log(`[execution-callback] harness: sprint_evaluate PASS → sprint_contract_propose for sprint ${nextSprintNum}`);
              }
            } else {
              // Generator 说没有更多 Sprint → arch_review（Initiative 整体验收）
              const existingAr = await pool.query(
                `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'arch_review'
                 AND payload->>'scope' = 'initiative' AND status IN ('queued', 'in_progress') LIMIT 1`,
                [harnessTask.project_id]
              );
              if (existingAr.rows.length === 0) {
                await createHarnessTask({
                  title: `[验收] Initiative 整体审查 — Harness 完成`,
                  description: `所有 Sprint PASS，Generator 确认 PRD 全部实现。执行 Initiative 级整体验收。`,
                  priority: 'P1',
                  project_id: harnessTask.project_id,
                  goal_id: harnessTask.goal_id,
                  task_type: 'arch_review',
                  trigger_source: 'execution_callback_harness',
                  payload: { scope: 'initiative', trigger: 'all_sprints_passed', harness_mode: true }
                });
                console.log(`[execution-callback] harness: all sprints PASS → arch_review created`);
              }
            }
          } else {
            // FAIL: 创建 sprint_fix
            await createHarnessTask({
              title: `[Fix] ${harnessPayload.sprint_dir ? harnessPayload.sprint_dir.split('/').pop() : 'sprint'} R${(harnessPayload.eval_round || 0) + 1}`,
              description: `Evaluator 发现问题，Generator 需要修复。读取 evaluation.md 中的具体问题列表。\n原始 sprint_evaluate task_id: ${task_id}`,
              priority: 'P1',
              project_id: harnessTask.project_id,
              goal_id: harnessTask.goal_id,
              task_type: 'sprint_fix',
              trigger_source: 'execution_callback_harness',
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                dev_task_id: harnessPayload.dev_task_id,
                eval_round: (harnessPayload.eval_round || 0) + 1,
                harness_mode: true
              }
            });
            console.log(`[execution-callback] harness: sprint_evaluate FAIL → sprint_fix created (round=${(harnessPayload.eval_round || 0) + 1})`);
          }
          } // end else (result !== null)
        }

        // sprint_fix 完成 → 创建新的 sprint_evaluate（再测）
        if (harnessTask?.task_type === 'sprint_fix') {
          await createHarnessTask({
            title: `[Evaluator] ${harnessPayload.sprint_dir ? harnessPayload.sprint_dir.split('/').pop() : 'sprint'} R${harnessPayload.eval_round || 1}`,
            description: `Generator 已修复，Evaluator 重新验证。\n原始 sprint_fix task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'sprint_evaluate',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              sprint_num: harnessPayload.sprint_num,
              dev_task_id: harnessPayload.dev_task_id,
              planner_task_id: harnessPayload.planner_task_id,
              eval_round: harnessPayload.eval_round || 1,
              harness_mode: true
            }
          });
          console.log(`[execution-callback] harness: sprint_fix ${task_id} → sprint_evaluate created (round=${harnessPayload.eval_round || 1})`);
        }
      } catch (harnessErr) {
        console.error(`[execution-callback] harness sprint loop error (non-fatal): ${harnessErr.message}`, harnessErr.stack);
      }

      // 5c9. 断链 #5: dev 完成 → 检查同 project 所有 dev 是否全完成 → 创建 code_review (Initiative 级别)
      // ⚠️ Harness 模式的 Initiative 不走此断链（sprint_evaluate PASS 时已处理）
      try {
        const devRow = await pool.query('SELECT task_type, project_id, goal_id, title, payload FROM tasks WHERE id = $1', [task_id]);
        const devTask = devRow.rows[0];
        if (devTask?.task_type === 'dev' && devTask.project_id && !devTask.payload?.harness_mode) {
          const projectId = devTask.project_id;
          // 检查是否还有未完成的 dev task
          const pendingDev = await pool.query(
            `SELECT COUNT(*) AS cnt FROM tasks WHERE project_id = $1 AND task_type = 'dev' AND status NOT IN ('completed', 'failed', 'cancelled', 'quarantined')`,
            [projectId]
          );
          const pendingCnt = parseInt(pendingDev.rows[0]?.cnt || 0);
          if (pendingCnt === 0) {
            // 所有 dev 已完成，幂等检查 code_review
            const existingCr = await pool.query(
              `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'code_review' AND status IN ('queued', 'in_progress') LIMIT 1`,
              [projectId]
            );
            if (existingCr.rows.length > 0) {
              console.log(`[execution-callback] code_review already queued for project ${projectId}, skip`);
            } else {
              const { createTask: createCrTask } = await import('../actions.js');
              await createCrTask({
                title: `[Initiative 审查] code_review — ${devTask.title}`,
                description: `Initiative 级别代码审查。所有 dev task 已完成，运行集成测试 + 代码质量审查。\nproject_id: ${projectId}`,
                priority: 'P1',
                project_id: projectId,
                goal_id: devTask.goal_id,
                task_type: 'code_review',
                payload: { scope: 'initiative', initiative_id: projectId, parent_task_id: task_id }
              });
              console.log(`[execution-callback] 断链#5 修复: code_review created for project ${projectId} (all dev completed)`);
            }
          } else {
            console.log(`[execution-callback] dev task completed for project ${projectId}, but ${pendingCnt} dev task(s) still pending, skip code_review`);
          }
        }
      } catch (devCrErr) {
        console.error(`[execution-callback] dev → code_review creation failed (non-fatal): ${devCrErr.message}`);
      }

      // 5c10. 断链 #6: initiative_verify 完成 → 根据 verdict 处理结论
      // - APPROVED → project status = 'completed'
      // - NEEDS_REVISION (≤3轮) → 创建修订 dev task
      // - NEEDS_REVISION (>3轮) → cecelia_events P0告警
      // - REJECTED → cecelia_events P0告警
      try {
        const ivRow = await pool.query(
          'SELECT task_type, project_id, goal_id, title, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const ivTask = ivRow.rows[0];
        if (ivTask?.task_type === 'initiative_verify') {
          const projectId = ivTask.project_id;
          const resultObj = typeof result === 'object' && result !== null ? result : {};
          const verdict = resultObj.verdict || 'APPROVED';
          const revisionRound = ivTask.payload?.revision_round || 0;
          const MAX_REVISION_ROUNDS = 3;
          const { createTask: createIvFollowTask } = await import('../actions.js');

          if (verdict === 'APPROVED') {
            await pool.query(
              `UPDATE okr_initiatives SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [projectId]
            );
            console.log(`[execution-callback] 断链#6 APPROVED: initiative ${projectId} → completed`);
          } else if (verdict === 'NEEDS_REVISION') {
            const nextRevisionRound = revisionRound + 1;
            if (nextRevisionRound > MAX_REVISION_ROUNDS) {
              await pool.query(
                `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3)`,
                ['initiative_max_revisions_exceeded', 'execution_callback', JSON.stringify({
                  project_id: projectId, revision_round: revisionRound, initiative_verify_task_id: task_id
                })]
              );
              console.warn(`[execution-callback] 断链#6 NEEDS_REVISION: 超过 ${MAX_REVISION_ROUNDS} 轮 → P0告警 project=${projectId}`);
            } else {
              const existingFix = await pool.query(
                `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'dev' AND status IN ('queued', 'in_progress') AND title LIKE '[修订]%' LIMIT 1`,
                [projectId]
              );
              if (existingFix.rows.length === 0) {
                await createIvFollowTask({
                  title: `[修订] initiative_verify 问题修复 R${nextRevisionRound} — ${ivTask.title}`,
                  description: `Initiative verify 发现问题（NEEDS_REVISION），第 ${nextRevisionRound} 轮修订。\n修订清单参见 initiative_verify 报告。\n原始 task_id: ${task_id}`,
                  priority: 'P1',
                  project_id: projectId,
                  goal_id: ivTask.goal_id,
                  task_type: 'dev',
                  trigger_source: 'execution_callback_auto',
                  payload: { fix_type: 'initiative_verify_revision', parent_task_id: task_id, revision_round: nextRevisionRound }
                });
                console.log(`[execution-callback] 断链#6 NEEDS_REVISION R${nextRevisionRound}: 修订 dev task created project=${projectId}`);
              }
            }
          } else if (verdict === 'REJECTED') {
            await pool.query(
              `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3)`,
              ['initiative_rejected', 'execution_callback', JSON.stringify({
                project_id: projectId, initiative_verify_task_id: task_id
              })]
            );
            console.warn(`[execution-callback] 断链#6 REJECTED: P0告警 project=${projectId}`);
          }
        }
      } catch (ivErr) {
        console.error(`[execution-callback] initiative_verify 结论处理失败 (non-fatal): ${ivErr.message}`);
      }
    }

    // 5c5. Suggestion Plan 闭环：suggestion_plan 完成/失败 → 更新 suggestion.status
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        const spResult = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const spRow = spResult.rows[0];

        if (spRow?.task_type === 'suggestion_plan') {
          const suggestionId = spRow?.payload?.suggestion_id;
          if (suggestionId) {
            const suggestionStatus = newStatus === 'completed' ? 'processed' : 'failed';
            await pool.query(
              `UPDATE suggestions SET status = $1, updated_at = NOW() WHERE id = $2`,
              [suggestionStatus, suggestionId]
            );
            console.log(`[execution-callback] Suggestion ${suggestionId} → ${suggestionStatus} (suggestion_plan task ${task_id})`);
          }
        }
      } catch (spErr) {
        // best-effort：失败不影响主流程
        console.error(`[execution-callback] Suggestion status update error (non-fatal): ${spErr.message}`);
      }
    }

    // 5c11. content-* pipeline 子任务完成/失败 → 推进 Pipeline 状态机
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        const { advanceContentPipeline, PIPELINE_STAGES } = await import('../content-pipeline-orchestrator.js');
        const cpTaskRow = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const cpTask = cpTaskRow.rows[0];
        if (cpTask && PIPELINE_STAGES.includes(cpTask.task_type) && cpTask.payload?.parent_pipeline_id) {
          let findingsVal = null;
          try { findingsVal = findingsValue ? JSON.parse(findingsValue) : null; } catch (_) {}
          const advResult = await advanceContentPipeline(task_id, newStatus, findingsVal);
          if (advResult.advanced) {
            console.log(`[execution-callback] content pipeline 推进: task=${task_id} type=${cpTask.task_type} action=${advResult.action}`);
          }
        }
      } catch (cpErr) {
        console.error(`[execution-callback] content pipeline advance error (non-fatal): ${cpErr.message}`);
      }
    }

    // 5c13. crystallize_* 子任务完成/失败 → 推进 crystallize 流水线状态机
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        const { advanceCrystallizeStage, CRYSTALLIZE_STAGES } = await import('../crystallize-orchestrator.js');
        const crTaskRow = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const crTask = crTaskRow.rows[0];
        if (crTask && CRYSTALLIZE_STAGES.includes(crTask.task_type) && crTask.payload?.parent_crystallize_id) {
          let findingsObj = null;
          try { findingsObj = findingsValue ? JSON.parse(findingsValue) : null; } catch (_) {}
          await advanceCrystallizeStage(task_id, newStatus, findingsObj || {});
          console.log(`[execution-callback] crystallize 流水线推进: task=${task_id} type=${crTask.task_type} newStatus=${newStatus}`);
        }
      } catch (crErr) {
        console.error(`[execution-callback] crystallize advance error (non-fatal): ${crErr.message}`);
      }
    }

    // 5c12. 串行降级: dev task 失败（有 sequence_order）→ 取消后续所有 blocked 串行 task
    // 避免后续 task 永久僵尸（blocked 状态无人解锁）
    // ⚠️ 必须在 if (newStatus === 'completed') 块外面，因为 failed/quarantined 不进 completed 分支
    if (newStatus === 'failed' || newStatus === 'quarantined') {
      try {
        const failedSeqRow = await pool.query(
          'SELECT task_type, project_id, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const failedSeqTask = failedSeqRow.rows[0];
        if (failedSeqTask?.task_type === 'dev' && failedSeqTask.project_id && failedSeqTask.payload?.sequence_order != null) {
          const projectId = failedSeqTask.project_id;
          const failedSeq = Number(failedSeqTask.payload.sequence_order);
          // 将所有 sequence_order > failedSeq 的 blocked dev task 标记为 cancelled
          const cancelResult = await pool.query(
            `UPDATE tasks SET status = 'cancelled', blocked_reason = 'dependency_failed',
             updated_at = NOW()
             WHERE project_id = $1 AND task_type = 'dev' AND status = 'blocked'
               AND (payload->>'sequence_order')::int > $2
             RETURNING id`,
            [projectId, failedSeq]
          );
          if (cancelResult.rows.length > 0) {
            console.warn(`[execution-callback] 断链#5c12: 串行 task ${task_id} (seq=${failedSeq}) 失败，取消后续 ${cancelResult.rows.length} 个 blocked task: [${cancelResult.rows.map(r => r.id).join(', ')}]`);
          }
        }
      } catch (serialFailErr) {
        console.error(`[execution-callback] 串行失败降级错误 (non-fatal): ${serialFailErr.message}`);
      }
    }

    // 5c13. 全字段皆空兜底：当 result/exit_code/stderr/failure_class 全部缺失时注入 no_diagnostic
    // 场景：cecelia-run 异常退出但未提供任何诊断信息，DB 记录零信息无法追踪
    if (newStatus === 'failed') {
      const _failureClassFromBody = req.body.failure_class || null;
      if (!result && exit_code == null && !stderr && !_failureClassFromBody) {
        try {
          const noDiagMsg = `callback received with no diagnostic data (task_id: ${task_id})`;
          await pool.query(
            `/* no_diagnostic_fallback */ UPDATE tasks SET
               error_message = $2,
               payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb
             WHERE id = $1`,
            [task_id, noDiagMsg, JSON.stringify({ failure_class: 'no_diagnostic' })]
          );
          console.warn(`[execution-callback] no_diagnostic_fallback: task=${task_id} 全字段皆空，已注入 failure_class=no_diagnostic`);
        } catch (noDiagErr) {
          console.error(`[execution-callback] no_diagnostic fallback error (non-fatal): ${noDiagErr.message}`);
        }
      }
    }

    // 5d. Auto-Learning: 自动从任务执行结果中学习
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        const { processExecutionAutoLearning } = await import('../auto-learning.js');
        // 当进程被 kill/超时导致 result=null 时，从 exit_code/stderr/failure_class 合成诊断信息
        // 避免 extractTaskSummary(null) 返回 "No details available"
        const failureClass = req.body.failure_class || null;
        let effectiveResult = result ?? (newStatus === 'failed' && (exit_code != null || stderr || failureClass) ? {
          error: `Process exited with code ${exit_code ?? 'unknown'}`,
          exit_code,
          stderr_tail: String(stderr || '').slice(-500),
          failure_class: failureClass,
          source: 'synthesized_from_callback',
        } : null);
        // 第三层兜底：全字段皆空 effectiveResult 仍为 null 时，从 DB error_message 构造最小诊断对象
        // 场景：5c13 已将 error_message 写入 DB，auto-learning 应能获取到诊断信息
        if (effectiveResult === null && newStatus === 'failed') {
          try {
            const dbRow = await pool.query('SELECT error_message FROM tasks WHERE id = $1', [task_id]);
            const dbErrMsg = dbRow.rows[0]?.error_message || null;
            if (dbErrMsg) {
              effectiveResult = { error: dbErrMsg, source: 'db_fallback' };
              console.log(`[execution-callback] effectiveResult db_fallback: task=${task_id} error=${dbErrMsg.slice(0, 100)}`);
            }
          } catch (dbFallbackErr) {
            console.error(`[execution-callback] effectiveResult db_fallback error (non-fatal): ${dbFallbackErr.message}`);
          }
        }
        const learningResult = await processExecutionAutoLearning(task_id, newStatus, effectiveResult, {
          trigger_source: 'execution_callback',
          retry_count: iterations,
          iterations: iterations,
          metadata: {
            run_id,
            duration_ms,
            pr_url: pr_url || null
          }
        });

        if (learningResult) {
          console.log(`[execution-callback] Auto-learning created: ${learningResult.title} (id: ${learningResult.id})`);
        }
      } catch (autoLearningErr) {
        console.error(`[execution-callback] Auto-learning error (non-fatal): ${autoLearningErr.message}`);
        // Continue with normal flow - auto-learning failure should not affect main functionality
      }
    }

    // 5b. Dependency cascade: propagate failure or recover chain
    try {
      const { propagateDependencyFailure, recoverDependencyChain } = await import('../dep-cascade.js');
      if (newStatus === 'failed' || newStatus === 'quarantined') {
        const cascade = await propagateDependencyFailure(task_id);
        if (cascade.affected.length > 0) {
          console.log(`[execution-callback] Dependency cascade: ${cascade.affected.length} tasks marked dep_failed`);
        }
      } else if (newStatus === 'completed') {
        const recovery = await recoverDependencyChain(task_id);
        if (recovery.recovered.length > 0) {
          console.log(`[execution-callback] Dependency recovery: ${recovery.recovered.length} tasks restored`);
        }
      }
    } catch (depErr) {
      console.error(`[execution-callback] Dependency cascade error (non-fatal): ${depErr.message}`);
    }

    // 6. Event-driven: Trigger next task after completion (with short cooldown to avoid burst refill)
    let nextTickResult = null;
    if (newStatus === 'completed') {
      const CALLBACK_COOLDOWN_MS = 5000; // 5s cooldown prevents instant slot refill on rapid completions
      console.log(`[execution-callback] Task completed, triggering next tick in ${CALLBACK_COOLDOWN_MS}ms...`);
      try {
        await new Promise(resolve => setTimeout(resolve, CALLBACK_COOLDOWN_MS));
        nextTickResult = await runTickSafe('execution-callback');
        console.log(`[execution-callback] Next tick triggered, actions: ${nextTickResult.actions_taken?.length || 0}`);
      } catch (tickErr) {
        console.error(`[execution-callback] Failed to trigger next tick: ${tickErr.message}`);
      }
    }

    res.json({
      success: true,
      task_id,
      new_status: newStatus,
      message: `Task updated to ${newStatus}`,
      next_tick: nextTickResult
    });

  } catch (err) {
    console.error('[execution-callback] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process execution callback',
      details: err.message
    });
  }
});

// ==================== Heartbeat File API ====================


const HEARTBEAT_DEFAULT_TEMPLATE = `# HEARTBEAT.md — Cecelia 巡检清单

## 巡检项目

- [ ] 系统健康检查
- [ ] 任务队列状态
- [ ] 资源使用率
`;

/**
 * GET /api/brain/heartbeat
 * Read HEARTBEAT.md file content.
 * Returns default template if file does not exist.
 */
router.get('/heartbeat', async (req, res) => {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(HEARTBEAT_PATH, 'utf-8');
    res.json({ success: true, content });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ success: true, content: HEARTBEAT_DEFAULT_TEMPLATE });
    }
    console.error('[heartbeat-file] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/brain/heartbeat
 * Write content to HEARTBEAT.md file.
 * Request body: { content: "..." }
 */
router.put('/heartbeat', async (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    const { writeFile } = await import('fs/promises');
    await writeFile(HEARTBEAT_PATH, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('[heartbeat-file] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/heartbeat
 * Heartbeat endpoint for running tasks to report liveness.
 *
 * Request body:
 *   {
 *     task_id: "uuid",
 *     run_id: "run-xxx-timestamp"  // optional, for validation
 *   }
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { task_id, run_id } = req.body;

    if (!task_id) {
      return res.status(400).json({ success: false, error: 'task_id is required' });
    }

    const { recordHeartbeat } = await import('../executor.js');
    const result = await recordHeartbeat(task_id, run_id);

    res.json(result);
  } catch (err) {
    console.error('[heartbeat] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/executor/status
 * Check if cecelia-run executor is available
 */
router.get('/executor/status', async (req, res) => {
  try {
    const { checkCeceliaRunAvailable } = await import('../executor.js');
    const status = await checkCeceliaRunAvailable();
    res.json(status);
  } catch (err) {
    res.status(500).json({
      available: false,
      error: err.message
    });
  }
});

// ==================== Cluster Status API ====================

/**
 * GET /api/brain/cluster/status
 * Get status of all servers in the cluster (US + HK)
 */
router.get('/cluster/status', async (req, res) => {
  try {
    const os = await import('os');

    // Get US VPS slots using same logic as /vps-slots
    let usProcesses = [];
    try {
      const { stdout } = await execAsync('ps aux | grep -E " claude( |$)" | grep -v "grep" | grep -v "/bin/bash"');
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          usProcesses.push({
            pid: parseInt(parts[1]),
            cpu: `${parts[2]}%`,
            memory: `${parts[3]}%`,
            startTime: parts[8],
            command: parts.slice(10).join(' ').slice(0, 80)
          });
        }
      }
    } catch { /* no processes */ }

    const usUsed = usProcesses.length;
    const usCpuLoad = os.loadavg()[0];
    const usCpuCores = os.cpus().length;
    const usMemTotal = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
    const usMemFree = Math.round(getAvailableMemoryMB() / 1024 * 10) / 10;
    const usMemUsedPct = Math.round((1 - getAvailableMemoryMB() / (os.totalmem() / 1024 / 1024)) * 100);

    // 动态计算可用席位 (85% 安全阈值)
    const CPU_PER_CLAUDE = 0.5;
    const MEM_PER_CLAUDE_GB = 1.0;
    const SAFETY_MARGIN = 0.85;

    const usCpuTarget = usCpuCores * SAFETY_MARGIN;
    const usCpuHeadroom = Math.max(0, usCpuTarget - usCpuLoad);
    const usCpuAllowed = Math.floor(usCpuHeadroom / CPU_PER_CLAUDE);
    const usMemAvailable = Math.max(0, usMemFree - 2); // 保留 2GB
    const usMemAllowed = Math.floor(usMemAvailable / MEM_PER_CLAUDE_GB);
    const usDynamicMax = Math.min(usCpuAllowed, usMemAllowed, 12); // 硬上限 12

    const usServer = {
      id: 'us',
      name: 'US VPS',
      location: '🇺🇸 美国',
      ip: '146.190.52.84',
      status: 'online',
      resources: {
        cpu_cores: usCpuCores,
        cpu_load: Math.round(usCpuLoad * 10) / 10,
        cpu_pct: Math.round((usCpuLoad / usCpuCores) * 100),
        mem_total_gb: usMemTotal,
        mem_free_gb: usMemFree,
        mem_used_pct: usMemUsedPct
      },
      slots: {
        max: 12,              // 理论最大
        dynamic_max: usDynamicMax, // 当前资源可支持的最大
        used: usUsed,
        available: Math.max(0, usDynamicMax - usUsed - 1), // 减 1 预留
        reserved: 1,
        processes: usProcesses
      },
      task_types: ['dev', 'review', 'qa', 'audit']
    };

    // HK server status (via bridge)
    let hkServer = {
      id: 'hk',
      name: 'HK VPS',
      location: '🇭🇰 香港',
      ip: '124.156.138.116',
      status: 'offline',
      resources: null,
      slots: {
        max: 5,               // 理论最大
        dynamic_max: 0,       // 当前资源可支持的最大
        used: 0,
        available: 0,
        reserved: 0,
        processes: []
      },
      task_types: ['talk', 'research', 'data']
    };

    // Try to fetch HK status from bridge
    try {
      const hkBridgeUrl = process.env.HK_BRIDGE_URL || 'http://100.86.118.99:5225';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const hkRes = await fetch(`${hkBridgeUrl}/status`, { signal: controller.signal });
      clearTimeout(timeout);

      if (hkRes.ok) {
        const hkData = await hkRes.json();
        const hkResources = hkData.resources || {
          cpu_cores: 4,
          cpu_load: 0,
          cpu_pct: 0,
          mem_total_gb: 7.6,
          mem_free_gb: 5,
          mem_used_pct: 30
        };

        // 计算 HK 动态可用席位
        const hkCpuTarget = hkResources.cpu_cores * SAFETY_MARGIN;
        const hkCpuHeadroom = Math.max(0, hkCpuTarget - hkResources.cpu_load);
        const hkCpuAllowed = Math.floor(hkCpuHeadroom / CPU_PER_CLAUDE);
        const hkMemAvailable = Math.max(0, hkResources.mem_free_gb - 1.5); // HK 保留 1.5GB
        const hkMemAllowed = Math.floor(hkMemAvailable / MEM_PER_CLAUDE_GB);
        const hkDynamicMax = Math.min(hkCpuAllowed, hkMemAllowed, 5); // 硬上限 5
        const hkUsed = hkData.slots?.used || 0;

        hkServer = {
          ...hkServer,
          status: 'online',
          resources: hkResources,
          slots: {
            max: 5,
            dynamic_max: hkDynamicMax,
            used: hkUsed,
            available: Math.max(0, hkDynamicMax - hkUsed),
            reserved: 0,
            processes: hkData.slots?.processes || []
          }
        };
      }
    } catch {
      // HK bridge not available, keep offline status
    }

    // Calculate cluster totals
    const totalSlots = usServer.slots.max + hkServer.slots.max;
    const totalUsed = usServer.slots.used + hkServer.slots.used;
    const totalAvailable = usServer.slots.available + hkServer.slots.available;

    res.json({
      success: true,
      cluster: {
        total_slots: totalSlots,
        total_used: totalUsed,
        total_available: totalAvailable,
        servers: [usServer, hkServer]
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cluster status',
      details: err.message
    });
  }
});

// ==================== Generate API ====================

/**
 * POST /api/brain/generate/prd
 * Generate a PRD from task description
 */
router.post('/generate/prd', async (req, res) => {
  try {
    const { title, description, type = 'feature', goal_id } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    if (goal_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(goal_id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid goal_id format (must be UUID)'
        });
      }

      // 先查 key_results，再查 objectives（向后兼容）
      let goalResult = await pool.query(
        `SELECT id, title,
                CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress,
                metadata->>'priority' AS priority
         FROM key_results WHERE id = $1`,
        [goal_id]
      );
      if (goalResult.rows.length === 0) {
        goalResult = await pool.query(
          `SELECT id, title, NULL::numeric AS progress, NULL::text AS priority FROM objectives WHERE id = $1`,
          [goal_id]
        );
      }
      const goal = goalResult.rows[0];

      let projectData = null;
      if (goal) {
        const linkResult = await pool.query(
          'SELECT id, title AS name, NULL::text AS repo_path FROM okr_projects WHERE kr_id = $1 LIMIT 1',
          [goal_id]
        );
        if (linkResult.rows[0]) {
          projectData = { name: linkResult.rows[0].name, repo_path: linkResult.rows[0].repo_path };
        }
      }

      const prd = generatePrdFromGoalKR({
        title,
        description: description || '',
        kr: goal ? { title: goal.title, progress: goal.progress, priority: goal.priority } : undefined,
        project: projectData || undefined
      });

      if (req.body.format === 'json') {
        return res.json({ success: true, data: prdToJson(prd), metadata: { title, goal_id, goal_found: !!goal, generated_at: new Date().toISOString() } });
      }

      return res.json({
        success: true,
        prd,
        metadata: {
          title,
          goal_id,
          goal_found: !!goal,
          generated_at: new Date().toISOString()
        }
      });
    }

    const validTypes = Object.keys(PRD_TYPE_MAP);
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const prd = generatePrdFromTask({ title, description, type });

    if (req.body.format === 'json') {
      return res.json({ success: true, data: prdToJson(prd), metadata: { title, type, generated_at: new Date().toISOString() } });
    }

    res.json({
      success: true,
      prd,
      metadata: {
        title,
        type,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate PRD',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/generate/trd
 * Generate a TRD from goal description
 */
router.post('/generate/trd', async (req, res) => {
  try {
    const { title, description, milestones = [], kr, project } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    const trd = kr
      ? generateTrdFromGoalKR({ title, description, milestones, kr, project })
      : generateTrdFromGoal({ title, description, milestones });

    if (req.body.format === 'json') {
      return res.json({ success: true, data: trdToJson(trd), metadata: { title, milestones_count: milestones.length, generated_at: new Date().toISOString() } });
    }

    res.json({
      success: true,
      trd,
      metadata: {
        title,
        milestones_count: milestones.length,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate TRD',
      details: err.message
    });
  }
});

// ==================== Validate API ====================

/**
 * POST /api/brain/validate/prd
 * Validate PRD content against standardization rules
 */
router.post('/validate/prd', (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const result = validatePrd(content);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Validation failed', details: err.message });
  }
});

/**
 * POST /api/brain/validate/trd
 * Validate TRD content against standardization rules
 */
router.post('/validate/trd', (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const result = validateTrd(content);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Validation failed', details: err.message });
  }
});

// TRD API — removed (decomposer.js deleted, TRD decomposition now handled by 秋米 /okr)


/**
 * POST /api/brain/goal/compare
 * Compare goal progress against expected progress
 */
router.post('/goal/compare', async (req, res) => {
  try {
    const { goal_id } = req.body;
    const report = await compareGoalProgress(goal_id || null);

    res.json({
      success: true,
      ...report
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to compare goal progress',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decide
 * Generate decision based on current state
 */
router.post('/decide', async (req, res) => {
  try {
    const context = req.body.context || {};
    const decision = await generateDecision(context);

    res.json({
      success: true,
      ...decision
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate decision',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decision/:id/execute
 * Execute a pending decision
 */
router.post('/decision/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeDecision(id);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: 'Failed to execute decision',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decision/:id/rollback
 * Rollback an executed decision
 */
router.post('/decision/:id/rollback', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await rollbackDecision(id);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: 'Failed to rollback decision',
      details: err.message
    });
  }
});

// ==================== VPS Slots API ====================


/**
 * GET /api/brain/slots
 * Three-pool slot allocation status
 */
router.get('/slots', async (req, res) => {
  try {
    const { getSlotStatus } = await import('../slot-allocator.js');
    const status = await getSlotStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/capacity
 * Return current concurrency ceiling configuration
 */
router.get('/capacity', async (req, res) => {
  try {
    const { getBudgetCap, INTERACTIVE_RESERVE } = await import('../executor.js');
    const { budget, physical, effective } = getBudgetCap();
    res.json({
      max_seats: effective,
      physical_capacity: physical,
      budget_cap: budget,
      interactive_reserve: INTERACTIVE_RESERVE,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/brain/budget-cap
 * Set or clear the budget cap (dual-layer capacity model)
 */
router.put('/budget-cap', async (req, res) => {
  try {
    const { setBudgetCap } = await import('../executor.js');
    const result = setBudgetCap(req.body.slots ?? null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/brain/vps-slots
 * Get real Claude process information with task details
 */
router.get('/vps-slots', async (req, res) => {
  try {
    const tickStatus = await getTickStatus();
    const MAX_SLOTS = tickStatus.max_concurrent || 6;

    // Get tracked processes from executor
    let trackedProcesses = [];
    try {
      const { getActiveProcesses } = await import('../executor.js');
      trackedProcesses = getActiveProcesses();
    } catch {
      // executor not available
    }

    // Get Claude processes from OS
    let slots = [];
    try {
      const { stdout } = await execAsync('ps aux | grep -E " claude( |$)" | grep -v "grep" | grep -v "/bin/bash"');
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1]);
          const cpu = parts[2];
          const mem = parts[3];
          const startTime = parts[8];
          const command = parts.slice(10).join(' ');

          // Match PID to tracked process for task details
          const tracked = trackedProcesses.find(p => p.pid === pid);

          slots.push({
            pid,
            cpu: `${cpu}%`,
            memory: `${mem}%`,
            startTime,
            taskId: tracked?.taskId || null,
            runId: tracked?.runId || null,
            startedAt: tracked?.startedAt || null,
            command: command.slice(0, 100) + (command.length > 100 ? '...' : '')
          });
        }
      }
    } catch {
      slots = [];
    }

    // Enrich with task details from DB
    const taskIds = slots.map(s => s.taskId).filter(Boolean);
    let taskMap = {};
    if (taskIds.length > 0) {
      try {
        const result = await pool.query(
          `SELECT id, title, priority, status, task_type FROM tasks WHERE id = ANY($1)`,
          [taskIds]
        );
        for (const row of result.rows) {
          taskMap[row.id] = row;
        }
      } catch {
        // continue without task details
      }
    }

    const enrichedSlots = slots.map(s => {
      const task = s.taskId ? taskMap[s.taskId] : null;
      return {
        ...s,
        taskTitle: task?.title || null,
        taskPriority: task?.priority || null,
        taskType: task?.task_type || null,
      };
    });

    res.json({
      success: true,
      total: MAX_SLOTS,
      used: enrichedSlots.length,
      available: MAX_SLOTS - enrichedSlots.length,
      slots: enrichedSlots
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get VPS slots',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/execution-history
 * Get cecelia execution history from decision_log
 */
router.get('/execution-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    // Get execution records from decision_log where trigger = 'cecelia-executor' or 'tick'
    const result = await pool.query(`
      SELECT
        id,
        trigger,
        input_summary,
        action_result_json,
        status,
        created_at
      FROM decision_log
      WHERE trigger IN ('cecelia-executor', 'tick', 'execution-callback')
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const executions = result.rows.map(row => ({
      id: row.id,
      trigger: row.trigger,
      summary: row.input_summary,
      result: row.action_result_json,
      status: row.status,
      timestamp: row.created_at
    }));

    // Count today's executions
    const todayResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM decision_log
      WHERE trigger IN ('cecelia-executor', 'tick', 'execution-callback')
        AND created_at >= CURRENT_DATE
    `);

    res.json({
      success: true,
      total: executions.length,
      today: parseInt(todayResult.rows[0].count),
      executions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get execution history',
      details: err.message
    });
  }
});

// ==================== Execution Status API ====================

/**
 * GET /api/brain/cecelia/overview
 * Overview of Cecelia execution: running/completed/failed counts + recent runs
 */
router.get('/cecelia/overview', async (req, res) => {
  try {
    const { getActiveProcesses, getActiveProcessCount } = await import('../executor.js');

    // Get task counts from database
    const countsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'in_progress') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM tasks
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    const counts = countsResult.rows[0];

    // Get recent runs (tasks with execution info)
    const recentResult = await pool.query(`
      SELECT
        t.id,
        t.title as project,
        t.status,
        t.priority,
        t.task_type,
        t.created_at as started_at,
        t.completed_at,
        t.payload->>'current_run_id' as run_id,
        t.payload->>'run_status' as run_status,
        t.payload->'last_run_result' as last_result,
        COALESCE(t.payload->>'feature_branch', '') as feature_branch
      FROM tasks t
      WHERE t.created_at >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    // Map to expected format
    const recentRuns = recentResult.rows.map(row => ({
      id: row.id,
      project: row.project || 'Unknown',
      feature_branch: row.feature_branch || '',
      status: row.status || 'pending',
      total_checkpoints: 11,
      completed_checkpoints: row.status === 'completed' ? 11 : row.status === 'in_progress' ? 5 : 0,
      failed_checkpoints: row.status === 'failed' ? 1 : 0,
      current_checkpoint: row.run_status || null,
      started_at: row.started_at,
      updated_at: row.completed_at || row.started_at,
    }));

    // Get live process info
    const activeProcs = getActiveProcesses();
    const activeCount = getActiveProcessCount();

    res.json({
      success: true,
      total_runs: parseInt(counts.total),
      running: parseInt(counts.running),
      completed: parseInt(counts.completed),
      failed: parseInt(counts.failed),
      active_processes: activeCount,
      recent_runs: recentRuns,
      live_processes: activeProcs,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cecelia overview',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/health
 * Health check for dev task tracking
 */
router.get('/dev/health', async (req, res) => {
  try {
    const { checkCeceliaRunAvailable, getActiveProcessCount } = await import('../executor.js');

    const executorAvailable = await checkCeceliaRunAvailable();
    const activeCount = getActiveProcessCount();

    // Check DB connectivity
    const dbResult = await pool.query('SELECT 1 as ok');
    const dbOk = dbResult.rows.length > 0;

    res.json({
      success: true,
      data: {
        status: dbOk && executorAvailable.available ? 'healthy' : 'degraded',
        trackedRepos: [],
        executor: {
          available: executorAvailable.available,
          activeProcesses: activeCount,
        },
        database: {
          connected: dbOk,
        },
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/tasks
 * Get all active dev tasks with step status
 */
router.get('/dev/tasks', async (req, res) => {
  try {
    const { getActiveProcesses } = await import('../executor.js');

    // Get active tasks (in_progress or recently completed dev tasks)
    const result = await pool.query(`
      SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t.task_type,
        t.created_at,
        t.completed_at,
        t.payload,
        g.title as goal_title,
        NULL::text as project_name,
        NULL::text as repo_path
      FROM tasks t
      LEFT JOIN key_results g ON t.goal_id = g.id
      WHERE t.task_type IN ('dev', 'review')
        AND (t.status IN ('in_progress', 'queued') OR t.completed_at >= CURRENT_DATE - INTERVAL '1 day')
      ORDER BY
        CASE t.status WHEN 'in_progress' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
        t.created_at DESC
      LIMIT 20
    `);

    // Get live process info
    const activeProcs = getActiveProcesses();
    const procMap = new Map(activeProcs.map(p => [p.taskId, p]));

    // Map to DevTaskStatus format
    const tasks = result.rows.map(row => {
      const payload = row.payload || {};
      const proc = procMap.get(row.id);

      // Build step items from payload or defaults
      const stepNames = ['PRD', 'Detect', 'Branch', 'DoD', 'Code', 'Test', 'Quality', 'PR', 'CI', 'Learning', 'Cleanup'];
      const steps = stepNames.map((name, idx) => {
        const stepKey = `step_${idx + 1}`;
        const stepStatus = payload[stepKey] || 'pending';
        return {
          id: idx + 1,
          name,
          status: stepStatus === 'done' ? 'done' : stepStatus,
        };
      });

      // Determine current step
      const currentStep = steps.find(s => s.status === 'in_progress');
      const completedSteps = steps.filter(s => s.status === 'done').length;

      return {
        repo: {
          name: row.project_name || row.title,
          path: row.repo_path || '',
          remoteUrl: '',
        },
        branches: {
          main: 'main',
          develop: 'develop',
          feature: payload.feature_branch || null,
          current: payload.feature_branch || 'develop',
          type: payload.feature_branch?.startsWith('cp-') ? 'cp' : payload.feature_branch?.startsWith('feature/') ? 'feature' : 'unknown',
        },
        task: {
          name: row.title,
          createdAt: row.created_at,
          prNumber: payload.pr_number || null,
          prUrl: payload.pr_url || null,
          prState: payload.pr_state || null,
        },
        steps: {
          current: currentStep ? currentStep.id : completedSteps + 1,
          total: 11,
          items: steps,
        },
        quality: {
          ci: payload.ci_status || 'unknown',
          codex: 'unknown',
          lastCheck: row.completed_at || row.created_at,
        },
        updatedAt: row.completed_at || row.created_at,
        processAlive: proc ? proc.alive : false,
      };
    });

    res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get dev tasks',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/repos
 * Get list of tracked repositories
 */
router.get('/dev/repos', async (req, res) => {
  try {
    const result = await pool.query(`
      -- 迁移：projects → okr_projects/okr_scopes/okr_initiatives metadata.repo_path
      SELECT DISTINCT op.title AS name, op.metadata->>'repo_path' AS repo_path
      FROM okr_projects op
      WHERE op.metadata->>'repo_path' IS NOT NULL
      UNION
      SELECT DISTINCT os.title AS name, os.metadata->>'repo_path' AS repo_path
      FROM okr_scopes os
      WHERE os.metadata->>'repo_path' IS NOT NULL
      UNION
      SELECT DISTINCT oi.title AS name, oi.metadata->>'repo_path' AS repo_path
      FROM okr_initiatives oi
      WHERE oi.metadata->>'repo_path' IS NOT NULL
      ORDER BY name
    `);

    res.json({
      success: true,
      data: result.rows.map(r => r.repo_path || r.name),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get repos',
      details: err.message,
    });
  }
});

// ==================== Planner API ====================

/**
 * POST /api/brain/plan
 * Accept input and create resources at the correct OKR level
 */
router.post('/plan', async (req, res) => {
  try {
    const { input, dry_run = false } = req.body;

    if (!input || typeof input !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be an object containing one of: objective, key_result, project, task'
      });
    }

    const result = await handlePlanInput(input, dry_run);

    res.json({
      success: true,
      dry_run,
      ...result
    });
  } catch (err) {
    const status = err.message.startsWith('Hard constraint') ? 400 : 500;
    res.status(status).json({
      success: false,
      error: err.message
    });
  }
});

// POST /api/brain/plan/llm — removed (planner-llm.js deleted, task planning now handled by 秋米 /okr)

/**
 * GET /api/brain/plan/status
 * Get current planning status (target KR, project, queued tasks)
 */
router.get('/plan/status', async (req, res) => {
  try {
    const status = await getPlanStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get plan status',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/plan/next
 * Trigger planner to select next task (same as what tick does)
 */
router.post('/plan/next', async (req, res) => {
  try {
    const result = await planNextTask();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to plan next task',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/planner/initiatives-without-tasks
 * 监控端点：返回所有有 active Initiative 但无 queued/in_progress Task 的 KR 及其 Initiative 列表
 */
router.get('/planner/initiatives-without-tasks', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        kr.id AS kr_id,
        kr.title AS kr_title,
        NULL AS kr_priority,
        CASE WHEN kr.target_value > 0 THEN ROUND(kr.current_value / kr.target_value * 100) ELSE 0 END AS kr_progress,
        kr.status AS kr_status,
        op.id AS project_id,
        op.title AS project_name,
        json_agg(json_build_object(
          'id', oi.id,
          'name', oi.title,
          'status', oi.status,
          'created_at', oi.created_at
        ) ORDER BY oi.created_at ASC) AS initiatives_needing_planning
      FROM key_results kr
      INNER JOIN okr_projects op ON op.kr_id = kr.id AND op.status = 'active'
      INNER JOIN okr_scopes os ON os.project_id = op.id
      INNER JOIN okr_initiatives oi
        ON oi.scope_id = os.id
        AND oi.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.okr_initiative_id = oi.id
            AND t.status IN ('queued', 'in_progress')
        )
      WHERE kr.status NOT IN ('completed', 'cancelled')
      GROUP BY kr.id, kr.title, kr.current_value, kr.target_value, kr.status, op.id, op.title
      ORDER BY kr.id
    `);

    res.json({
      success: true,
      count: result.rows.length,
      krs_with_unplanned_initiatives: result.rows
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to query initiatives without tasks',
      details: err.message
    });
  }
});

// ==================== Work Streams API ====================

/**
 * GET /api/brain/work/streams
 * 返回当前 Area Stream 调度状态，供前端展示
 * 使用 planner.js 的 selectTopAreas + selectActiveInitiativeForArea
 */
router.get('/work/streams', async (_req, res) => {
  try {
    const state = await getGlobalState();
    const topAreas = selectTopAreas(state, ACTIVE_AREA_COUNT);

    const streams = topAreas.map(area => {
      const areaKRs = state.keyResults.filter(kr => kr.parent_id === area.id);
      const areaKRIds = new Set(areaKRs.map(kr => kr.id));

      const areaTasks = state.activeTasks.filter(
        t => (t.status === 'queued' || t.status === 'in_progress') && areaKRIds.has(t.goal_id)
      );
      const totalQueuedTasks = areaTasks.filter(t => t.status === 'queued').length;

      const initiativeResult = selectActiveInitiativeForArea(area, state);
      let activeInitiative = null;
      if (initiativeResult) {
        const { initiative, kr } = initiativeResult;
        const initTasks = areaTasks.filter(t => t.project_id === initiative.id);
        const inProgressCount = initTasks.filter(t => t.status === 'in_progress').length;
        const queuedCount = initTasks.filter(t => t.status === 'queued').length;
        // lockReason: in_progress 任务存在 → 'in_progress'，否则 → 'fifo'
        const lockReason = inProgressCount > 0 ? 'in_progress' : 'fifo';
        activeInitiative = {
          initiative: {
            id: initiative.id,
            name: initiative.name,
            status: initiative.status,
            created_at: initiative.created_at,
          },
          kr: { id: kr.id, title: kr.title || kr.name },
          lockReason,
          inProgressTasks: inProgressCount,
          queuedTasks: queuedCount,
        };
      }

      return {
        area: {
          id: area.id,
          title: area.title || area.name,
          priority: area.priority,
          status: area.status,
          progress: area.progress || 0,
        },
        activeInitiative,
        totalQueuedTasks,
      };
    });

    res.json({
      activeAreaCount: ACTIVE_AREA_COUNT,
      streams,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[work/streams] Error:', err);
    res.status(500).json({ error: 'Failed to get work streams', details: err.message });
  }
});

// ============================================================
// POST /dispatch-now — 不经过 tick loop，直接派发任务执行
// ============================================================
// 用途：/dev 工作流注册 Codex 审查任务后立即触发，不依赖调度器状态
// 调用 executor.triggerCeceliaRun() 直接执行（完全独立于 tick loop）
router.post('/dispatch-now', async (req, res) => {
  try {
    const { task_id } = req.body;
    if (!task_id) {
      return res.status(400).json({ error: 'task_id is required' });
    }

    // 从 DB 加载 task
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found', id: task_id });
    }

    const task = result.rows[0];

    // 检查 task 状态（不重复执行已完成的任务）
    if (task.status === 'completed' || task.status === 'cancelled') {
      return res.status(409).json({
        error: `Task already ${task.status}`,
        id: task_id,
        status: task.status,
      });
    }

    // 标记为 in_progress
    await pool.query(
      'UPDATE tasks SET status = $1, started_at = NOW() WHERE id = $2',
      ['in_progress', task_id]
    );

    // 直接触发执行（不经过 tick loop）
    const execResult = await triggerCeceliaRun(task);

    if (execResult.success) {
      console.log(`[dispatch-now] Task ${task_id} dispatched successfully (executor: ${execResult.executor || 'local'})`);
      res.json({
        success: true,
        taskId: task_id,
        runId: execResult.runId,
        executor: execResult.executor || 'local',
      });
    } else {
      // 执行失败：回退 status
      await pool.query(
        'UPDATE tasks SET status = $1 WHERE id = $2',
        ['queued', task_id]
      );
      console.error(`[dispatch-now] Task ${task_id} dispatch failed: ${execResult.error}`);
      res.status(500).json({
        success: false,
        error: execResult.error,
        taskId: task_id,
      });
    }
  } catch (err) {
    console.error(`[dispatch-now] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to dispatch', details: err.message });
  }
});

export default router;
