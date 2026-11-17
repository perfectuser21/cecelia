import pool from './db.js';
import { shouldAnalyzeFailure, cacheRcaResult, getRcaCacheStats } from './rca-deduplication.js';
import { getAutoFixStats } from './auto-fix.js';
import { validatePolicyJson } from './policy-validator.js';
import { callCortexForRca } from './monitor-rca-context.js';

export const FAILURE_SPIKE_THRESHOLD = 0.3;

/**
 * Dispatch an active absorption policy to its executor.
 *
 * 设计原则：诚实——只在真正完成执行时返回 applied=true。
 * 没有可用执行器的 action 必须返回 applied=false 并附 reason，
 * 调用方据此 fall-through 到 RCA，避免"触发但未执行"被静默当成"已处理"。
 *
 * @param {string} action - Action type from policy_json.action
 * @param {Object} policy - Validated/normalized policy object
 * @param {Object} _failure - Failure record (run_id, task_id, reason_code, ...)
 * @returns {Promise<{applied: boolean, reason?: string, executor_details?: Object}>}
 */
async function executeActivePolicy(action, policy, _failure) {
  switch (action) {
    case 'skip':
      // skip 的语义本身就是"接受这次失败，不重试不告警"——
      // 写审计这一动作即等同于 action 已应用，无需调用其它执行器。
      return {
        applied: true,
        executor_details: {
          skip_reason: policy?.params?.reason || 'No reason provided'
        }
      };

    case 'requeue':
    case 'adjust_params':
    case 'kill':
      // 这些 action 的执行器尚未接通（见 immune-system P1/P2 路线）。
      // 必须如实返回 not-applied，让上层 fall-through 到 RCA，
      // 否则会重蹈"触发但未执行=条件不存在"的 bug。
      return {
        applied: false,
        reason: 'executor_not_implemented'
      };

    default:
      return {
        applied: false,
        reason: `unknown_action:${action}`
      };
  }
}

/**
 * Handler: Handle Failure Spike
 * 处置失败率激增
 */
export async function handleFailureSpike(stats) {
  const isSpike = stats.failure_rate > FAILURE_SPIKE_THRESHOLD;
  console.log(
    `[Monitor] ${isSpike ? 'Failure spike' : 'Failures present'}: ` +
    `${(stats.failure_rate * 100).toFixed(1)}% (${stats.failed_count}/${stats.total_count})`
  );

  // Get recent failures for analysis (last hour)
  const failuresQuery = `
    SELECT
      run_id,
      task_id,
      span_id,
      layer,
      step_name,
      reason_code,
      reason_kind,
      status,
      ts_start,
      ts_end
    FROM run_events
    WHERE status = 'failed'
      AND ts_start > NOW() - INTERVAL '1 hour'
    ORDER BY ts_start DESC
    LIMIT 10
  `;

  const failuresResult = await pool.query(failuresQuery);
  const failures = failuresResult.rows;

  if (failures.length === 0) {
    console.log('[Monitor] No recent failures to analyze');
    return;
  }

  // Import immune system functions
  const {
    updateFailureSignature,
    findActivePolicy,
    findProbationPolicy,
    recordPolicyEvaluation,
    shouldPromoteToProbation,
    promoteDraftToProbation
  } = await import('./immune-system.js');
  const { generateErrorSignature } = await import('./rca-deduplication.js');

  // Analyze each unique failure signature
  for (const failure of failures) {
    const signature = generateErrorSignature(failure);

    // === Immune System Priority: Check active policy first ===
    console.log(`[Immune] Checking active policy for signature=${signature}`);
    const activePolicy = await findActivePolicy(signature);

    if (activePolicy) {
      console.log(`[Immune] Found active policy: ${activePolicy.policy_id} (${activePolicy.policy_type})`);
      const startTime = Date.now();

      // 诚实执行：先验证 policy_json，再分发到对应 action 执行器；
      // 没有可用执行器时，必须如实记录 decision='skipped' 并 fall-through 到 RCA。
      // 旧实现只 log 一句 "Executing policy" 就写 decision='applied' 并 continue 跳过 RCA，
      // 导致"触发条件满足但未执行"等同于"条件不存在"，且 RCA 被压制 → 失败被静默吞掉。
      let decision = 'skipped';
      let actionType = 'unknown';
      const detailsExtra = {
        failure: {
          reason_code: failure.reason_code,
          layer: failure.layer,
          step_name: failure.step_name
        }
      };

      const validation = validatePolicyJson(activePolicy.policy_json, { strict: false });
      if (!validation.valid) {
        decision = 'failed';
        detailsExtra.reason = 'policy_validation_failed';
        detailsExtra.validation_errors = validation.errors;
        console.warn(`[Immune] Active policy ${activePolicy.policy_id} validation failed, falling through to RCA`, validation.errors);
      } else {
        actionType = validation.normalized?.action || activePolicy.policy_json?.action || 'unknown';
        try {
          const result = await executeActivePolicy(actionType, validation.normalized || activePolicy.policy_json, failure);
          decision = result.applied ? 'applied' : 'skipped';
          detailsExtra.action_type = actionType;
          if (!result.applied && result.reason) {
            detailsExtra.reason = result.reason;
          }
          if (result.applied && result.executor_details) {
            detailsExtra.executor_details = result.executor_details;
          }
          if (!result.applied) {
            console.warn(`[Immune] Active policy ${activePolicy.policy_id} action=${actionType} not applied (reason=${result.reason || 'unknown'}), falling through to RCA`);
          } else {
            console.log(`[Immune] Active policy ${activePolicy.policy_id} action=${actionType} applied`);
          }
        } catch (execError) {
          decision = 'failed';
          detailsExtra.reason = 'execution_error';
          detailsExtra.error = execError.message;
          detailsExtra.action_type = actionType;
          console.error(`[Immune] Active policy ${activePolicy.policy_id} execution error, falling through to RCA:`, execError.message);
        }
      }

      try {
        await recordPolicyEvaluation({
          policy_id: activePolicy.policy_id,
          run_id: failure.run_id,
          signature: signature,
          mode: 'enforce',
          decision,
          verification_result: 'unknown',
          latency_ms: Date.now() - startTime,
          details: detailsExtra
        });
        console.log(`[Immune] Policy evaluation recorded: mode=enforce decision=${decision}`);
      } catch (auditError) {
        console.error(`[Immune] Failed to record policy evaluation:`, auditError.message);
        // 即使审计失败也不能 swallow 失败：继续走 RCA 而不是 continue
      }

      // 只有真正应用了 policy 才短路 RCA；其它情况都 fall-through，避免失败被静默吞掉
      if (decision === 'applied') {
        continue;
      }
    }

    // Check probation policy (simulate mode) - P1 Enhanced
    const probationPolicy = await findProbationPolicy(signature);
    if (probationPolicy) {
      console.log(`[Immune] Found probation policy: ${probationPolicy.policy_id} (simulate mode)`);

      // P2: Validate policy JSON before use
      const validation = validatePolicyJson(probationPolicy.policy_json, { strict: false });
      if (!validation.valid) {
        console.warn(`[Immune] Probation policy validation failed: ${probationPolicy.policy_id}`, validation.errors);
        console.warn(`[Immune] Skipping invalid probation policy, continuing with RCA`);

        await pool.query(`
          INSERT INTO cecelia_events (event_type, source, payload)
          VALUES ('probation_policy_validation_failed', 'monitor_loop', $1)
        `, [JSON.stringify({
          policy_id: probationPolicy.policy_id,
          signature,
          validation_errors: validation.errors,
          timestamp: new Date().toISOString()
        })]);
      } else {
        // Policy is valid, proceed with simulation
        const startTime = Date.now();

        try {
          // Parse policy_json to extract intended action
          const { parsePolicyAction } = await import('./immune-system.js');
          const intendedAction = parsePolicyAction(probationPolicy.policy_json);

          // Simulate policy execution (P1: record what would be done)
          console.log(`[Immune] Probation policy simulated: signature=${signature}, would_do=${intendedAction.type}`);

          await recordPolicyEvaluation({
            policy_id: probationPolicy.policy_id,
            run_id: failure.run_id,
            signature: signature,
            mode: 'simulate',
            decision: 'applied', // P1: probation uses mode='simulate' to differentiate
            verification_result: 'unknown',
            latency_ms: Date.now() - startTime,
            details: {
              // P1: Enhanced details with intended action
              would_do: intendedAction.type,
              would_apply: intendedAction.params,
              expected_outcome: intendedAction.expected_outcome,
              simulated_at: new Date().toISOString(),
              failure: {
                reason_code: failure.reason_code,
                layer: failure.layer,
                step_name: failure.step_name
              }
            }
          });

          console.log(`[Immune] Policy evaluation recorded: mode=simulate decision=simulated would_do=${intendedAction.type}`);
        } catch (error) {
          console.error(`[Immune] Probation simulation failed:`, error.message);
        }
      }

      // Continue with RCA even if probation policy exists (for validation)
    }

    // === No active policy: Update failure signature and proceed with RCA ===
    console.log(`[Immune] No active policy, updating failure_signatures`);
    await updateFailureSignature(signature, failure);

    // Check if should promote to probation —— 真正把 cortex 写入的 draft 策略激活
    if (await shouldPromoteToProbation(signature)) {
      console.log(`[Immune] Signature ${signature} meets promotion criteria`);
      try {
        const promoted = await promoteDraftToProbation(signature);
        if (promoted) {
          console.log(`[Immune] Activated draft policy ${promoted.policy_id} → probation for signature=${signature}`);
        } else {
          console.log(`[Immune] No draft policy to promote for signature=${signature} (or already probation/active)`);
        }
      } catch (promoteError) {
        console.error(`[Immune] Failed to promote draft for signature=${signature}:`, promoteError.message);
      }
    }

    // === Continue with existing RCA logic ===
    const { should_analyze, _cached_result } = await shouldAnalyzeFailure(failure);

    if (!should_analyze) {
      console.log(`[Monitor] Skip RCA for ${signature} (cached)`);
      continue;
    }

    console.log(`[Monitor] Running RCA for signature=${signature}`);

    // Call Cortex for RCA
    const rcaResult = await callCortexForRca(failure);

    // Cache result
    await cacheRcaResult(failure, rcaResult);

    // Log RCA result
    console.log(`[Monitor] RCA Result for ${signature}:`);
    console.log(`  Root Cause: ${rcaResult.root_cause}`);
    console.log(`  Proposed Fix: ${rcaResult.proposed_fix}`);
    console.log(`  Confidence: ${(rcaResult.confidence * 100).toFixed(0)}%`);


  }

  // Log RCA cache stats and auto-fix stats
  const cacheStats = await getRcaCacheStats();
  console.log(`[Monitor] RCA Cache: ${cacheStats.total_cached} total, ${cacheStats.cached_last_24h} in 24h, avg confidence=${(parseFloat(cacheStats.avg_confidence || 0) * 100).toFixed(0)}%`);

  const autoFixStats = await getAutoFixStats();
  console.log(`[Monitor] Auto-Fix: ${autoFixStats.total_auto_fixes} total, ${autoFixStats.completed_fixes} completed, ${autoFixStats.in_progress_fixes} in progress, ${autoFixStats.queued_fixes} queued`);
}
