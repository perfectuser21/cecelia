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
 *
 * Also monitors idle interactive Claude Code sessions:
 *   - Detects foreground `claude` processes not managed by Brain slots
 *   - Kills sessions idle (CPU < 1%) for more than IDLE_KILL_HOURS hours
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

// === Idle interactive session thresholds ===
const IDLE_KILL_HOURS = parseFloat(process.env.IDLE_KILL_HOURS || '2');
const IDLE_KILL_MS = IDLE_KILL_HOURS * 60 * 60 * 1000;
const IDLE_CPU_PCT_THRESHOLD = parseFloat(process.env.IDLE_CPU_PCT_THRESHOLD || '1');

// In-memory metrics store: taskId -> { samples: [], pid, pgid }
const _taskMetrics = new Map();

// In-memory idle session store: pid -> { lastHighCpuTs, prevSample }
const _idleMetrics = new Map();

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
 * Scan /proc for interactive (foreground) Claude Code processes.
 * Returns array of { pid } for processes that are:
 *   - Running the `claude` binary (not `claude -p ...` background tasks)
 *   - Not in managedPids (Brain slot-managed processes)
 *
 * @param {Set<number>} managedPids - PIDs already managed by Brain slots
 * @returns {Array<{pid: number, cmdline: string}>}
 */
function scanInteractiveClaude(managedPids) {
  const result = [];
  let entries;
  try {
    entries = readdirSync('/proc', { withFileTypes: true });
  } catch {
    return result; // /proc not accessible (test env)
  }

  for (const entry of entries) {
    // /proc entries for processes are numeric directories
    if (!entry.isDirectory()) continue;
    const pid = parseInt(entry.name, 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (managedPids.has(pid)) continue;

    try {
      // cmdline has args separated by null bytes
      const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
      const args = raw.split('\0').filter(Boolean);
      if (args.length === 0) continue;

      // The binary path (first arg) must end with 'claude' or equal 'claude'
      const bin = args[0];
      if (!bin.endsWith('/claude') && bin !== 'claude') continue;

      // Exclude background tasks: `claude -p ...` (Brain-dispatched)
      if (args.includes('-p')) continue;

      // Exclude wrapper invocations passed via shell
      // (These show up as bash -c "claude ..." — not directly as claude)
      result.push({ pid, cmdline: args.join(' ') });
    } catch {
      // Process may have exited between readdirSync and readFileSync
    }
  }

  return result;
}

/**
 * Check for idle interactive Claude Code sessions and return kill actions.
 *
 * A session is considered idle when its CPU usage stays below
 * IDLE_CPU_PCT_THRESHOLD (default 1%) for IDLE_KILL_MS (default 2 hours).
 *
 * Algorithm:
 *   - Track `lastHighCpuTs` per PID: timestamp of last CPU >= threshold
 *   - On first sight, set lastHighCpuTs = now (give initial grace)
 *   - Each call: sample CPU, update lastHighCpuTs if CPU is high
 *   - If now - lastHighCpuTs > IDLE_KILL_MS → return kill action
 *   - Prune _idleMetrics entries for PIDs that are no longer running
 *
 * @returns {{ actions: Array<{pid, action: 'kill'|'warn', reason, idleMs}> }}
 */
function checkIdleSessions() {
  const actions = [];
  const { pidMap } = resolveTaskPids();

  // Build set of managed PIDs (Brain slot-managed: use both pid and pgid)
  const managedPids = new Set();
  for (const { pid, pgid } of pidMap.values()) {
    managedPids.add(pid);
    if (pgid) managedPids.add(pgid);
  }

  const interactiveSessions = scanInteractiveClaude(managedPids);
  const nowTs = Date.now();

  // Prune _idleMetrics for PIDs no longer running
  const activePids = new Set(interactiveSessions.map(s => s.pid));
  for (const pid of _idleMetrics.keys()) {
    if (!activePids.has(pid)) {
      _idleMetrics.delete(pid);
    }
  }

  for (const { pid } of interactiveSessions) {
    const sample = sampleProcess(pid);
    if (!sample) {
      _idleMetrics.delete(pid);
      continue;
    }

    let state = _idleMetrics.get(pid);
    if (!state) {
      // First time seeing this PID — initialize, give grace (CPU "was high" just now)
      state = { lastHighCpuTs: nowTs, prevSample: null };
      _idleMetrics.set(pid, state);
    }

    const cpuPct = calcCpuPct(state.prevSample, sample);
    state.prevSample = sample;

    if (cpuPct >= IDLE_CPU_PCT_THRESHOLD) {
      state.lastHighCpuTs = nowTs;
    }

    const idleMs = nowTs - state.lastHighCpuTs;
    if (idleMs >= IDLE_KILL_MS) {
      actions.push({
        pid,
        action: 'kill',
        reason: `Idle interactive session: CPU<${IDLE_CPU_PCT_THRESHOLD}% for ${Math.round(idleMs / 60000)}min`,
        idleMs,
      });
    }
  }

  return { actions };
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
  scanInteractiveClaude,
  checkIdleSessions,
  // Expose for testing
  RSS_KILL_MB,
  RSS_WARN_MB,
  CPU_SUSTAINED_PCT,
  CPU_SUSTAINED_TICKS,
  STARTUP_GRACE_SEC,
  TOTAL_MEM_MB,
  PAGE_SIZE,
  IDLE_KILL_HOURS,
  IDLE_KILL_MS,
  IDLE_CPU_PCT_THRESHOLD,
  _taskMetrics,
  _idleMetrics,
};
