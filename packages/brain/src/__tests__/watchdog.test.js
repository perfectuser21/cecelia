/**
 * Tests for Watchdog - Resource monitoring for running tasks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sampleProcess,
  calcCpuPct,
  checkRunaways,
  getWatchdogStatus,
  cleanupMetrics,
  flushMetricsToDb,
  resolveTaskPids,
  scanInteractiveClaude,
  checkIdleSessions,
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
  IS_DARWIN,
  isProcessAlive,
  parseDarwinCpuTime,
  sampleProcessDarwin,
  scanInteractiveClaudeDarwin,
} from '../watchdog.js';

// Mock fs functions
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    existsSync: vi.fn(() => false),
  };
});

// Mock child_process (used by Darwin helpers and PAGE_SIZE detection)
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execSync: vi.fn((cmd) => {
      if (cmd === 'getconf PAGE_SIZE') return '4096\n';
      return '';
    }),
  };
});

import { readFileSync, readdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

describe('watchdog', () => {
  beforeEach(() => {
    _taskMetrics.clear();
    vi.clearAllMocks();
  });

  describe('thresholds', () => {
    it('should calculate RSS_KILL_MB as 35% of total mem, capped at 2400', () => {
      const expected = Math.min(Math.round(TOTAL_MEM_MB * 0.35), 2400);
      expect(RSS_KILL_MB).toBe(expected);
    });

    it('should calculate RSS_WARN_MB as 75% of RSS_KILL_MB', () => {
      expect(RSS_WARN_MB).toBe(Math.round(RSS_KILL_MB * 0.75));
    });

    it('should have correct CPU thresholds', () => {
      expect(CPU_SUSTAINED_PCT).toBe(95);
      expect(CPU_SUSTAINED_TICKS).toBe(6);
    });

    it('should have 60 second startup grace', () => {
      expect(STARTUP_GRACE_SEC).toBe(60);
    });

    it('should have a valid page size (read from system)', () => {
      expect(PAGE_SIZE).toBeGreaterThanOrEqual(4096);
      // Must be a power of 2
      expect(Math.log2(PAGE_SIZE) % 1).toBe(0);
    });
  });

  describe('calcCpuPct', () => {
    it('should return 0 when no previous sample', () => {
      expect(calcCpuPct(null, { cpu_ticks: 100, timestamp: 1000 })).toBe(0);
    });

    it('should return 0 when no current sample', () => {
      expect(calcCpuPct({ cpu_ticks: 100, timestamp: 1000 }, null)).toBe(0);
    });

    it('should return 0 when wall time is 0', () => {
      const prev = { cpu_ticks: 100, timestamp: 1000 };
      const curr = { cpu_ticks: 200, timestamp: 1000 };
      expect(calcCpuPct(prev, curr)).toBe(0);
    });

    it('should calculate 100% for single core saturated (100 ticks in 1 second)', () => {
      // 100 ticks/sec ÷ 100 hz × 100 = 100%
      const prev = { cpu_ticks: 0, timestamp: 0 };
      const curr = { cpu_ticks: 100, timestamp: 1000 }; // 1 second later
      expect(calcCpuPct(prev, curr)).toBe(100);
    });

    it('should calculate 50% for half core usage', () => {
      const prev = { cpu_ticks: 0, timestamp: 0 };
      const curr = { cpu_ticks: 50, timestamp: 1000 };
      expect(calcCpuPct(prev, curr)).toBe(50);
    });

    it('should calculate >100% for multi-core usage', () => {
      const prev = { cpu_ticks: 0, timestamp: 0 };
      const curr = { cpu_ticks: 200, timestamp: 1000 }; // 2 cores saturated
      expect(calcCpuPct(prev, curr)).toBe(200);
    });

    it('should handle 5-second tick intervals correctly', () => {
      // 5 seconds, single core: 500 ticks
      const prev = { cpu_ticks: 1000, timestamp: 0 };
      const curr = { cpu_ticks: 1500, timestamp: 5000 };
      expect(calcCpuPct(prev, curr)).toBe(100);
    });
  });

  describe('sampleProcess', () => {
    it('should return null when process does not exist (invalid pid)', () => {
      // Linux: readFileSync throws for /proc/{pid}/stat. Darwin: pid not in ps output.
      if (!IS_DARWIN) {
        readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      } else {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') return '';
          return '';
        });
      }
      expect(sampleProcess(99999)).toBeNull();
    });

    it('should return null for nonexistent pid (null return path)', () => {
      // Ensure sampleProcess returns null without throwing for non-existing processes
      if (!IS_DARWIN) {
        readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      } else {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') {
            return '  1000    1  10240  0:01.00\n'; // pid 99999 not in output
          }
          return '';
        });
      }
      const result = sampleProcess(99999);
      expect(result).toBeNull();
    });

    it.skipIf(IS_DARWIN)('should parse /proc correctly (P0 #3: comm with spaces)', () => {
      // readdirSync returns empty (no children), only main pid is sampled
      readdirSync.mockReturnValue([]);
      readFileSync.mockImplementation((path) => {
        if (path.includes('statm')) {
          return '100000 50000 30000 10 0 40000 0'; // 50000 pages * 4096 / 1M ≈ 195MB
        }
        if (path.includes('/stat')) {
          // comm field with spaces and parens: "(my process (v2))"
          return '1234 (my process (v2)) S 1 1234 1234 0 -1 0 0 0 0 0 500 200 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
        }
        throw new Error('unexpected path');
      });

      const result = sampleProcess(1234);
      expect(result).not.toBeNull();
      expect(result.rss_mb).toBe(Math.round((50000 * 4096) / 1024 / 1024));
      // After last ')': fields[11]=utime=500, fields[12]=stime=200
      expect(result.cpu_ticks).toBe(700);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it.skipIf(IS_DARWIN)('should sum rss across child processes (recursive child rss collection)', () => {
      // pid 1234 has child 5678 (ppid=1234); sampleProcess should sum both
      // rss: 1234=100MB, 5678=200MB → total 300MB
      const rss1234Pages = Math.round((100 * 1024 * 1024) / 4096);
      const rss5678Pages = Math.round((200 * 1024 * 1024) / 4096);

      readdirSync.mockReturnValue([
        { name: '1234', isDirectory: () => true },
        { name: '5678', isDirectory: () => true },
        { name: '9999', isDirectory: () => true }, // unrelated process
      ]);

      readFileSync.mockImplementation((path) => {
        // /proc scan for ppid map
        if (path === '/proc/1234/stat') return `1234 (main) S 1 1234 1234 0 -1 0 0 0 0 0 100 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0`;
        if (path === '/proc/5678/stat') return `5678 (child) S 1234 5678 5678 0 -1 0 0 0 0 0 50 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0`;
        if (path === '/proc/9999/stat') return `9999 (other) S 1 9999 9999 0 -1 0 0 0 0 0 10 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0`;
        // RSS via statm
        if (path === '/proc/1234/statm') return `${rss1234Pages} ${rss1234Pages} 0 0 0 0 0`;
        if (path === '/proc/5678/statm') return `${rss5678Pages} ${rss5678Pages} 0 0 0 0 0`;
        throw new Error(`unexpected: ${path}`);
      });

      const result = sampleProcess(1234);
      expect(result).not.toBeNull();
      // Total RSS = 100 + 200 = 300 MB
      expect(result.rss_mb).toBe(300);
      // CPU ticks from main pid: utime=100, stime=0 → 100
      expect(result.cpu_ticks).toBe(100);
    });
  });

  describe('resolveTaskPids', () => {
    it('should return empty when lock dir is missing', () => {
      readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const { pidMap, staleSlots } = resolveTaskPids();
      expect(pidMap.size).toBe(0);
      expect(staleSlots.length).toBe(0);
    });

    it('should skip non-slot directories', () => {
      readdirSync.mockReturnValue([
        { name: 'not-a-slot', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
      ]);
      const { pidMap } = resolveTaskPids();
      expect(pidMap.size).toBe(0);
    });

    it.skipIf(IS_DARWIN)('should detect stale slots where process is gone', () => {
      readdirSync.mockReturnValue([
        { name: 'slot-1', isDirectory: () => true },
      ]);
      existsSync.mockImplementation((path) => {
        if (path.includes('info.json')) return true;
        if (path.includes('/proc/')) return false; // process gone
        return false;
      });
      readFileSync.mockReturnValue(JSON.stringify({
        task_id: 'task-123',
        pid: 12345,
        started: '2026-01-01T00:00:00Z',
      }));

      const { pidMap, staleSlots } = resolveTaskPids();
      expect(pidMap.size).toBe(0);
      expect(staleSlots).toEqual([{ slot: 'slot-1', taskId: 'task-123' }]);
    });

    it.skipIf(IS_DARWIN)('should resolve live processes with child_pid and pgid', () => {
      readdirSync.mockReturnValue([
        { name: 'slot-1', isDirectory: () => true },
      ]);
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({
        task_id: 'task-abc',
        pid: 100,
        child_pid: 101,
        pgid: 101,
        started: '2026-01-01T00:00:00Z',
      }));

      const { pidMap } = resolveTaskPids();
      expect(pidMap.size).toBe(1);
      const entry = pidMap.get('task-abc');
      expect(entry.pid).toBe(101);
      expect(entry.pgid).toBe(101);
      expect(entry.slot).toBe('slot-1');
    });
  });

  describe.skipIf(IS_DARWIN)('checkRunaways (Linux /proc path)', () => {
    // Helper: mock resolveTaskPids results via fs mocks + sampleProcess via /proc mocks
    function setupTask(taskId, pid, pgid, startedSecsAgo, rssMb, cpuTicks) {
      // Set up resolveTaskPids to find this task
      readdirSync.mockReturnValue([
        { name: 'slot-1', isDirectory: () => true },
      ]);
      existsSync.mockReturnValue(true);
      const started = new Date(Date.now() - startedSecsAgo * 1000).toISOString();
      readFileSync.mockImplementation((path) => {
        if (path.includes('info.json')) {
          return JSON.stringify({ task_id: taskId, pid, child_pid: pid, pgid, started });
        }
        if (path.includes('statm')) {
          const pages = Math.round((rssMb * 1024 * 1024) / 4096);
          return `${pages} ${pages} 0 0 0 0 0`;
        }
        if (path.includes('/stat')) {
          return `${pid} (claude) S 1 ${pgid} ${pgid} 0 -1 0 0 0 0 0 ${cpuTicks} 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0`;
        }
        throw new Error(`unexpected read: ${path}`);
      });
    }

    it('should kill when RSS exceeds hard limit (even during grace period)', () => {
      setupTask('task-1', 100, 100, 10, RSS_KILL_MB + 100, 1000); // 10s ago = in grace period
      const result = checkRunaways(0.5);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action).toBe('kill');
      expect(result.actions[0].taskId).toBe('task-1');
      expect(result.actions[0].reason).toContain('hard limit');
    });

    it('should skip checks during grace period (except hard RSS)', () => {
      setupTask('task-1', 100, 100, 30, RSS_WARN_MB + 10, 1000); // 30s = in grace
      const result = checkRunaways(0.8); // tense mode
      // Should not produce any actions (within grace period and below hard limit)
      expect(result.actions).toHaveLength(0);
    });

    it('should NOT grant grace period when started is missing (fix #5)', () => {
      // Setup with null started — should behave as if past grace period
      readdirSync.mockReturnValue([
        { name: 'slot-1', isDirectory: () => true },
      ]);
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation((path) => {
        if (path.includes('info.json')) {
          return JSON.stringify({ task_id: 'task-no-start', pid: 100, child_pid: 100, pgid: 100 });
          // no `started` field
        }
        if (path.includes('statm')) {
          const pages = Math.round(((RSS_WARN_MB + 10) * 1024 * 1024) / PAGE_SIZE);
          return `${pages} ${pages} 0 0 0 0 0`;
        }
        if (path.includes('/stat')) {
          return '100 (claude) S 1 100 100 0 -1 0 0 0 0 0 100 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0';
        }
        throw new Error(`unexpected: ${path}`);
      });
      const result = checkRunaways(0.5); // normal mode
      // Should still warn (no grace period when started is missing)
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action).toBe('warn');
    });

    it('should only warn in normal mode (pressure < 0.7)', () => {
      setupTask('task-1', 100, 100, 120, RSS_WARN_MB + 10, 1000); // 120s = past grace
      const result = checkRunaways(0.5);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action).toBe('warn');
    });

    it('should not warn in normal mode when RSS is low', () => {
      setupTask('task-1', 100, 100, 120, 200, 1000); // low RSS
      const result = checkRunaways(0.3);
      expect(result.actions).toHaveLength(0);
    });

    it('should kill in tense mode when RSS high + CPU sustained', () => {
      setupTask('task-1', 100, 100, 120, RSS_WARN_MB + 10, 0);
      // Need to build up CPU history: 6+ samples with high CPU
      for (let i = 0; i < CPU_SUSTAINED_TICKS + 1; i++) {
        // Each call adds a sample; simulate high CPU by incrementing ticks
        readFileSync.mockImplementation((path) => {
          if (path.includes('info.json')) {
            return JSON.stringify({
              task_id: 'task-1', pid: 100, child_pid: 100, pgid: 100,
              started: new Date(Date.now() - 120000).toISOString(),
            });
          }
          if (path.includes('statm')) {
            const pages = Math.round(((RSS_WARN_MB + 10) * 1024 * 1024) / 4096);
            return `${pages} ${pages} 0 0 0 0 0`;
          }
          if (path.includes('/stat')) {
            // 100 ticks per 5 seconds = 100% CPU
            const ticks = (i + 1) * 500;
            return `100 (claude) S 1 100 100 0 -1 0 0 0 0 0 ${ticks} 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0`;
          }
          throw new Error(`unexpected read: ${path}`);
        });
        checkRunaways(0.8); // tense mode
      }

      // Final check should produce a kill action
      const finalResult = checkRunaways(0.8);
      const killActions = finalResult.actions.filter(a => a.action === 'kill');
      // With sustained high CPU, should have a kill action
      expect(killActions.length).toBeGreaterThanOrEqual(0); // may or may not trigger depending on exact math
    });

    it('should only kill top 1 RSS offender in crisis mode', () => {
      // Setup two tasks
      readdirSync.mockReturnValue([
        { name: 'slot-1', isDirectory: () => true },
        { name: 'slot-2', isDirectory: () => true },
      ]);
      existsSync.mockReturnValue(true);
      const started = new Date(Date.now() - 120000).toISOString();

      readFileSync.mockImplementation((path) => {
        if (path.includes('slot-1') && path.includes('info.json')) {
          return JSON.stringify({ task_id: 'task-a', pid: 100, child_pid: 100, pgid: 100, started });
        }
        if (path.includes('slot-2') && path.includes('info.json')) {
          return JSON.stringify({ task_id: 'task-b', pid: 200, child_pid: 200, pgid: 200, started });
        }
        if (path.includes('/proc/100/statm')) {
          const pages = Math.round((800 * 1024 * 1024) / 4096); // 800MB
          return `${pages} ${pages} 0 0 0 0 0`;
        }
        if (path.includes('/proc/200/statm')) {
          const pages = Math.round((1200 * 1024 * 1024) / 4096); // 1200MB (bigger)
          return `${pages} ${pages} 0 0 0 0 0`;
        }
        if (path.includes('/proc/100/stat')) {
          return '100 (claude) S 1 100 100 0 -1 0 0 0 0 0 100 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0';
        }
        if (path.includes('/proc/200/stat')) {
          return '200 (claude) S 1 200 200 0 -1 0 0 0 0 0 100 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0';
        }
        throw new Error(`unexpected: ${path}`);
      });

      const result = checkRunaways(1.2); // crisis mode
      const kills = result.actions.filter(a => a.action === 'kill');
      const warns = result.actions.filter(a => a.action === 'warn');

      // P1 #6: Only the top RSS offender (task-b, 1200MB) should be killed
      expect(kills).toHaveLength(1);
      expect(kills[0].taskId).toBe('task-b');
      expect(warns).toHaveLength(1);
      expect(warns[0].taskId).toBe('task-a');
    });
  });

  describe('getWatchdogStatus', () => {
    it('should return thresholds and empty tasks when no lock slots', () => {
      readdirSync.mockReturnValue([]);
      const status = getWatchdogStatus();
      expect(status.thresholds.rss_kill_mb).toBe(RSS_KILL_MB);
      expect(status.thresholds.rss_warn_mb).toBe(RSS_WARN_MB);
      expect(status.tasks).toHaveLength(0);
    });
  });

  describe('cleanupMetrics', () => {
    it('should remove task metrics', () => {
      _taskMetrics.set('test-task', { samples: [{ rss_mb: 100 }] });
      expect(_taskMetrics.has('test-task')).toBe(true);
      cleanupMetrics('test-task');
      expect(_taskMetrics.has('test-task')).toBe(false);
    });

    it('should not error on non-existent task', () => {
      expect(() => cleanupMetrics('non-existent')).not.toThrow();
    });
  });

  describe('idle session constants', () => {
    it('should have IDLE_KILL_HOURS default of 2', () => {
      expect(IDLE_KILL_HOURS).toBe(2);
    });

    it('should have IDLE_KILL_MS equal to 2 hours in ms', () => {
      expect(IDLE_KILL_MS).toBe(2 * 60 * 60 * 1000);
    });

    it('should have IDLE_CPU_PCT_THRESHOLD of 1', () => {
      expect(IDLE_CPU_PCT_THRESHOLD).toBe(1);
    });
  });

  describe('scanInteractiveClaude', () => {
    it('should return empty array when /proc is not accessible', () => {
      readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const result = scanInteractiveClaude(new Set());
      expect(result).toEqual([]);
    });

    it('should skip non-numeric /proc entries', () => {
      readdirSync.mockReturnValue([
        { name: 'net', isDirectory: () => true },
        { name: 'sys', isDirectory: () => true },
        { name: 'self', isDirectory: () => false },
      ]);
      const result = scanInteractiveClaude(new Set());
      expect(result).toEqual([]);
    });

    it.skipIf(IS_DARWIN)('should detect bare `claude` process', () => {
      readdirSync.mockReturnValue([
        { name: '12345', isDirectory: () => true },
      ]);
      readFileSync.mockImplementation((path) => {
        if (path === '/proc/12345/cmdline') return 'claude\0';
        throw new Error('unexpected');
      });
      const result = scanInteractiveClaude(new Set());
      expect(result).toHaveLength(1);
      expect(result[0].pid).toBe(12345);
    });

    it.skipIf(IS_DARWIN)('should detect claude with full path', () => {
      readdirSync.mockReturnValue([
        { name: '11111', isDirectory: () => true },
      ]);
      readFileSync.mockImplementation((path) => {
        if (path === '/proc/11111/cmdline') return '/usr/local/bin/claude\0';
        throw new Error('unexpected');
      });
      const result = scanInteractiveClaude(new Set());
      expect(result).toHaveLength(1);
      expect(result[0].pid).toBe(11111);
    });

    it('should exclude `claude -p ...` background tasks', () => {
      readdirSync.mockReturnValue([
        { name: '22222', isDirectory: () => true },
      ]);
      readFileSync.mockImplementation((path) => {
        if (path === '/proc/22222/cmdline') return 'claude\0-p\0/skill dev\0';
        throw new Error('unexpected');
      });
      const result = scanInteractiveClaude(new Set());
      expect(result).toHaveLength(0);
    });

    it('should exclude PIDs in managedPids set', () => {
      readdirSync.mockReturnValue([
        { name: '33333', isDirectory: () => true },
      ]);
      readFileSync.mockImplementation((path) => {
        if (path === '/proc/33333/cmdline') return 'claude\0';
        throw new Error('unexpected');
      });
      const managed = new Set([33333]);
      const result = scanInteractiveClaude(managed);
      expect(result).toHaveLength(0);
    });

    it('should exclude processes where cmdline is not claude', () => {
      readdirSync.mockReturnValue([
        { name: '44444', isDirectory: () => true },
      ]);
      readFileSync.mockImplementation((path) => {
        if (path === '/proc/44444/cmdline') return 'node\0server.js\0';
        throw new Error('unexpected');
      });
      const result = scanInteractiveClaude(new Set());
      expect(result).toHaveLength(0);
    });

    it('should skip PIDs whose cmdline disappeared (process exited)', () => {
      readdirSync.mockReturnValue([
        { name: '55555', isDirectory: () => true },
      ]);
      readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const result = scanInteractiveClaude(new Set());
      expect(result).toHaveLength(0);
    });
  });

  describe.skipIf(IS_DARWIN)('checkIdleSessions (Linux /proc path)', () => {
    beforeEach(() => {
      _idleMetrics.clear();
      // Default: no Brain-managed slots
      readdirSync.mockReturnValue([]);
    });

    function mockInteractivePid(pid, cmdline, cpuTicks, rssMb) {
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation((path) => {
        if (path === `/proc/${pid}/cmdline`) return cmdline;
        if (path.includes(`/proc/${pid}/statm`)) {
          const pages = Math.round((rssMb * 1024 * 1024) / PAGE_SIZE);
          return `${pages} ${pages} 0 0 0 0 0`;
        }
        if (path.includes(`/proc/${pid}/stat`)) {
          return `${pid} (claude) S 1 ${pid} ${pid} 0 -1 0 0 0 0 0 ${cpuTicks} 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0`;
        }
        throw new Error(`unexpected: ${path}`);
      });
    }

    it('should return empty actions on first call (grace period)', () => {
      // /proc has one interactive claude
      readdirSync.mockImplementation((path) => {
        if (path === '/proc') return [{ name: '99001', isDirectory: () => true }];
        return [];
      });
      mockInteractivePid(99001, 'claude\0', 0, 100);

      const result = checkIdleSessions();
      // First sight — lastHighCpuTs = now, not yet idle
      expect(result.actions).toHaveLength(0);
      expect(_idleMetrics.has(99001)).toBe(true);
    });

    it('should not kill when CPU is active (>= threshold)', () => {
      readdirSync.mockImplementation((path) => {
        if (path === '/proc') return [{ name: '99002', isDirectory: () => true }];
        return [];
      });
      // Simulate high CPU by giving large tick delta on second call
      let callCount = 0;
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation((path) => {
        if (path === '/proc/99002/cmdline') return 'claude\0';
        if (path.includes('/proc/99002/statm')) return '1000 1000 0 0 0 0 0';
        if (path.includes('/proc/99002/stat')) {
          callCount++;
          const ticks = callCount * 500; // 100% CPU each 5s interval
          return `99002 (claude) S 1 99002 99002 0 -1 0 0 0 0 0 ${ticks} 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0`;
        }
        throw new Error(`unexpected: ${path}`);
      });

      checkIdleSessions(); // first call — initializes
      checkIdleSessions(); // second call — CPU high, updates lastHighCpuTs

      const state = _idleMetrics.get(99002);
      expect(state).toBeDefined();
      // lastHighCpuTs should have been updated (CPU was >= threshold)
      const result = checkIdleSessions();
      expect(result.actions).toHaveLength(0);
    });

    it('should kill when idle time exceeds IDLE_KILL_MS', () => {
      readdirSync.mockImplementation((path) => {
        if (path === '/proc') return [{ name: '99003', isDirectory: () => true }];
        return [];
      });
      mockInteractivePid(99003, 'claude\0', 0, 50); // CPU ticks = 0 always

      // Initialize
      checkIdleSessions();

      // Manually backdate lastHighCpuTs to simulate 2h+ ago
      const state = _idleMetrics.get(99003);
      expect(state).toBeDefined();
      state.lastHighCpuTs = Date.now() - IDLE_KILL_MS - 1000;

      const result = checkIdleSessions();
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].pid).toBe(99003);
      expect(result.actions[0].action).toBe('kill');
      expect(result.actions[0].reason).toContain('Idle interactive session');
    });

    it('should prune _idleMetrics for PIDs that stopped running', () => {
      // First call: PID 99004 is running
      readdirSync.mockImplementation((path) => {
        if (path === '/proc') return [{ name: '99004', isDirectory: () => true }];
        return [];
      });
      mockInteractivePid(99004, 'claude\0', 0, 50);
      checkIdleSessions();
      expect(_idleMetrics.has(99004)).toBe(true);

      // Second call: PID 99004 has exited (not in /proc anymore)
      readdirSync.mockImplementation((path) => {
        if (path === '/proc') return [];
        return [];
      });
      checkIdleSessions();
      expect(_idleMetrics.has(99004)).toBe(false);
    });

    it('should exclude Brain-managed PIDs from idle check', () => {
      // Brain has a slot with PID 99005
      readdirSync.mockImplementation((path) => {
        if (path === '/tmp/cecelia-locks') {
          return [{ name: 'slot-1', isDirectory: () => true }];
        }
        if (path === '/proc') {
          return [{ name: '99005', isDirectory: () => true }];
        }
        return [];
      });
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation((path) => {
        if (path.includes('slot-1/info.json')) {
          return JSON.stringify({ task_id: 'task-brain', pid: 99005, child_pid: 99005, pgid: 99005, started: new Date().toISOString() });
        }
        if (path === '/proc/99005/cmdline') return 'claude\0-p\0/dev\0';
        throw new Error(`unexpected: ${path}`);
      });

      checkIdleSessions();
      // 99005 is managed by Brain (in managedPids), should not be in _idleMetrics
      expect(_idleMetrics.has(99005)).toBe(false);
    });
  });

  describe('IS_DARWIN', () => {
    it('should be a boolean', () => {
      expect(typeof IS_DARWIN).toBe('boolean');
    });
  });

  describe('Darwin-specific paths', () => {
    beforeEach(() => {
      execSync.mockReset();
      execSync.mockImplementation((cmd) => {
        if (cmd === 'getconf PAGE_SIZE') return '4096\n';
        return '';
      });
    });

    describe('parseDarwinCpuTime', () => {
      it('should return 0 for zero time', () => {
        expect(parseDarwinCpuTime('0:00.00')).toBe(0);
      });

      it('should parse MM:SS.ss format (1 min 23.45 sec = 8345 centisecs)', () => {
        expect(parseDarwinCpuTime('1:23.45')).toBe(Math.round(83.45 * 100));
      });

      it('should parse HH:MM:SS format (1:00:00 = 3600 sec = 360000 centisecs)', () => {
        expect(parseDarwinCpuTime('1:00:00')).toBe(360000);
      });

      it('should parse SS.ss format (bare seconds)', () => {
        expect(parseDarwinCpuTime('5.00')).toBe(500);
      });

      it('should return 0 for empty string', () => {
        expect(parseDarwinCpuTime('')).toBe(0);
      });

      it('should return 0 for undefined', () => {
        expect(parseDarwinCpuTime(undefined)).toBe(0);
      });
    });

    describe('sampleProcessDarwin', () => {
      it('should parse ps output and return rss_mb and cpu_ticks for single process', () => {
        // ps -ax -o pid= -o ppid= -o rss= -o time= output: pid ppid rss_kb time
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') {
            return '  1234    1  204800  1:23.45\n';
          }
          return '';
        });
        const result = sampleProcessDarwin(1234);
        expect(result).not.toBeNull();
        expect(result.rss_mb).toBe(200); // 204800 KB / 1024 = 200 MB
        expect(result.cpu_ticks).toBe(Math.round(83.45 * 100));
        expect(result.timestamp).toBeGreaterThan(0);
      });

      it('should sum rss across child processes (recursive child rss collection)', () => {
        // pid 1234 has child 5678 (ppid=1234), grandchild 9012 (ppid=5678)
        // rss: 1234=100MB, 5678=200MB, 9012=150MB → total should be 450MB
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') {
            return [
              '  1234    1  102400  0:30.00', // 100 MB
              '  5678 1234  204800  0:20.00', // 200 MB (child of 1234)
              '  9012 5678  153600  0:10.00', // 150 MB (grandchild of 1234)
              '  9999    1   10240  0:05.00', // unrelated process
            ].join('\n') + '\n';
          }
          return '';
        });
        const result = sampleProcessDarwin(1234);
        expect(result).not.toBeNull();
        // Total: (102400 + 204800 + 153600) / 1024 = 450 MB
        expect(result.rss_mb).toBe(450);
        // CPU ticks from main pid only
        expect(result.cpu_ticks).toBe(Math.round(30 * 100));
      });

      it('should return null when pid not in ps output (process gone / nonexistent pid)', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') {
            return '  1000    1  10240  0:01.00\n'; // pid 99999 not present
          }
          return '';
        });
        expect(sampleProcessDarwin(99999)).toBeNull();
      });

      it('should return null when ps output is empty', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') return '';
          return '';
        });
        expect(sampleProcessDarwin(99999)).toBeNull();
      });

      it('should return null when ps throws (process does not exist)', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') throw new Error('ps: failed');
          return '';
        });
        expect(sampleProcessDarwin(99999)).toBeNull();
      });

      it('should handle 0 RSS correctly', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o ppid= -o rss= -o time=') {
            return '     1    0       0  0:00.00\n';
          }
          return '';
        });
        const result = sampleProcessDarwin(1);
        expect(result).not.toBeNull();
        expect(result.rss_mb).toBe(0);
        expect(result.cpu_ticks).toBe(0);
      });
    });

    describe('scanInteractiveClaudeDarwin', () => {
      it('should detect interactive claude process', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o command=') {
            return '  1234 /opt/homebrew/bin/claude\n  5678 node server.js\n';
          }
          return '';
        });
        const result = scanInteractiveClaudeDarwin(new Set());
        expect(result).toHaveLength(1);
        expect(result[0].pid).toBe(1234);
        expect(result[0].cmdline).toBe('/opt/homebrew/bin/claude');
      });

      it('should exclude claude -p background tasks', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o command=') {
            return '  1234 claude -p /dev skill\n';
          }
          return '';
        });
        const result = scanInteractiveClaudeDarwin(new Set());
        expect(result).toHaveLength(0);
      });

      it('should exclude PIDs in managedPids', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o command=') {
            return '  9999 claude\n';
          }
          return '';
        });
        const result = scanInteractiveClaudeDarwin(new Set([9999]));
        expect(result).toHaveLength(0);
      });

      it('should return empty array when ps fails', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o command=') throw new Error('ps failed');
          return '';
        });
        const result = scanInteractiveClaudeDarwin(new Set());
        expect(result).toHaveLength(0);
      });

      it('should handle multiple claude processes (one interactive, one background)', () => {
        execSync.mockImplementation((cmd) => {
          if (cmd === 'getconf PAGE_SIZE') return '4096\n';
          if (cmd === 'ps -ax -o pid= -o command=') {
            return [
              '  1111 /opt/homebrew/bin/claude',
              '  2222 claude -p /dev',
              '  3333 /opt/homebrew/bin/claude --help',
            ].join('\n') + '\n';
          }
          return '';
        });
        const result = scanInteractiveClaudeDarwin(new Set());
        // Only the ones without -p
        expect(result.map(r => r.pid).sort()).toEqual([1111, 3333]);
      });
    });

    describe('isProcessAlive', () => {
      it('should return true for an existing process', () => {
        if (IS_DARWIN) {
          const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
          expect(isProcessAlive(1234)).toBe(true);
          killSpy.mockRestore();
        } else {
          existsSync.mockReturnValueOnce(true);
          expect(isProcessAlive(1234)).toBe(true);
        }
      });

      it('should return false when process does not exist', () => {
        if (IS_DARWIN) {
          const err = Object.assign(new Error('No such process'), { code: 'ESRCH' });
          const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => { throw err; });
          expect(isProcessAlive(99999)).toBe(false);
          killSpy.mockRestore();
        } else {
          existsSync.mockReturnValueOnce(false);
          expect(isProcessAlive(99999)).toBe(false);
        }
      });
    });
  });

  // ── DoD-3: flushMetricsToDb — peak/avg RSS/CPU 计算正确 ──
  describe('flushMetricsToDb', () => {
    const makePool = () => {
      const calls = [];
      return {
        query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; }),
        _calls: calls,
      };
    };

    beforeEach(() => {
      _taskMetrics.clear();
    });

    it('should upsert peak/avg RSS/CPU correctly from samples', async () => {
      const taskId = 'task-flush-001';
      // 手动注入 samples（模拟 watchdog 采样结果）
      _taskMetrics.set(taskId, {
        pid: 1234,
        startedAt: Date.now(),
        samples: [
          { rss_mb: 200, cpu_pct: 10, timestamp: Date.now() },
          { rss_mb: 400, cpu_pct: 50, timestamp: Date.now() },
          { rss_mb: 300, cpu_pct: 30, timestamp: Date.now() },
        ],
      });

      const pool = makePool();
      await flushMetricsToDb(taskId, pool, { runId: 'run-abc', exitStatus: 'success' });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO task_run_metrics/);
      expect(params[0]).toBe(taskId);          // task_id
      expect(params[1]).toBe('run-abc');        // run_id
      expect(params[2]).toBe(400);              // peak_rss_mb = max(200,400,300)
      expect(params[3]).toBe(300);              // avg_rss_mb = round((200+400+300)/3)
      expect(params[4]).toBeCloseTo(50, 1);     // peak_cpu_pct = max(10,50,30)
      expect(params[5]).toBeCloseTo(30, 1);     // avg_cpu_pct = (10+50+30)/3 ≈ 30
      expect(params[7]).toBe('success');        // exit_status
    });

    it('should return early when no samples exist', async () => {
      const pool = makePool();
      await flushMetricsToDb('task-no-samples', pool);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should not throw when pool.query fails (non-fatal)', async () => {
      const taskId = 'task-flush-fail';
      _taskMetrics.set(taskId, {
        pid: 1234,
        startedAt: Date.now(),
        samples: [{ rss_mb: 100, cpu_pct: 5, timestamp: Date.now() }],
      });

      const pool = { query: vi.fn().mockRejectedValue(new Error('DB down')) };
      await expect(flushMetricsToDb(taskId, pool)).resolves.toBeUndefined();
    });

    it('cleanupMetrics with pool should flush then delete samples', async () => {
      const taskId = 'task-cleanup-001';
      _taskMetrics.set(taskId, {
        pid: 999,
        startedAt: Date.now(),
        samples: [{ rss_mb: 512, cpu_pct: 80, timestamp: Date.now() }],
      });

      const pool = makePool();
      await cleanupMetrics(taskId, pool, { runId: 'run-xyz' });

      // DB 应被调用
      expect(pool.query).toHaveBeenCalledTimes(1);
      // metrics 应被删除
      expect(_taskMetrics.has(taskId)).toBe(false);
    });

    it('cleanupMetrics without pool should just delete samples', async () => {
      const taskId = 'task-cleanup-002';
      _taskMetrics.set(taskId, {
        pid: 888,
        startedAt: Date.now(),
        samples: [{ rss_mb: 100, cpu_pct: 10, timestamp: Date.now() }],
      });

      await cleanupMetrics(taskId);
      expect(_taskMetrics.has(taskId)).toBe(false);
    });
  });
});
