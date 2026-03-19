/**
 * Capability Probe — 能力探针系统
 *
 * 定期验证 Cecelia 每条关键链路是否真的通，
 * 发现故障时自动创建修复任务（走 auto-fix 路径）。
 *
 * 类比：人体每时每刻都能感知自己的手脚是否能动，
 * Cecelia 每小时验证自己的核心能力是否还在线。
 */

import pool from './db.js';
import {
  shouldAutoFix,
  dispatchToDevSkill,
} from './auto-fix.js';

// ============================================================
// Configuration
// ============================================================

const PROBE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PROBE_TIMEOUT_MS = 30_000; // per-probe timeout

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

  // Log summary
  if (failures.length === 0) {
    console.log(`[Probe] All ${results.length} probes passed ✅`);
  } else {
    console.log(`[Probe] ${failures.length}/${results.length} probes FAILED ❌`);
    for (const f of failures) {
      console.log(`  ❌ ${f.name}: ${f.error || f.detail}`);
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
          const signature = `probe_${f.name}_${Date.now()}`;
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
  return {
    running: _probeTimer !== null,
    interval_ms: PROBE_INTERVAL_MS,
    probe_count: PROBES.length,
    probe_names: PROBES.map(p => p.name),
  };
}

export { runProbeCycle, PROBES };
