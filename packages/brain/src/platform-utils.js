/**
 * Platform Utils - Unified platform abstraction layer for Brain
 *
 * Provides Darwin (macOS) / Linux compatible implementations of:
 * - Process listing and detection
 * - CPU usage sampling
 * - Swap memory reading
 * - Process info (cmdline, cwd, environ)
 * - Network statistics
 *
 * Reference: watchdog.js IS_DARWIN pattern (already working well)
 */

/* global console */

import { execSync } from 'child_process';
import { readFileSync, readlinkSync, existsSync } from 'fs';
import os from 'os';

// ============================================================
// Platform Detection
// ============================================================

export const IS_DARWIN = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';

// ============================================================
// Process Listing
// ============================================================

/**
 * List all processes with pid, elapsed time (seconds), comm, and args.
 * Used by slot-allocator detectUserSessions().
 *
 * Linux:  ps -eo pid,etimes,comm,args --no-headers
 * Darwin: ps -ax -o pid=,etime=,comm=,args=
 *
 * Returns array of { pid, elapsedSec, comm, args }
 */
export function listProcessesWithElapsed() {
  try {
    let output;
    if (IS_DARWIN) {
      // macOS: etime format is [[dd-]hh:]mm:ss, need to parse manually
      output = execSync('ps -ax -o pid=,etime=,comm=,args=', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
    } else {
      // Linux: etimes gives elapsed time in seconds directly
      output = execSync('ps -eo pid,etimes,comm,args --no-headers', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
    }

    if (!output) return [];

    const results = [];
    for (const line of output.split('\n').filter(Boolean)) {
      const trimmed = line.trim();
      // Parse: PID ETIME COMM ARGS...
      // On both platforms, fields are space-separated
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) continue;

      const pid = parseInt(parts[0], 10);
      if (isNaN(pid)) continue;

      let elapsedSec;
      if (IS_DARWIN) {
        elapsedSec = parseEtime(parts[1]);
      } else {
        elapsedSec = parseInt(parts[1], 10);
      }

      const comm = parts[2];
      const args = parts.slice(3).join(' ');

      results.push({ pid, elapsedSec, comm, args });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Parse macOS etime format: [[dd-]hh:]mm:ss
 * Examples: "01:23" = 83s, "02:01:23" = 7283s, "1-02:03:04" = 93784s
 */
export function parseEtime(etime) {
  if (!etime) return 0;

  let days = 0;
  let rest = etime;

  // Check for days: "dd-..."
  const dashIdx = rest.indexOf('-');
  if (dashIdx > 0) {
    days = parseInt(rest.slice(0, dashIdx), 10) || 0;
    rest = rest.slice(dashIdx + 1);
  }

  const parts = rest.split(':').map(s => parseFloat(s) || 0);

  if (parts.length === 3) {
    // hh:mm:ss
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + Math.floor(parts[2]);
  } else if (parts.length === 2) {
    // mm:ss
    return days * 86400 + parts[0] * 60 + Math.floor(parts[1]);
  } else {
    return days * 86400 + Math.floor(parts[0]);
  }
}

/**
 * List processes with pid, ppid, and args.
 * Used by zombie-sweep sweepOrphanProcesses().
 *
 * Linux:  ps -eo pid=,ppid=,args=
 * Darwin: ps -ax -o pid=,ppid=,args=
 *
 * Returns array of { pid, ppid, cmd }
 */
export function listProcessesWithPpid() {
  try {
    const cmd = IS_DARWIN
      ? 'ps -ax -o pid=,ppid=,args='
      : 'ps -eo pid=,ppid=,args=';

    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    return output.split('\n').map(line => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: parseInt(match[1], 10), ppid: parseInt(match[2], 10), cmd: match[3] };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================
// Claude Process Counting
// ============================================================

/**
 * Count all claude processes on the system.
 * Used by executor getActiveProcessCount().
 *
 * Linux:  pgrep -xc claude
 * Darwin: ps ax -o comm= | grep -cx claude
 *
 * Returns integer count.
 */
export function countClaudeProcesses() {
  try {
    let result;
    if (IS_DARWIN) {
      result = execSync('ps ax -o comm= | grep -cx claude 2>/dev/null || echo 0', {
        encoding: 'utf-8',
      });
    } else {
      result = execSync('pgrep -xc claude 2>/dev/null || echo 0', {
        encoding: 'utf-8',
      });
    }
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// ============================================================
// CPU Usage Sampling
// ============================================================

let _prevCpuTimes = null;

/**
 * Sample CPU usage percentage.
 * Used by executor sampleCpuUsage() / checkServerResources().
 *
 * Linux:  reads /proc/stat, calculates delta idle/total
 * Darwin: uses os.loadavg()[0] / cores * 100 as proxy
 *
 * Returns integer percentage (0-100) or null on first call (Linux).
 */
export function sampleCpuUsage() {
  if (IS_DARWIN) {
    // macOS: no /proc/stat, use load average as proxy
    const load1 = os.loadavg()[0];
    const cores = os.cpus().length;
    return Math.min(100, Math.round(load1 / cores * 100));
  }

  // Linux: /proc/stat delta sampling
  try {
    const line = readFileSync('/proc/stat', 'utf-8').split('\n')[0];
    const parts = line.split(/\s+/).slice(1).map(Number);
    if (parts.length < 4) return null;
    const idle = parts[3] + (parts[4] || 0); // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    if (!_prevCpuTimes) { _prevCpuTimes = { idle, total }; return null; }
    const diffIdle = idle - _prevCpuTimes.idle;
    const diffTotal = total - _prevCpuTimes.total;
    _prevCpuTimes = { idle, total };
    if (diffTotal === 0) return 0;
    return Math.round((1 - diffIdle / diffTotal) * 100);
  } catch { return null; }
}

/** Reset CPU sampler state (for testing) */
export function _resetCpuSampler() { _prevCpuTimes = null; }

// ============================================================
// Swap Memory
// ============================================================

/**
 * Read swap usage percentage.
 * Used by executor checkServerResources().
 *
 * Linux:  reads /proc/meminfo (SwapTotal/SwapFree)
 * Darwin: runs `sysctl vm.swapusage` and parses output
 *
 * Returns integer percentage (0-100).
 */
export function getSwapUsedPct() {
  if (IS_DARWIN) {
    try {
      const output = execSync('sysctl vm.swapusage', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      // Format: "vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)"
      const totalMatch = output.match(/total\s*=\s*([\d.]+)M/);
      const usedMatch = output.match(/used\s*=\s*([\d.]+)M/);
      if (totalMatch && usedMatch) {
        const total = parseFloat(totalMatch[1]);
        const used = parseFloat(usedMatch[1]);
        if (total > 0) return Math.round((used / total) * 100);
      }
      return 0;
    } catch {
      return 0;
    }
  }

  // Linux: /proc/meminfo
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8');
    const swapTotal = parseInt(meminfo.match(/SwapTotal:\s+(\d+)/)?.[1] || '0', 10);
    const swapFree = parseInt(meminfo.match(/SwapFree:\s+(\d+)/)?.[1] || '0', 10);
    if (swapTotal > 0) {
      return Math.round(((swapTotal - swapFree) / swapTotal) * 100);
    }
    return 0;
  } catch {
    return 0;
  }
}

// ============================================================
// System dmesg
// ============================================================

/**
 * Get system dmesg information (last 100 lines).
 * Used by executor checkExitReason() to detect OOM Killer events.
 *
 * Linux:  dmesg | tail -100
 * Darwin: dmesg requires sudo, return null (graceful degradation)
 *
 * Returns string or null.
 */
export function getDmesgInfo() {
  if (IS_DARWIN) {
    // macOS dmesg requires sudo privileges; graceful degradation
    return null;
  }

  try {
    return execSync('dmesg | tail -100', {
      timeout: 5000,
      encoding: 'utf-8',
    });
  } catch {
    return null;
  }
}

// ============================================================
// Process Info (cmdline, cwd, environ)
// ============================================================

/**
 * Read process command line arguments.
 * Used by routes/cluster.js readCmdline().
 *
 * Linux:  reads /proc/{pid}/cmdline (null-separated)
 * Darwin: uses ps -o args= -p {pid}
 *
 * Returns array of strings or null.
 */
export function readCmdline(pid) {
  if (IS_DARWIN) {
    try {
      const output = execSync(`ps -o args= -p ${pid}`, {
        encoding: 'utf-8',
        timeout: 2000,
      }).trim();
      if (!output) return null;
      return output.split(/\s+/).filter(Boolean);
    } catch {
      return null;
    }
  }

  // Linux: /proc/{pid}/cmdline
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return raw.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Read process current working directory.
 * Used by routes/cluster.js session-info.
 *
 * Linux:  readlinkSync(/proc/{pid}/cwd)
 * Darwin: lsof -a -p {pid} -d cwd -Fn | grep ^n | cut -c2-
 *
 * Returns string path or null.
 */
export function readProcessCwd(pid) {
  if (IS_DARWIN) {
    try {
      const output = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      // Output format: lines starting with 'p' (pid) and 'n' (name/path)
      for (const line of output.split('\n')) {
        if (line.startsWith('n') && line.length > 1) {
          return line.slice(1);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Linux: /proc/{pid}/cwd symlink
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/**
 * Read process environment variables.
 * Used by routes/cluster.js session-providers.
 *
 * Linux:  reads /proc/{pid}/environ (null-separated key=value pairs)
 * Darwin: no reliable way to read another process's environment without root.
 *         Graceful degradation: return defaults.
 *
 * Returns object with requested keys.
 */
export function readProcessEnv(pid, keys) {
  const result = {};
  for (const k of keys) result[k] = null;

  if (IS_DARWIN) {
    // macOS: no reliable way to read another process's environment
    // without root. Graceful degradation: return defaults.
    return result;
  }

  // Linux: /proc/{pid}/environ
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, 'utf-8');
    const entries = raw.split('\0');
    for (const entry of entries) {
      const eqIdx = entry.indexOf('=');
      if (eqIdx === -1) continue;
      const key = entry.slice(0, eqIdx);
      if (keys.includes(key)) {
        result[key] = entry.slice(eqIdx + 1);
      }
    }
  } catch {
    // cannot read environ
  }
  return result;
}

/**
 * Check if a process exists by PID.
 * Used by routes/cluster.js to check /proc/{pid} existence.
 *
 * Linux:  existsSync(/proc/{pid})
 * Darwin: process.kill(pid, 0)
 *
 * Returns boolean.
 */
export function processExists(pid) {
  if (IS_DARWIN) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  return existsSync(`/proc/${pid}`);
}

// ============================================================
// CPU Usage for VPS Monitor
// ============================================================

/**
 * Get current CPU usage percentage for VPS monitor display.
 *
 * Linux:  top -bn1 | grep 'Cpu(s)' | awk '{print $2}'
 * Darwin: top -l 1 -n 0 | grep "CPU usage"
 *
 * Returns float percentage.
 */
export function getTopCpuUsage() {
  if (IS_DARWIN) {
    try {
      const output = execSync("top -l 1 -n 0 2>/dev/null | grep 'CPU usage'", {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
      // Format: "CPU usage: 5.26% user, 3.50% sys, 91.23% idle"
      const userMatch = output.match(/([\d.]+)%\s*user/);
      const sysMatch = output.match(/([\d.]+)%\s*sys/);
      const user = parseFloat(userMatch?.[1] || '0');
      const sys = parseFloat(sysMatch?.[1] || '0');
      return user + sys;
    } catch {
      return Math.min(100, (os.loadavg()[0] / os.cpus().length) * 100);
    }
  }

  // Linux: top -bn1
  try {
    const output = execSync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'", {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return parseFloat(output) || 0;
  } catch {
    return Math.min(100, (os.loadavg()[0] / os.cpus().length) * 100);
  }
}

// ============================================================
// Network Statistics for VPS Monitor
// ============================================================

/**
 * Get network interface statistics.
 *
 * Linux:  reads /sys/class/net/{name}/statistics/rx_bytes etc.
 * Darwin: parses netstat -bi output
 *
 * Returns { bytesReceived, bytesSent, packetsReceived, packetsSent } for given interface name.
 */
export function getNetworkStats(interfaceName) {
  if (IS_DARWIN) {
    try {
      const output = execSync('netstat -bi', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      // Parse netstat -bi output
      // Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === interfaceName && parts.length >= 11) {
          // Find the line with Link# (raw interface stats)
          if (parts[2] === '<Link#' || parts[2]?.startsWith('<Link')) {
            return {
              bytesReceived: parseInt(parts[6], 10) || 0,
              bytesSent: parseInt(parts[9], 10) || 0,
              packetsReceived: parseInt(parts[4], 10) || 0,
              packetsSent: parseInt(parts[7], 10) || 0,
            };
          }
        }
      }
      return { bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsSent: 0 };
    } catch {
      return { bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsSent: 0 };
    }
  }

  // Linux: /sys/class/net/{name}/statistics/
  function safeRead(filePath) {
    try { return parseInt(readFileSync(filePath, 'utf-8').trim(), 10) || 0; } catch { return 0; }
  }

  const base = `/sys/class/net/${interfaceName}/statistics`;
  return {
    bytesReceived: safeRead(`${base}/rx_bytes`),
    bytesSent: safeRead(`${base}/tx_bytes`),
    packetsReceived: safeRead(`${base}/rx_packets`),
    packetsSent: safeRead(`${base}/tx_packets`),
  };
}

// ============================================================
// Physical Capacity Calculation
// ============================================================

const SYSTEM_RESERVED_MB = 5000;  // Reserve 5GB for OS + other services
const MAX_PHYSICAL_CAP = 10;      // Hard cap: never allocate more than 10 slots

/**
 * Calculate physical capacity (max concurrent task slots) from hardware.
 * Accounts for system reserved memory and applies a hard cap.
 *
 * @param {number} totalMemMb - Total system memory in MB
 * @param {number} cpuCores - Number of CPU cores
 * @param {number} memPerTaskMb - Memory per task in MB (default 350)
 * @param {number} cpuPerTask - CPU cores per task (default 0.5)
 * @returns {number} Physical capacity (2 <= result <= MAX_PHYSICAL_CAP)
 */
export function calculatePhysicalCapacity(totalMemMb, cpuCores, memPerTaskMb = 350, cpuPerTask = 0.5) {
  const usableMemMb = (totalMemMb - SYSTEM_RESERVED_MB) * 0.8;
  const usableCpu = cpuCores * 0.8;
  const raw = Math.floor(Math.min(usableMemMb / memPerTaskMb, usableCpu / cpuPerTask));
  return Math.min(Math.max(raw, 2), MAX_PHYSICAL_CAP);
}

export { SYSTEM_RESERVED_MB, MAX_PHYSICAL_CAP };
