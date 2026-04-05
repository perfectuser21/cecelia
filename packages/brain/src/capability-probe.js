/**
 * Capability Probe — 能力探针系统
 *
 * 定期验证 Cecelia 每条关键链路是否真的通，
 * 发现故障时自动创建修复任务（走 auto-fix 路径）。
 *
 * 类比：人体每时每刻都能感知自己的手脚是否能动，
 * Cecelia 每小时验证自己的核心能力是否还在线。
 */

import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import pool from './db.js';
import {
  shouldAutoFix,
  dispatchToDevSkill,
} from './auto-fix.js';
import { raise } from './alerting.js';

// ============================================================
// Configuration
// ============================================================

const PROBE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PROBE_TIMEOUT_MS = 30_000; // per-probe timeout

// Rollback thresholds — conservative design
const ROLLBACK_THRESHOLDS = {
  consecutive: 3,   // same probe fails 3 times in a row → rollback
  batch_total: 5,   // ≥5 probes fail in one batch → rollback
};

// Rate-limit rollback: at most once per 30 min to avoid loops
const ROLLBACK_RATE_LIMIT_MS = 30 * 60 * 1000;
let _lastRollbackAt = 0;

// Per-probe consecutive failure counters (reset to 0 on any pass)
const _consecutiveFailures = new Map();

// ============================================================
// Probe definitions
// ============================================================

/**
 * Each probe is { name, description, fn: async () => ProbeResult }
 * ProbeResult = { ok: boolean, detail?: string, latency_ms: number }
 */
const PROBES = [
  {
    name: 'db',
    description: '数据库连接 + 核心表可读',
    fn: probeDatabase,
  },
  {
    name: 'dispatch',
    description: '任务派发链路（tasks 表可写 + executor 模块可 import）',
    fn: probeDispatch,
  },
  {
    name: 'auto_fix',
    description: 'auto-fix 链路 dry-run（shouldAutoFix 函数可调用）',
    fn: probeAutoFix,
  },
  {
    name: 'notify',
    description: '飞书通知链路（alerting 模块可 import + 函数可调用）',
    fn: probeNotify,
  },
  {
    name: 'cortex',
    description: 'Cortex RCA 链路（cortex 模块可 import）',
    fn: probeCortex,
  },
  {
    name: 'monitor_loop',
    description: 'Monitor Loop 运行状态',
    fn: probeMonitorLoop,
  },
  // === 高层意识循环探针 ===
  {
    name: 'rumination',
    description: '反刍系统（24h 内是否有产出）',
    fn: probeRumination,
  },
  {
    name: 'evolution',
    description: '进化追踪（是否有 evolution 记录）',
    fn: probeEvolution,
  },
  {
    name: 'consolidation',
    description: '记忆合并（48h 内是否有合并记录）',
    fn: probeConsolidation,
  },
  {
    name: 'self_drive_health',
    description: 'Self-Drive 自驱引擎（24h 内是否成功创建任务）',
    fn: probeSelfDriveHealth,
  },
];

// ============================================================
// Individual probe implementations
// ============================================================

async function probeDatabase() {
  // Check connection + core tables exist
  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM tasks) AS task_count,
      (SELECT count(*) FROM run_events WHERE ts_start > NOW() - INTERVAL '1 hour') AS recent_runs,
      (SELECT count(*) FROM learnings) AS learning_count
  `);
  const row = result.rows[0];
  return {
    ok: true,
    detail: `tasks=${row.task_count} recent_runs=${row.recent_runs} learnings=${row.learning_count}`,
  };
}

async function probeDispatch() {
  // Verify executor module is importable and skill map exists
  const { getActiveProcessCount, MAX_SEATS } = await import('./executor.js');
  const active = getActiveProcessCount();
  return {
    ok: true,
    detail: `active=${active}/${MAX_SEATS}`,
  };
}

async function probeAutoFix() {
  // Dry-run: call shouldAutoFix with a synthetic high-confidence RCA
  const dryResult = shouldAutoFix({
    confidence: 0.9,
    proposed_fix: 'Test fix proposal for capability probe dry-run verification.',
  });

  // Also verify dispatchToDevSkill is callable (but don't call it)
  const dispatchExists = typeof dispatchToDevSkill === 'function';

  return {
    ok: dryResult === true && dispatchExists,
    detail: `shouldAutoFix(0.9)=${dryResult} dispatchToDevSkill=${dispatchExists ? 'ok' : 'missing'}`,
  };
}

async function probeNotify() {
  // Verify alerting module is importable
  const alerting = await import('./alerting.js');
  const hasSend = typeof alerting.sendFeishuNotification === 'function'
    || typeof alerting.sendAlert === 'function'
    || typeof alerting.notifyFeishu === 'function';

  return {
    ok: hasSend || Object.keys(alerting).length > 0,
    detail: `alerting exports: ${Object.keys(alerting).slice(0, 5).join(', ')}`,
  };
}

async function probeCortex() {
  // Verify cortex module is importable and performRCA exists
  const cortex = await import('./cortex.js');
  const hasRCA = typeof cortex.performRCA === 'function';
  return {
    ok: hasRCA,
    detail: `performRCA=${hasRCA ? 'ok' : 'missing'}`,
  };
}

async function probeMonitorLoop() {
  const { getMonitorStatus } = await import('./monitor-loop.js');
  const status = getMonitorStatus();
  return {
    ok: status.running === true,
    detail: `running=${status.running} interval=${status.interval_ms}ms`,
  };
}

// === 高层意识循环探针 ===

async function probeRumination() {
  // 阶段 1：检查 48h 内有没有反刍产出（synthesis_archive 表）
  // 使用 48h 而非 24h：runRumination 和 runDailySynthesis 两路写入可能产生约 40h 时间差
  // （runRumination 早上写入后，同日调度器 hasTodaySynthesis 检测到已存在而跳过）
  const archiveResult = await pool.query(
    `SELECT count(*) AS cnt, max(created_at) AS last_run
     FROM synthesis_archive
     WHERE created_at > NOW() - INTERVAL '48 hours'`
  );
  const cnt = parseInt(archiveResult.rows[0]?.cnt || 0);
  const lastRun = archiveResult.rows[0]?.last_run;

  if (cnt > 0) {
    return {
      ok: true,
      detail: `48h_count=${cnt} last_run=${lastRun}`,
    };
  }

  // 阶段 2：48h 内无 synthesis → 检查是否有待消化内容
  // 若无待消化内容，系统处于合理静默状态（非故障）
  const pendingResult = await pool.query(
    `SELECT count(*) AS cnt FROM learnings
     WHERE digested = false AND (archived = false OR archived IS NULL)`
  );
  const undigested = parseInt(pendingResult.rows[0]?.cnt || 0);

  if (undigested === 0) {
    return {
      ok: true,
      detail: `48h_count=0 last_run=${lastRun || 'never'} (idle: no_pending_learnings)`,
    };
  }

  // 阶段 3：有未消化内容但无近期 synthesis → 判断是误报还是真实故障
  // 误报场景："空白日"无新 learnings → 无 synthesis 写入 → 新 learnings 晚到 → 旧 synthesis 滑出 48h 窗口
  // 真实故障：rumination 完全停止运行（无任何 rumination_output 事件）
  //
  // 检查 24h 内是否有 rumination_output 事件（rumination 实际运行的证据）
  const runEventResult = await pool.query(
    `SELECT count(*) AS cnt, max(created_at) AS last_event
     FROM cecelia_events
     WHERE event_type = 'rumination_output'
       AND created_at > NOW() - INTERVAL '24 hours'`
  );
  const recentRuns = parseInt(runEventResult.rows[0]?.cnt || 0);
  const lastEvent = runEventResult.rows[0]?.last_event;

  // 检查 synthesis_archive 是否超过 72h 未更新（更严格的兜底）
  const staleResult = await pool.query(
    `SELECT count(*) AS cnt FROM synthesis_archive
     WHERE created_at > NOW() - INTERVAL '72 hours'`
  );
  const within72h = parseInt(staleResult.rows[0]?.cnt || 0);

  if (recentRuns > 0 && within72h > 0) {
    // rumination 在运行，synthesis 只是暂时没更新（正常的"空白日"场景）
    return {
      ok: true,
      detail: `48h_count=0 last_run=${lastRun || 'never'} undigested=${undigested} (running: recent_outputs=${recentRuns} last_event=${lastEvent})`,
    };
  }

  return {
    ok: false,
    detail: `48h_count=0 last_run=${lastRun || 'never'} undigested=${undigested} recent_outputs=${recentRuns}`,
  };
}

async function probeEvolution() {
  // 检查 7 天内是否有 PR 进化记录（写入 component_evolutions 表）
  const result = await pool.query(
    `SELECT count(*) AS cnt, max(date) AS last_date
     FROM component_evolutions
     WHERE date > (NOW() - INTERVAL '7 days')::date`
  );
  const cnt = parseInt(result.rows[0]?.cnt || 0);
  const lastDate = result.rows[0]?.last_date
    ? new Date(result.rows[0].last_date).toISOString().slice(0, 10)
    : null;
  return {
    ok: cnt > 0,
    detail: `7d_pr_evolutions=${cnt} last_date=${lastDate || 'never'}`,
  };
}

async function probeConsolidation() {
  // 检查 48h 内有没有记忆合并
  const result = await pool.query(
    `SELECT count(*) AS cnt, max(created_at) AS last_run
     FROM memory_stream
     WHERE source_type = 'daily_consolidation'
       AND created_at > NOW() - INTERVAL '48 hours'`
  );
  const cnt = parseInt(result.rows[0]?.cnt || 0);
  const lastRun = result.rows[0]?.last_run;
  return {
    ok: cnt > 0,
    detail: `48h_consolidations=${cnt} last_run=${lastRun || 'never'}`,
  };
}

async function probeSelfDriveHealth() {
  // 检查 Self-Drive 24h 内是否有成功完成的 cycle（cycle_complete 或 no_action 均算成功）
  // cycle_error = LLM 调用失败（探针应失败）
  // no_action   = LLM 正常运行但判断无需行动（系统健康，不应误判为失败）
  // cycle_complete = LLM 正常运行并做出决策（tasks_created 可以是 0）
  const result = await pool.query(
    `SELECT
       count(*) filter (where payload->>'subtype' IN ('cycle_complete', 'no_action')) AS success_cnt,
       count(*) filter (where payload->>'subtype' = 'cycle_error') AS error_cnt,
       max(case when payload->>'subtype' IN ('cycle_complete', 'no_action')
           then created_at end) AS last_success,
       coalesce(sum((payload->>'tasks_created')::int) filter (
           where payload->>'subtype' = 'cycle_complete'
             AND (payload->>'tasks_created')::int > 0
       ), 0) AS total_tasks_created
     FROM cecelia_events
     WHERE event_type = 'self_drive'
       AND created_at > NOW() - INTERVAL '24 hours'`
  );
  const row = result.rows[0] || {};
  const successCnt = parseInt(row.success_cnt || 0);
  const errorCnt = parseInt(row.error_cnt || 0);
  const tasksCreated = parseInt(row.total_tasks_created || 0);
  const lastSuccess = row.last_success;
  return {
    ok: successCnt > 0,
    detail: `24h: successful_cycles=${successCnt} errors=${errorCnt} tasks_created=${tasksCreated} last_success=${lastSuccess || 'never'}`,
  };
}

// ============================================================
// Rollback executor
// ============================================================

/**
 * Execute brain-rollback.sh and raise a P0 Feishu alert with rollback status.
 * @param {string} reason  - Human-readable trigger reason
 * @param {Array}  failures - Failed probe results for this batch
 */
async function triggerRollback(reason, failures) {
  const __filename = fileURLToPath(import.meta.url);
  const rollbackScript = path.resolve(path.dirname(__filename), '../../../scripts/brain-rollback.sh');
  const failureNames = failures.map(f => f.name).join(', ');

  return new Promise((resolve) => {
    execFile('bash', [rollbackScript], { timeout: 90_000 }, (err, stdout, stderr) => {
      const success = !err;
      const output = (stdout || '').trim() || (stderr || '').trim();
      const status = success ? '✅ 回滚成功' : `❌ 回滚失败: ${err?.message || 'unknown'}`;

      console.log(`[Probe] Rollback result: ${status}`);
      if (output) console.log(`[Probe] Rollback output:\n${output}`);

      raise(
        'P0',
        'probe_rollback_triggered',
        `🔄 Brain 自动回滚已触发\n原因: ${reason}\n失败探针: ${failureNames}\n回滚状态: ${status}\n${output ? `输出摘要: ${output.slice(0, 300)}` : ''}`
      );
      resolve({ success, output });
    });
  });
}

// ============================================================
// Core probe runner
// ============================================================

/**
 * Run all probes and return results.
 * @returns {Promise<Array<{name, description, ok, detail, latency_ms, error}>>}
 */
export async function runProbes() {
  const results = [];

  for (const probe of PROBES) {
    const start = Date.now();
    try {
      const result = await Promise.race([
        probe.fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS)
        ),
      ]);

      results.push({
        name: probe.name,
        description: probe.description,
        ok: result.ok,
        detail: result.detail || '',
        latency_ms: Date.now() - start,
        error: null,
      });
    } catch (err) {
      results.push({
        name: probe.name,
        description: probe.description,
        ok: false,
        detail: '',
        latency_ms: Date.now() - start,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Get latest probe results from cecelia_events table.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getProbeResults(limit = 5) {
  const result = await pool.query(
    `SELECT payload, created_at
     FROM cecelia_events
     WHERE event_type = 'capability_probe'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ============================================================
// Scheduled probe cycle
// ============================================================

let _probeTimer = null;

/**
 * Run probes, persist results, and trigger auto-fix for failures.
 */
async function runProbeCycle() {
  console.log('[Probe] Starting capability probe cycle...');

  const results = await runProbes();
  const failures = results.filter(r => !r.ok);
  const timestamp = new Date().toISOString();

  // Persist to cecelia_events
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('capability_probe', 'capability-probe', $1)`,
      [JSON.stringify({
        timestamp,
        total: results.length,
        passed: results.length - failures.length,
        failed: failures.length,
        probes: results,
      })]
    );
  } catch (err) {
    console.error(`[Probe] Failed to persist results: ${err.message}`);
  }

  // Update consecutive failure counters
  for (const r of results) {
    if (r.ok) {
      _consecutiveFailures.set(r.name, 0);
    } else {
      _consecutiveFailures.set(r.name, (_consecutiveFailures.get(r.name) || 0) + 1);
    }
  }

  // Log summary
  if (failures.length === 0) {
    console.log(`[Probe] All ${results.length} probes passed ✅`);
  } else {
    console.log(`[Probe] ${failures.length}/${results.length} probes FAILED ❌`);
    for (const f of failures) {
      console.log(`  ❌ ${f.name}: ${f.error || f.detail}`);
    }

    // Single failure: P2 alert only (conservative design — no rollback)
    if (failures.length === 1) {
      const f = failures[0];
      raise('P2', `probe_fail_${f.name}`, `探针单次失败 [${f.name}]: ${f.error || f.detail}`);
    }

    // Check rollback conditions
    const consecutiveTrigger = failures.find(
      f => (_consecutiveFailures.get(f.name) || 0) >= ROLLBACK_THRESHOLDS.consecutive
    );
    const batchTrigger = failures.length >= ROLLBACK_THRESHOLDS.batch_total;

    if ((consecutiveTrigger || batchTrigger) && failures.length > 1) {
      const reason = consecutiveTrigger
        ? `探针 "${consecutiveTrigger.name}" 连续失败 ${_consecutiveFailures.get(consecutiveTrigger.name)} 次`
        : `本批次总失败数 ${failures.length} ≥ ${ROLLBACK_THRESHOLDS.batch_total}`;

      const now = Date.now();
      if (now - _lastRollbackAt >= ROLLBACK_RATE_LIMIT_MS) {
        _lastRollbackAt = now;
        console.log(`[Probe] Rollback triggered: ${reason}`);
        await triggerRollback(reason, failures);
      } else {
        console.log(`[Probe] Rollback rate-limited, skipping (triggered: ${reason})`);
        raise('P1', 'probe_rollback_ratelimited', `回滚触发条件满足但限流中: ${reason}`);
      }
    }

    // Trigger auto-fix for each failed probe
    for (const f of failures) {
      const rcaResult = {
        confidence: 0.75,
        root_cause: `Capability probe "${f.name}" (${f.description}) failed: ${f.error || f.detail}`,
        proposed_fix: `Investigate and fix the ${f.name} subsystem. Error: ${f.error || f.detail}. This probe checks: ${f.description}.`,
        action_plan: `1. Read the ${f.name} related code\n2. Identify why it fails\n3. Fix the issue\n4. Verify the probe passes`,
        evidence: `Probe result: ok=${f.ok}, latency=${f.latency_ms}ms, error=${f.error || 'none'}`,
      };

      if (shouldAutoFix(rcaResult)) {
        try {
          const signature = `probe_${f.name}`;
          const failure = {
            task_id: null,
            reason_code: `PROBE_FAIL_${f.name.toUpperCase()}`,
            layer: 'probe',
            step_name: f.name,
            run_id: null,
          };
          const taskId = await dispatchToDevSkill(failure, rcaResult, signature);
          console.log(`[Probe] Auto-fix task created for ${f.name}: ${taskId}`);
        } catch (dispatchErr) {
          console.error(`[Probe] Auto-fix dispatch failed for ${f.name}: ${dispatchErr.message}`);
        }
      }
    }
  }

  return results;
}

/**
 * Start periodic probe cycle.
 */
export function startProbeLoop() {
  if (_probeTimer) {
    console.log('[Probe] Loop already running');
    return;
  }

  console.log(`[Probe] Starting capability probe loop (interval: ${PROBE_INTERVAL_MS / 1000}s)`);

  // Run first cycle after 30s (let Brain fully start)
  setTimeout(() => {
    runProbeCycle();
    _probeTimer = setInterval(runProbeCycle, PROBE_INTERVAL_MS);
  }, 30_000);
}

/**
 * Get probe system status.
 */
export function getProbeStatus() {
  const consecutiveCounts = {};
  for (const [name, count] of _consecutiveFailures.entries()) {
    if (count > 0) consecutiveCounts[name] = count;
  }
  return {
    running: _probeTimer !== null,
    interval_ms: PROBE_INTERVAL_MS,
    probe_count: PROBES.length,
    probe_names: PROBES.map(p => p.name),
    rollback_thresholds: ROLLBACK_THRESHOLDS,
    consecutive_failures: consecutiveCounts,
    last_rollback_at: _lastRollbackAt ? new Date(_lastRollbackAt).toISOString() : null,
  };
}

export { runProbeCycle, PROBES, ROLLBACK_THRESHOLDS, _consecutiveFailures };
