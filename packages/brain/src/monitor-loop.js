/**
 * Monitoring Loop - 持续监控和自动修复
 * 
 * 职责：
 * 1. 每 30 秒扫描 run_events / tasks 状态
 * 2. 检测异常：stuck, failure_spike, resource_pressure
 * 3. 自动处置：retry, quarantine, throttle
 * 4. 只在必要时升级到 Cortex 或通知人类
 * 
 * 原则：
 * - 先用规则，不用推理（快、便宜、确定性）
 * - 推理只处理"值得推理的"（24h 内同类问题只推理一次）
 * - 人类只处理"需要授权/影响大/花钱"的决策
 */

import pool from './db.js';
import { updateTask } from './actions.js';
import {
  shouldAnalyzeFailure,
  cacheRcaResult,
  getRcaCacheStats
} from './rca-deduplication.js';
import {
  shouldAutoFix,
  dispatchToDevSkill,
  getAutoFixStats
} from './auto-fix.js';
import { validatePolicyJson } from './policy-validator.js';

// Configuration
const MONITOR_INTERVAL_MS = 30000; // 30 seconds
const STUCK_THRESHOLD_MINUTES = 5;
// Harness pipeline tasks run much longer than normal tasks:
// harness_generate/harness_fix (Generator): ~13 min, harness evaluator: ~4 min
// Use a 30-minute threshold to avoid false "stuck" detection during legitimate runs.
const HARNESS_STUCK_THRESHOLD_MINUTES = 30;
const HARNESS_TASK_TYPES = [
  'harness_planner', 'harness_contract_propose', 'harness_contract_review',
  'harness_generate', 'harness_fix', 'arch_review'
];
const FAILURE_SPIKE_THRESHOLD = 0.3; // 30% failure rate in last hour
const RESOURCE_PRESSURE_THRESHOLD = 0.85;

// State
let _monitorTimer = null;
let _monitoring = false;
let _lastCycleAt = null;
let _cycleCount = 0;

/**
 * Detector: Stuck Runs
 * 检测卡住的任务（心跳超时或运行时间过长）
 *
 * Harness 任务（harness_generate/harness_fix 等）运行时间远超 5 分钟，
 * 使用独立的 HARNESS_STUCK_THRESHOLD_MINUTES（30 分钟）避免误判。
 */
async function detectStuckRuns() {
  const query = `
    SELECT
      r.run_id,
      r.task_id,
      r.span_id,
      r.layer,
      r.step_name,
      r.ts_start,
      r.heartbeat_ts,
      EXTRACT(EPOCH FROM (NOW() - r.heartbeat_ts)) / 60 AS minutes_since_heartbeat
    FROM run_events r
    LEFT JOIN tasks t ON t.id = r.task_id
    WHERE r.status = 'running'
      AND (
        -- Non-harness tasks: standard 5-minute threshold
        (t.task_type IS NULL OR t.task_type != ALL($1::text[]))
        AND r.heartbeat_ts < NOW() - INTERVAL '${STUCK_THRESHOLD_MINUTES} minutes'
        OR
        -- Harness tasks: extended 30-minute threshold
        (t.task_type = ANY($1::text[]))
        AND r.heartbeat_ts < NOW() - INTERVAL '${HARNESS_STUCK_THRESHOLD_MINUTES} minutes'
      )
    ORDER BY r.heartbeat_ts ASC
    LIMIT 10
  `;

  const result = await pool.query(query, [HARNESS_TASK_TYPES]);
  return result.rows;
}

/**
 * Detector: Failure Spike
 * 检测失败率激增（最近 1 小时）
 */
async function detectFailureSpike() {
  const query = `
    SELECT 
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
      COUNT(*) AS total_count,
      ROUND(
        COUNT(*) FILTER (WHERE status = 'failed')::numeric / 
        NULLIF(COUNT(*), 0), 
        2
      ) AS failure_rate
    FROM run_events
    WHERE ts_start > NOW() - INTERVAL '1 hour'
  `;
  
  const result = await pool.query(query);
  const row = result.rows[0] || {};

  return {
    failed_count: parseInt(row.failed_count) || 0,
    total_count: parseInt(row.total_count) || 0,
    failure_rate: parseFloat(row.failure_rate) || 0
  };
}

export { detectFailureSpike };

/**
 * Detector: Resource Pressure
 * 检测系统压力（活跃任务数 / 最大并发）并采集 CPU/RSS 指标
 */
async function detectResourcePressure() {
  const { getActiveProcessCount, MAX_SEATS } = await import('./executor.js');
  const activeCount = getActiveProcessCount();
  const pressure = activeCount / MAX_SEATS;

  // 采集进程级 CPU 和内存 RSS（Node.js 自身）
  const memUsage = process.memoryUsage();
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);

  // cpuUsage() 返回微秒累计，取两次快照算近似 %
  // 注：monitor 每 30s 调用，此处仅记录瞬时 RSS，CPU% 近似为 user+sys / elapsed
  const cpuBefore = process.cpuUsage();
  const wallStart = Date.now();
  // 同步等待 ~10ms 采样窗口（够精度，不阻塞）
  await new Promise(resolve => setTimeout(resolve, 10));
  const cpuAfter = process.cpuUsage(cpuBefore);
  const elapsedMs = Date.now() - wallStart;
  const cpuPercent = Math.round(((cpuAfter.user + cpuAfter.system) / 1000 / elapsedMs) * 100 * 10) / 10;

  return {
    active_count: activeCount,
    max_seats: MAX_SEATS,
    pressure: pressure,
    rss_mb: rssMB,
    cpu_percent: cpuPercent,
  };
}

/**
 * Handler: Handle Stuck Run
 * 处置卡住的任务
 * 
 * 策略：
 * 1st time: restart (requeue task)
 * 2nd time: retry with lower priority
 * 3rd time: quarantine + open incident
 */
async function handleStuckRun(stuck) {
  const minutesStuck = parseFloat(stuck.minutes_since_heartbeat) || 0;
  console.log(`[Monitor] Stuck detected: task=${stuck.task_id}, run=${stuck.run_id}, stuck_for=${minutesStuck.toFixed(1)}min`);
  
  // Get task retry count
  const taskQuery = await pool.query(
    'SELECT retry_count FROM tasks WHERE id = $1',
    [stuck.task_id]
  );
  
  if (taskQuery.rows.length === 0) {
    console.log(`[Monitor] Task ${stuck.task_id} not found, skipping`);
    return;
  }
  
  const retryCount = taskQuery.rows[0].retry_count || 0;

  // harness 链式任务感知：检查是否已有下游任务
  const HARNESS_CHAIN_TYPES = new Set([
    'harness_planner', 'harness_contract_propose', 'harness_contract_review',
    'harness_generate', 'harness_fix', 'harness_report',
    'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review',
    'sprint_generate', 'sprint_fix', 'sprint_report'
  ]);

  // 查询任务类型
  const typeQuery = await pool.query(
    'SELECT task_type, payload FROM tasks WHERE id = $1',
    [stuck.task_id]
  );
  const taskType = typeQuery.rows[0]?.task_type;
  const _taskPayload = typeQuery.rows[0]?.payload || {};

  if (HARNESS_CHAIN_TYPES.has(taskType)) {
    // 检查是否已有基于此任务派生的下游任务（completed/queued/in_progress）
    const downstreamCheck = await pool.query(
      `SELECT id, task_type, status FROM tasks
       WHERE payload->>'planner_task_id' = $1
          OR payload->>'dev_task_id' = $1
       ORDER BY created_at DESC LIMIT 5`,
      [stuck.task_id]
    );
    const activeDownstream = downstreamCheck.rows.filter(
      r => ['queued', 'in_progress', 'completed'].includes(r.status)
    );
    if (activeDownstream.length > 0) {
      console.log(
        `[Monitor] Harness chain: task ${stuck.task_id} (${taskType}) has ${activeDownstream.length} downstream tasks ` +
        `(${activeDownstream.map(d => `${d.task_type}:${d.status}`).join(', ')}), ` +
        `marking as completed instead of restarting to avoid duplicates`
      );
      // 标记当前任务为 completed（下游已存在说明它已成功完成过，只是回调没更新状态）
      await pool.query(
        `UPDATE tasks SET status = 'completed' WHERE id = $1`,
        [stuck.task_id]
      );
      await pool.query(
        `UPDATE run_events
         SET status = 'completed',
             ts_end = NOW(),
             reason_code = 'MONITOR_HARNESS_CHAIN_RESOLVED',
             reason_kind = 'RESOLVED'
         WHERE run_id = $1 AND status = 'running'`,
        [stuck.run_id]
      );
      return; // 跳过重启逻辑
    }
    // 回调调和：检查 run 是否已结束但回调丢失
    const runCheck = await pool.query(
      `SELECT status, ts_end FROM run_events WHERE run_id = $1 ORDER BY ts_start DESC LIMIT 1`,
      [stuck.run_id]
    );
    const runStatus = runCheck.rows[0];
    if (runStatus && (runStatus.ts_end !== null || runStatus.status === 'completed' || runStatus.status === 'failed')) {
      console.log(
        `[Monitor] Harness reconciliation: task ${stuck.task_id} (${taskType}) run already ended ` +
        `(status=${runStatus.status}), simulating callback with result=null to trigger retry chain`
      );
      await pool.query(
        `UPDATE tasks SET status = 'completed', result = NULL WHERE id = $1`,
        [stuck.task_id]
      );
      await pool.query(
        `UPDATE run_events
         SET status = 'completed',
             ts_end = NOW(),
             reason_code = 'MONITOR_CALLBACK_RECONCILED',
             reason_kind = 'RECONCILED'
         WHERE run_id = $1 AND status = 'running'`,
        [stuck.run_id]
      );
      return;
    }
    console.log(`[Monitor] Harness chain: task ${stuck.task_id} (${taskType}) has no downstream tasks, proceeding with normal stuck handling`);
  }

  if (retryCount === 0) {
    // First time: restart (requeue)
    console.log(`[Monitor] Action: RESTART task ${stuck.task_id} (1st stuck)`);
    await updateTask({
      task_id: stuck.task_id,
      status: 'queued'
    });
    
    // Mark run as failed
    await pool.query(
      `UPDATE run_events 
       SET status = 'failed', 
           ts_end = NOW(),
           reason_code = 'MONITOR_RESTART',
           reason_kind = 'TRANSIENT'
       WHERE run_id = $1 AND status = 'running'`,
      [stuck.run_id]
    );
    
  } else if (retryCount === 1) {
    // Second time: retry with lower priority
    console.log(`[Monitor] Action: RETRY task ${stuck.task_id} with lower priority (2nd stuck)`);
    await pool.query(
      `UPDATE tasks
       SET status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           priority = CASE
             WHEN priority = 'P0' THEN 'P1'
             WHEN priority = 'P1' THEN 'P2'
             ELSE priority
           END,
           retry_count = retry_count + 1
       WHERE id = $1`,
      [stuck.task_id]
    );
    
    await pool.query(
      `UPDATE run_events 
       SET status = 'failed', 
           ts_end = NOW(),
           reason_code = 'MONITOR_RETRY',
           reason_kind = 'TRANSIENT'
       WHERE run_id = $1 AND status = 'running'`,
      [stuck.run_id]
    );
    
  } else {
    // Third time: quarantine
    console.log(`[Monitor] Action: QUARANTINE task ${stuck.task_id} (3rd+ stuck)`);
    const { quarantineTask } = await import('./quarantine.js');
    await quarantineTask(stuck.task_id, 'stuck_repeatedly', {
      run_id: stuck.run_id,
      stuck_count: retryCount + 1,
      last_layer: stuck.layer,
      last_step: stuck.step_name
    });
    
    // 写入 stuck_incident 事件，供 dashboard/告警系统消费
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, source, payload)
         VALUES ('stuck_incident', 'monitor_loop', $1)`,
        [JSON.stringify({
          task_id: stuck.task_id,
          run_id: stuck.run_id,
          stuck_count: retryCount + 1,
          last_layer: stuck.layer,
          last_step: stuck.step_name,
          action: 'quarantined',
          timestamp: new Date().toISOString()
        })]
      );
      console.log(`[Monitor] Incident recorded for task ${stuck.task_id} (stuck_incident event)`);
    } catch (incidentErr) {
      console.error(`[Monitor] Failed to record stuck_incident: ${incidentErr.message}`);
    }
  }
}

/**
 * Fetch task metadata (title, type, description head) from tasks table.
 * Uses parameterized query ($1) — pool.query is pg's built-in safe parameterization.
 * @param {string} taskId
 * @returns {Promise<{task_title?, task_type?, task_description_head?}>}
 */
async function fetchTaskMeta(taskId) {
  try {
    const result = await pool.query(
      `SELECT title, task_type, LEFT(description, 500) AS description_head
       FROM tasks WHERE id = $1 LIMIT 1`,
      [taskId]
    );
    if (result.rows.length === 0) return {};
    const t = result.rows[0];
    return { task_title: t.title, task_type: t.task_type, task_description_head: t.description_head };
  } catch (err) {
    console.warn(`[Monitor] fetchTaskMeta failed for task ${taskId}: ${err.message}`);
    return {};
  }
}

/**
 * Fetch stderr / log_tail from the most recent failed run_events payload.
 * Uses parameterized query ($1) — pool.query is pg's built-in safe parameterization.
 * @param {string} runId
 * @returns {Promise<{stderr?: string, log_tail?: string}>}
 */
async function fetchRunPayload(runId) {
  try {
    const result = await pool.query(
      `SELECT payload FROM run_events
       WHERE run_id = $1 AND status = 'failed'
       ORDER BY ts_end DESC NULLS LAST LIMIT 1`,
      [runId]
    );
    if (result.rows.length === 0) return {};
    const payload = result.rows[0].payload;
    if (!payload || typeof payload !== 'object') return {};
    return {
      stderr: (payload.stderr || payload.error || '').toString().slice(-2000),
      log_tail: (payload.log_tail || payload.output || '').toString().slice(-1000),
    };
  } catch (err) {
    console.warn(`[Monitor] fetchRunPayload failed for run ${runId}: ${err.message}`);
    return {};
  }
}

/**
 * Count recent similar failures by reason_code in the last 24h.
 * Uses parameterized query ($1) — pool.query is pg's built-in safe parameterization.
 * @param {string} reasonCode
 * @returns {Promise<{count: number, affected_steps: string[]}>}
 */
async function fetchSimilarFailures(reasonCode) {
  try {
    const result = await pool.query(
      `SELECT count(*) AS cnt, array_agg(DISTINCT step_name) AS steps
       FROM run_events
       WHERE reason_code = $1 AND status = 'failed'
         AND ts_start > NOW() - INTERVAL '24 hours'`,
      [reasonCode]
    );
    if (result.rows.length === 0) return { count: 0, affected_steps: [] };
    return {
      count: parseInt(result.rows[0].cnt) || 0,
      affected_steps: result.rows[0].steps || [],
    };
  } catch (err) {
    console.warn(`[Monitor] fetchSimilarFailures failed for reason_code ${reasonCode}: ${err.message}`);
    return { count: 0, affected_steps: [] };
  }
}

/**
 * Gather rich failure context from run_events and tasks tables
 * so Cortex can produce high-confidence RCA diagnoses.
 *
 * @param {Object} failure - row from run_events (must have task_id, run_id)
 * @returns {Promise<Object>} enriched context object
 */
async function gatherFailureContext(failure) {
  const ctx = {
    reason_code: failure.reason_code || 'UNKNOWN',
    reason_kind: failure.reason_kind || 'UNKNOWN',
    layer: failure.layer || 'N/A',
    step_name: failure.step_name || 'N/A',
    run_id: failure.run_id || null,
    task_id: failure.task_id || null,
    ts_start: failure.ts_start || null,
    ts_end: failure.ts_end || null,
    stderr: null,
    log_tail: null,
    task_title: null,
    task_type: null,
    task_description_head: null,
    recent_similar_failures: [],
  };

  try {
    if (failure.task_id) {
      Object.assign(ctx, await fetchTaskMeta(failure.task_id));
    }
    if (failure.run_id) {
      Object.assign(ctx, await fetchRunPayload(failure.run_id));
    }
    if (failure.reason_code) {
      ctx.recent_similar_failures = await fetchSimilarFailures(failure.reason_code);
    }
  } catch (err) {
    console.warn(`[Monitor] gatherFailureContext partial failure: ${err.message}`);
  }

  return ctx;
}

/**
 * Call Cortex for RCA (Root Cause Analysis)
 *
 * @param {Object} failure - Failure object from run_events
 * @returns {Promise<Object>} RCA result with structured fields
 */
async function callCortexForRca(failure) {
  const { performRCA } = await import('./cortex.js');

  try {
    // Gather rich context from DB (not just 5 fields)
    const failureContext = await gatherFailureContext(failure);

    // Prepare task data with full context for performRCA
    const failedTask = {
      id: failure.task_id,
      task_type: failureContext.task_type || 'dev',
      reason_code: failureContext.reason_code,
      reason_kind: failureContext.reason_kind,
      layer: failureContext.layer,
      step_name: failureContext.step_name,
      // Rich context fields (new)
      title: failureContext.task_title,
      stderr: failureContext.stderr,
      log_tail: failureContext.log_tail,
      description_head: failureContext.task_description_head,
      recent_similar: failureContext.recent_similar_failures,
      run_id: failureContext.run_id,
      ts_start: failureContext.ts_start,
      ts_end: failureContext.ts_end,
    };

    // Build failure history with classification for Cortex
    const history = failureContext.recent_similar_failures?.count > 1
      ? [{ failure_classification: { class: failureContext.reason_code } }]
      : [];

    // Call performRCA with enriched data
    const response = await performRCA(failedTask, history);

    // Extract structured result from response
    if (response && response.analysis) {
      // Try to extract JSON from markdown code block
      const jsonMatch = response.analysis.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const rcaResult = JSON.parse(jsonMatch[1]);
        return {
          root_cause: rcaResult.root_cause || response.analysis,
          proposed_fix: rcaResult.proposed_fix || 'See analysis',
          action_plan: rcaResult.action_plan || '',
          confidence: rcaResult.confidence || 0.5,
          evidence: rcaResult.evidence || ''
        };
      }

      // Fallback: plain text response
      return {
        root_cause: response.analysis.substring(0, 500),
        proposed_fix: 'Manual review needed',
        action_plan: '',
        confidence: 0.3,
        evidence: ''
      };
    }

    // No valid response
    return {
      root_cause: 'RCA returned no analysis',
      proposed_fix: 'Retry with more context',
      action_plan: '',
      confidence: 0,
      evidence: ''
    };

  } catch (error) {
    console.error('[Monitor] Cortex RCA call failed:', error.message);
    return {
      root_cause: `Cortex invocation failed: ${error.message}`,
      proposed_fix: 'Check Cortex configuration',
      action_plan: '',
      confidence: 0,
      evidence: ''
    };
  }
}

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
async function handleFailureSpike(stats) {
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

    // P2: Auto-dispatch to /dev if high confidence
    if (shouldAutoFix(rcaResult)) {
      console.log(`[Monitor] High confidence RCA (${(rcaResult.confidence * 100).toFixed(0)}%), dispatching to /dev`);

      try {
        const taskId = await dispatchToDevSkill(failure, rcaResult, signature);
        console.log(`[Monitor] Auto-fix task created: ${taskId}`);
      } catch (error) {
        console.error(`[Monitor] Failed to dispatch auto-fix:`, error.message);
      }
    } else {
      console.log(`[Monitor] RCA confidence too low for auto-fix, manual review needed`);
    }
  }

  // Log RCA cache stats and auto-fix stats
  const cacheStats = await getRcaCacheStats();
  console.log(`[Monitor] RCA Cache: ${cacheStats.total_cached} total, ${cacheStats.cached_last_24h} in 24h, avg confidence=${(parseFloat(cacheStats.avg_confidence || 0) * 100).toFixed(0)}%`);

  const autoFixStats = await getAutoFixStats();
  console.log(`[Monitor] Auto-Fix: ${autoFixStats.total_auto_fixes} total, ${autoFixStats.completed_fixes} completed, ${autoFixStats.in_progress_fixes} in progress, ${autoFixStats.queued_fixes} queued`);
}

/**
 * Handler: Handle Resource Pressure
 * 处置资源压力
 */
async function handleResourcePressure(stats) {
  console.log(`[Monitor] Resource pressure: ${(stats.pressure * 100).toFixed(1)}% (${stats.active_count}/${stats.max_seats})`);
  
  if (stats.pressure > 0.9) {
    // Critical: throttle new dispatches
    console.log(`[Monitor] Action: THROTTLE - High pressure detected (${(stats.pressure * 100).toFixed(1)}%)`);

    // 写入 throttle_activated 事件，供 slot-allocator 和 dashboard 消费
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, source, payload)
         VALUES ('throttle_activated', 'monitor_loop', $1)`,
        [JSON.stringify({
          pressure: stats.pressure,
          active_count: stats.active_count,
          max_seats: stats.max_seats,
          rss_mb: stats.rss_mb,
          cpu_percent: stats.cpu_percent,
          timestamp: new Date().toISOString()
        })]
      );
    } catch (throttleErr) {
      console.error(`[Monitor] Failed to record throttle_activated: ${throttleErr.message}`);
    }
  }
}

/**
 * Main monitoring loop
 */
async function runMonitorCycle() {
  if (_monitoring) {
    console.log('[Monitor] Previous cycle still running, skipping');
    return;
  }
  
  _monitoring = true;
  const startTime = Date.now();
  
  try {
    // 1. Detect stuck runs
    const stuckRuns = await detectStuckRuns();
    if (stuckRuns.length > 0) {
      console.log(`[Monitor] Found ${stuckRuns.length} stuck runs`);
      for (const stuck of stuckRuns) {
        await handleStuckRun(stuck);
      }
    }
    
    // 2. Detect failures and run immune system
    // 关键：absorption_policy 是 signature 级别的规则，不能用系统级 failure_rate
    // 卡住免疫系统——单签名重复失败、整体 rate 不到 30% 时，规则永远不会被检查、
    // 不会被计数、不会被晋升，制造"规则存在但不执行"的虚假安全感
    // (Cortex Insight learning 81cba57d)。
    // 只要有失败就跑免疫流程；failure_rate 仅作为日志/告警维度保留。
    const failureStats = await detectFailureSpike();
    if (failureStats.failed_count > 0) {
      await handleFailureSpike(failureStats);
    }
    
    // 3. Detect resource pressure
    const resourceStats = await detectResourcePressure();
    if (resourceStats.pressure > RESOURCE_PRESSURE_THRESHOLD) {
      await handleResourcePressure(resourceStats);
    }

    // 4. 记录资源快照（每次 cycle 写入，用于事后性能分析）
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, payload, created_at) VALUES ('resource_snapshot', $1, NOW())`,
        [JSON.stringify({
          cpu_percent: resourceStats.cpu_percent,
          rss_mb: resourceStats.rss_mb,
          active_processes: resourceStats.active_count,
          max_seats: resourceStats.max_seats,
          utilization: resourceStats.pressure,
        })]
      );
    } catch (snapshotErr) {
      // 写入失败不影响 monitor 主流程
      console.warn(`[Monitor] resource_snapshot 写入失败: ${snapshotErr.message}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Monitor] Cycle completed in ${elapsed}ms`);
    _lastCycleAt = Date.now();
    _cycleCount++;

  } catch (error) {
    console.error('[Monitor] Error in monitoring cycle:', error);
  } finally {
    _monitoring = false;
  }
}

/**
 * Start monitoring loop
 */
export function startMonitorLoop() {
  if (_monitorTimer) {
    console.log('[Monitor] Loop already running');
    return;
  }
  
  console.log(`[Monitor] Starting monitoring loop (interval: ${MONITOR_INTERVAL_MS}ms)`);
  
  // Run first cycle immediately
  runMonitorCycle();
  
  // Then run periodically
  _monitorTimer = setInterval(runMonitorCycle, MONITOR_INTERVAL_MS);
}

/**
 * Get monitoring status
 */
export function getMonitorStatus() {
  return {
    running: _monitorTimer !== null,
    monitoring: _monitoring,
    interval_ms: MONITOR_INTERVAL_MS,
    last_cycle_at: _lastCycleAt,
    cycle_count: _cycleCount,
    thresholds: {
      stuck_minutes: STUCK_THRESHOLD_MINUTES,
      failure_spike_rate: FAILURE_SPIKE_THRESHOLD,
      resource_pressure: RESOURCE_PRESSURE_THRESHOLD
    }
  };
}
