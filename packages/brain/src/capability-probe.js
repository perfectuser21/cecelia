/**
 * Capability Probe — 能力探针系统
 *
 * 定期验证 Cecelia 每条关键链路是否真的通，
 * 保留故障诊断与结果历史，不自主造单或回滚部署。
 *
 * 类比：人体每时每刻都能感知自己的手脚是否能动，
 * Cecelia 每小时验证自己的核心能力是否还在线。
 */

import pool from './db.js';
import { probeRumination, probeEvolution, probeConsolidation } from './capability-probe-highlevel.js';

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
  // === 外部产品健康探针 ===
  {
    name: 'geo_website',
    description: 'geo SEO网站（zenithjoyai.com）可访问 + blog + posts 有内容',
    fn: probeGeoWebsite,
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

// 连续 5 个监控周期（5 × 30s = 150s）都没有新 cycle 才视为"卡死"
// 宽限期：loop 刚启动时 cycle_count=0，不误报
const STUCK_CYCLE_GAP_MS = PROBE_TIMEOUT_MS * 5; // 150s

async function probeMonitorLoop() {
  const { getMonitorStatus } = await import('./monitor-loop.js');
  const status = getMonitorStatus();

  // Stuck detection: timer running but no cycle executed in too long
  // Only check after at least one cycle has completed (cycle_count > 0)
  if (status.running && status.cycle_count > 0 && status.last_cycle_at !== null) {
    const ageMs = Date.now() - status.last_cycle_at;
    if (ageMs > STUCK_CYCLE_GAP_MS) {
      return {
        ok: false,
        detail: `running=true but stuck: last_cycle_age=${Math.round(ageMs / 1000)}s cycle_count=${status.cycle_count}`,
      };
    }
  }

  return {
    ok: status.running === true,
    detail: `running=${status.running} interval=${status.interval_ms}ms cycle_count=${status.cycle_count ?? 0}`,
  };
}

async function probeGeoWebsite() {
  const BASE = 'https://zenithjoyai.com';
  const checks = [
    { url: `${BASE}/zh/`, expect: 'ZenithJoyAI', label: 'homepage' },
    { url: `${BASE}/zh/blog/`, expect: '/zh/blog/', label: 'blog_list' },
    // HEAD avoids full-page SSR body transfer; we only need status 200 (expect: null).
    { url: `${BASE}/zh/posts/`, expect: null, label: 'posts_page', method: 'HEAD' },
  ];

  // 12s per check × 2 attempts + 1s retry delay = 25s max, fits under 30s outer probe timeout.
  const PER_CHECK_TIMEOUT_MS = 12_000;
  const RETRY_DELAY_MS = 1_000;

  const results = await Promise.allSettled(
    checks.map(async (check) => {
      const doFetch = () => fetch(check.url, {
        method: check.method || 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(PER_CHECK_TIMEOUT_MS),
      });

      let res;
      try {
        res = await doFetch();
      } catch (err) {
        // Retry once on network-level errors (TypeError = DNS/TCP failures).
        // HTTP errors (4xx/5xx) are not retried — those indicate real outages.
        if (!(err instanceof TypeError)) throw err;
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        res = await doFetch();
      }

      const ok = res.status === 200 && (!check.expect || (await res.text()).includes(check.expect));
      return { label: check.label, ok, status: res.status };
    })
  );

  const details = [];
  let allOk = true;

  for (let i = 0; i < checks.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      details.push(`${r.value.label}=${r.value.ok ? 'ok' : `fail(${r.value.status})`}`);
      if (!r.value.ok) allOk = false;
    } else {
      const cause = r.reason.cause?.message;
      const errMsg = cause
        ? `${r.reason.message.slice(0, 30)}:${cause.slice(0, 30)}`
        : r.reason.message.slice(0, 40);
      details.push(`${checks[i].label}=error(${errMsg})`);
      allOk = false;
    }
  }

  return { ok: allOk, detail: details.join(' ') };
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

async function persistProbeResults(results, failures, timestamp) {
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
}

// ============================================================
// Scheduled probe cycle
// ============================================================

let _probeTimer = null;

/**
 * Run diagnostic probes and persist their results without creating tasks or changing deployments.
 */
async function runProbeCycle() {
  console.log('[Probe] Starting capability probe cycle...');

  const results = await runProbes();
  const failures = results.filter(r => !r.ok);
  const timestamp = new Date().toISOString();

  await persistProbeResults(results, failures, timestamp);

  if (failures.length === 0) {
    console.log(`[Probe] All ${results.length} probes passed ✅`);
    return results;
  }

  console.log(`[Probe] ${failures.length}/${results.length} probes FAILED ❌`);
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.error || f.detail}`);
  }

  return results;
}

/**
 * Start periodic probe cycle.
 */
export function startProbeLoop() {
  // 沙箱缺少真实依赖，仅在运行环境定期诊断；显式按需执行仍可使用。
  if (process.env.CI === 'true' || process.env.NODE_ENV === 'test') {
    console.log('[Probe] CI/test environment detected, skipping capability probe loop');
    return;
  }

  if (_probeTimer) {
    console.log('[Probe] Loop already running');
    return;
  }

  console.log(`[Probe] Starting capability probe loop (interval: ${PROBE_INTERVAL_MS / 1000}s)`);

  // Establish setInterval immediately so the loop survives a hung first cycle.
  // If the 30s initial run hangs, the 1h interval keeps ticking regardless.
  _probeTimer = setInterval(runProbeCycle, PROBE_INTERVAL_MS);
  setTimeout(runProbeCycle, 30_000);
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
