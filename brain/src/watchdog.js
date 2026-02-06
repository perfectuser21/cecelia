/**
 * Cecelia Watchdog - Resource monitoring for running tasks
 *
 * Samples RSS/CPU from /proc for each active task process.
 * Three-tier response based on system pressure:
 *   - Normal (< 0.7): warn only
 *   - Tense (0.7~1.0): kill if RSS high + CPU sustained
 *   - Crisis (>= 1.0): kill top RSS offender only
 *
 * Dynamic thresholds based on total system memory.
 * 60-second startup grace period (except hard RSS limit).
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import os from 'os';

// === Page size (read from system, fallback 4096) ===
let PAGE_SIZE = 4096;
try {
  PAGE_SIZE = parseInt(execSync('getconf PAGE_SIZE', { encoding: 'utf-8', timeout: 1000 }).trim(), 10) || 4096;
} catch { /* default 4096 for x86_64 Linux */ }

// === Dynamic thresholds ===
const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);
const RSS_KILL_MB = Math.min(Math.round(TOTAL_MEM_MB * 0.35), 2400);
const RSS_WARN_MB = Math.round(RSS_KILL_MB * 0.75);
const CPU_SUSTAINED_PCT = 95;
const CPU_SUSTAINED_TICKS = 6;       // 6 * 5s = 30 seconds sustained
const STARTUP_GRACE_SEC = 60;

const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';

// In-memory metrics store: taskId -> { samples: [], pid, pgid }
const _taskMetrics = new Map();

/**
 * Read lock slot info.json files to resolve task → pid/pgid mappings.
 * Returns { pidMap: Map<taskId, {pid, pgid, started, slot}>, staleSlots: [] }
 */
function resolveTaskPids() {
  const pidMap = new Map();
  const staleSlots = [];

  try {
    const entries = readdirSync(LOCK_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('slot-')) continue;
      const infoPath = `${LOCK_DIR}/${entry.name}/info.json`;
      if (!existsSync(infoPath)) continue;

      try {
        const info = JSON.parse(readFileSync(infoPath, 'utf-8'));
        if (!info.task_id || !info.pid) continue;

        // Check if main process still exists
        if (!existsSync(`/proc/${info.pid}`)) {
          staleSlots.push({ slot: entry.name, taskId: info.task_id });
          continue;
        }

        pidMap.set(info.task_id, {
          pid: info.child_pid || info.pid,
          pgid: info.pgid || info.child_pid || info.pid,
          started: info.started || null,
          slot: entry.name,
        });
      } catch { /* corrupt json, skip */ }
    }
  } catch { /* lock dir missing */ }

  return { pidMap, staleSlots };
}

/**
 * Sample RSS and CPU ticks from /proc for a single PID.
 * Returns { rss_mb, cpu_ticks, timestamp } or null if process gone.
 *
 * P0 #3: Parse /proc/stat correctly — comm field can contain spaces
 * and parentheses, so find last ')' before splitting.
 */
function sampleProcess(pid) {
  try {
    // RSS from /proc/{pid}/statm (field 1 = resident pages)
    const statm = readFileSync(`/proc/${pid}/statm`, 'utf-8').trim().split(' ');
    const rssMb = Math.round((parseInt(statm[1], 10) * PAGE_SIZE) / 1024 / 1024);

    // CPU from /proc/{pid}/stat
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const closeParen = stat.lastIndexOf(')');
    const fields = stat.substring(closeParen + 2).split(' ');
    // fields[11] = utime, fields[12] = stime (0-indexed after comm)
    const cpuTicks = parseInt(fields[11], 10) + parseInt(fields[12], 10);

    return { rss_mb: rssMb, cpu_ticks: cpuTicks, timestamp: Date.now() };
  } catch {
    return null; // process gone
  }
}

/**
 * Calculate CPU percentage from two consecutive samples.
 * P0 #4: Single core = 100%, dual = 200%, etc.
 * Linux USER_HZ default = 100 ticks/second.
 */
function calcCpuPct(prev, curr) {
  if (!prev || !curr) return 0;
  const tickDelta = curr.cpu_ticks - prev.cpu_ticks;
  const wallSec = (curr.timestamp - prev.timestamp) / 1000;
  if (wallSec <= 0) return 0;
  return Math.round((tickDelta / 100 / wallSec) * 100);
}

/**
 * Main watchdog check. Called each tick cycle.
 *
 * @param {number} systemPressure - max_pressure from checkServerResources() (0.0~1.0+)
 * @returns {{ actions: Array<{taskId, pid, pgid, action, reason, evidence?}> }}
 */
function checkRunaways(systemPressure) {
  const actions = [];
  const { pidMap } = resolveTaskPids();

  for (const [taskId, { pid, pgid, started }] of pidMap) {
    const sample = sampleProcess(pid);
    if (!sample) continue; // process dead, liveness probe handles it

    // Record sample history
    let metrics = _taskMetrics.get(taskId);
    if (!metrics) {
      metrics = { samples: [], pid, pgid };
      _taskMetrics.set(taskId, metrics);
    }
    const prevSample = metrics.samples[metrics.samples.length - 1] || null;
    sample.cpu_pct = calcCpuPct(prevSample, sample);
    metrics.samples.push(sample);
    if (metrics.samples.length > 60) metrics.samples.shift(); // keep ~5 minutes

    // P1 #5: Startup grace period
    // Origin: info.json.started (set by cecelia-run at spawn time)
    // If missing: no grace period (Infinity → inGracePeriod=false)
    const startedTs = started ? new Date(started).getTime() : NaN;
    const runtimeSec = Number.isFinite(startedTs)
      ? (Date.now() - startedTs) / 1000
      : Infinity;
    const inGracePeriod = runtimeSec < STARTUP_GRACE_SEC;

    // === Detection logic ===

    // 1. Hard RSS limit — unconditional kill (even during grace period)
    if (sample.rss_mb >= RSS_KILL_MB) {
      actions.push({
        taskId, pid, pgid, action: 'kill',
        reason: `RSS ${sample.rss_mb}MB >= hard limit ${RSS_KILL_MB}MB`,
        evidence: { rss_mb: sample.rss_mb, cpu_pct: sample.cpu_pct, pressure: systemPressure },
      });
      continue;
    }

    // Grace period: skip other checks
    if (inGracePeriod) continue;

    // 2. Normal mode (< 0.7): warn only
    if (systemPressure < 0.7) {
      if (sample.rss_mb >= RSS_WARN_MB) {
        actions.push({
          taskId, pid, pgid, action: 'warn',
          reason: `RSS ${sample.rss_mb}MB approaching limit`,
        });
      }
      continue;
    }

    // 3. Tense mode (0.7~1.0): kill if RSS high + CPU sustained
    if (systemPressure < 1.0) {
      const recentSamples = metrics.samples.slice(-CPU_SUSTAINED_TICKS);
      const isCpuSustained = recentSamples.length >= CPU_SUSTAINED_TICKS &&
        recentSamples.every(s => (s.cpu_pct || 0) >= CPU_SUSTAINED_PCT);
      if (sample.rss_mb >= RSS_WARN_MB && isCpuSustained) {
        actions.push({
          taskId, pid, pgid, action: 'kill',
          reason: `Runaway: RSS ${sample.rss_mb}MB + CPU>${CPU_SUSTAINED_PCT}% sustained ${CPU_SUSTAINED_TICKS} ticks`,
          evidence: { rss_mb: sample.rss_mb, cpu_pct: sample.cpu_pct, pressure: systemPressure },
        });
      }
      continue;
    }

    // 4. Crisis mode (>= 1.0): mark as candidate, only kill top 1 RSS
    actions.push({
      taskId, pid, pgid,
      action: 'kill_if_top_offender',
      rss: sample.rss_mb,
      reason: `Crisis: pressure=${systemPressure.toFixed(2)}, RSS=${sample.rss_mb}MB`,
      evidence: { rss_mb: sample.rss_mb, cpu_pct: sample.cpu_pct, pressure: systemPressure },
    });
  }

  // P1 #6: Crisis mode — only kill the single highest RSS offender
  const crisisCandidates = actions.filter(a => a.action === 'kill_if_top_offender');
  if (crisisCandidates.length > 0) {
    crisisCandidates.sort((a, b) => b.rss - a.rss);
    crisisCandidates[0].action = 'kill';
    for (let i = 1; i < crisisCandidates.length; i++) {
      crisisCandidates[i].action = 'warn';
    }
  }

  // Clean up rss field from crisis candidates (internal only)
  for (const a of actions) {
    delete a.rss;
  }

  return { actions };
}

/**
 * Get watchdog diagnostic status (for API endpoint).
 */
function getWatchdogStatus() {
  const { pidMap, staleSlots } = resolveTaskPids();
  const tasks = [];

  for (const [taskId, { pid, pgid, started, slot }] of pidMap) {
    const metrics = _taskMetrics.get(taskId);
    const lastSample = metrics?.samples[metrics.samples.length - 1] || null;
    tasks.push({
      task_id: taskId,
      pid,
      pgid,
      slot,
      started,
      samples_count: metrics?.samples.length || 0,
      last_rss_mb: lastSample?.rss_mb || null,
      last_cpu_pct: lastSample?.cpu_pct || null,
      last_sampled_at: lastSample ? new Date(lastSample.timestamp).toISOString() : null,
    });
  }

  return {
    thresholds: {
      rss_kill_mb: RSS_KILL_MB,
      rss_warn_mb: RSS_WARN_MB,
      cpu_sustained_pct: CPU_SUSTAINED_PCT,
      cpu_sustained_ticks: CPU_SUSTAINED_TICKS,
      startup_grace_sec: STARTUP_GRACE_SEC,
      total_mem_mb: TOTAL_MEM_MB,
    },
    tasks,
    stale_slots: staleSlots,
  };
}

/**
 * Clean up metrics for a task (after kill/completion).
 */
function cleanupMetrics(taskId) {
  _taskMetrics.delete(taskId);
}

export {
  resolveTaskPids,
  sampleProcess,
  calcCpuPct,
  checkRunaways,
  getWatchdogStatus,
  cleanupMetrics,
  // Expose for testing
  RSS_KILL_MB,
  RSS_WARN_MB,
  CPU_SUSTAINED_PCT,
  CPU_SUSTAINED_TICKS,
  STARTUP_GRACE_SEC,
  TOTAL_MEM_MB,
  PAGE_SIZE,
  _taskMetrics,
};
