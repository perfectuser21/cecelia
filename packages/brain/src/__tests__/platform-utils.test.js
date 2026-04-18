/**
 * Tests for platform-utils.js
 * Validates platform abstraction layer functions work on the current platform.
 *
 * isolate:false 注意：
 * executor-*.test.js 等文件会 mock child_process，导致 platform-utils.js 以 mocked execSync 加载。
 * 解决方案：在 beforeAll 中先调用 vi.unmock('child_process')，再动态 import 以获取真实模块。
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// 动态导入所有 platform-utils 导出（在 beforeAll 中解包）
let IS_DARWIN, IS_LINUX, parseEtime, listProcessesWithElapsed,
  listProcessesWithPpid, countClaudeProcesses, sampleCpuUsage, _resetCpuSampler,
  getSwapUsedPct, getDmesgInfo, readCmdline, readProcessCwd, readProcessEnv,
  processExists, getTopCpuUsage, getNetworkStats, calculatePhysicalCapacity,
  SYSTEM_RESERVED_MB, MAX_PHYSICAL_CAP,
  evaluateMemoryHealth, getBrainRssMB,
  BRAIN_RSS_DANGER_MB, BRAIN_RSS_WARN_MB, SYSTEM_AVAILABLE_FLOOR_MB;

beforeAll(async () => {
  // 恢复真实 child_process（executor-*.test.js 可能已 mock 它）
  vi.unmock('child_process');
  // 注意：不调用 vi.resetModules()，那会破坏 vitest 的模块追踪

  const mod = await import('../platform-utils.js');
  IS_DARWIN = mod.IS_DARWIN;
  IS_LINUX = mod.IS_LINUX;
  parseEtime = mod.parseEtime;
  listProcessesWithElapsed = mod.listProcessesWithElapsed;
  listProcessesWithPpid = mod.listProcessesWithPpid;
  countClaudeProcesses = mod.countClaudeProcesses;
  sampleCpuUsage = mod.sampleCpuUsage;
  _resetCpuSampler = mod._resetCpuSampler;
  getSwapUsedPct = mod.getSwapUsedPct;
  getDmesgInfo = mod.getDmesgInfo;
  readCmdline = mod.readCmdline;
  readProcessCwd = mod.readProcessCwd;
  readProcessEnv = mod.readProcessEnv;
  processExists = mod.processExists;
  getTopCpuUsage = mod.getTopCpuUsage;
  getNetworkStats = mod.getNetworkStats;
  calculatePhysicalCapacity = mod.calculatePhysicalCapacity;
  SYSTEM_RESERVED_MB = mod.SYSTEM_RESERVED_MB;
  MAX_PHYSICAL_CAP = mod.MAX_PHYSICAL_CAP;
  evaluateMemoryHealth = mod.evaluateMemoryHealth;
  getBrainRssMB = mod.getBrainRssMB;
  BRAIN_RSS_DANGER_MB = mod.BRAIN_RSS_DANGER_MB;
  BRAIN_RSS_WARN_MB = mod.BRAIN_RSS_WARN_MB;
  SYSTEM_AVAILABLE_FLOOR_MB = mod.SYSTEM_AVAILABLE_FLOOR_MB;
});

describe('platform-utils', () => {

  describe('platform detection', () => {
    it('should detect exactly one platform', () => {
      // At least one must be true on a real system (unless Windows)
      expect(typeof IS_DARWIN).toBe('boolean');
      expect(typeof IS_LINUX).toBe('boolean');
      // Cannot be both
      expect(IS_DARWIN && IS_LINUX).toBe(false);
    });
  });

  describe('parseEtime', () => {
    it('should parse mm:ss format', () => {
      expect(parseEtime('01:23')).toBe(83);
      expect(parseEtime('00:05')).toBe(5);
    });

    it('should parse hh:mm:ss format', () => {
      expect(parseEtime('02:01:23')).toBe(7283);
      expect(parseEtime('00:00:30')).toBe(30);
    });

    it('should parse dd-hh:mm:ss format', () => {
      expect(parseEtime('1-02:03:04')).toBe(93784);
      expect(parseEtime('0-00:01:00')).toBe(60);
    });

    it('should handle empty/null input', () => {
      expect(parseEtime('')).toBe(0);
      expect(parseEtime(null)).toBe(0);
      expect(parseEtime(undefined)).toBe(0);
    });
  });

  describe('listProcessesWithElapsed', () => {
    it('should return array of process objects', () => {
      const procs = listProcessesWithElapsed();
      expect(Array.isArray(procs)).toBe(true);
      expect(procs.length).toBeGreaterThan(0);

      const proc = procs[0];
      expect(proc).toHaveProperty('pid');
      expect(proc).toHaveProperty('elapsedSec');
      expect(proc).toHaveProperty('comm');
      expect(proc).toHaveProperty('args');
      expect(typeof proc.pid).toBe('number');
      expect(typeof proc.elapsedSec).toBe('number');
    });
  });

  describe('listProcessesWithPpid', () => {
    it('should return array with pid and ppid', () => {
      const procs = listProcessesWithPpid();
      expect(Array.isArray(procs)).toBe(true);
      expect(procs.length).toBeGreaterThan(0);

      const proc = procs[0];
      expect(proc).toHaveProperty('pid');
      expect(proc).toHaveProperty('ppid');
      expect(proc).toHaveProperty('cmd');
    });
  });

  describe('countClaudeProcesses', () => {
    it('should return a non-negative integer', () => {
      const count = countClaudeProcesses();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('sampleCpuUsage', () => {
    it('should return a number on Darwin, or null then number on Linux', () => {
      _resetCpuSampler();
      const first = sampleCpuUsage();
      if (IS_DARWIN) {
        // Darwin returns immediately from loadavg
        expect(typeof first).toBe('number');
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThanOrEqual(100);
      } else {
        // Linux: first call initializes, returns null
        expect(first).toBeNull();
        const second = sampleCpuUsage();
        expect(typeof second).toBe('number');
      }
    });
  });

  describe('getSwapUsedPct', () => {
    it('should return a number 0-100', () => {
      const pct = getSwapUsedPct();
      expect(typeof pct).toBe('number');
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    });
  });

  describe('getDmesgInfo', () => {
    it('should return null on Darwin, string or null on Linux', () => {
      const result = getDmesgInfo();
      if (IS_DARWIN) {
        expect(result).toBeNull();
      } else {
        // Linux: may return string or null (if no permissions)
        expect(result === null || typeof result === 'string').toBe(true);
      }
    });
  });

  describe('readCmdline', () => {
    it('should read own process cmdline', () => {
      const args = readCmdline(process.pid);
      // Should return array with node in it
      expect(Array.isArray(args)).toBe(true);
      expect(args.length).toBeGreaterThan(0);
    });

    it('should return null for non-existent PID', () => {
      const args = readCmdline(999999);
      expect(args).toBeNull();
    });
  });

  describe('readProcessCwd', () => {
    it('should read own process cwd', () => {
      const cwd = readProcessCwd(process.pid);
      // Should return a string path
      expect(typeof cwd).toBe('string');
      expect(cwd.length).toBeGreaterThan(0);
    });
  });

  describe('readProcessEnv', () => {
    it('should return object with requested keys', () => {
      const result = readProcessEnv(process.pid, ['HOME', 'PATH', 'NONEXISTENT_KEY_XYZ']);
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('HOME');
      expect(result).toHaveProperty('NONEXISTENT_KEY_XYZ');
      // On Darwin, all values will be null (graceful degradation)
      if (IS_LINUX) {
        expect(result.HOME).not.toBeNull();
      }
    });
  });

  describe('processExists', () => {
    it('should return true for own process', () => {
      expect(processExists(process.pid)).toBe(true);
    });

    it('should return false for non-existent PID', () => {
      expect(processExists(999999)).toBe(false);
    });
  });

  describe('getTopCpuUsage', () => {
    it('should return a number 0-100', () => {
      const usage = getTopCpuUsage();
      expect(typeof usage).toBe('number');
      expect(usage).toBeGreaterThanOrEqual(0);
      expect(usage).toBeLessThanOrEqual(100);
    });
  });

  describe('getNetworkStats', () => {
    it('should return stats object with expected fields', () => {
      // Use a common interface name
      const ifName = IS_DARWIN ? 'en0' : 'eth0';
      const stats = getNetworkStats(ifName);
      expect(stats).toHaveProperty('bytesReceived');
      expect(stats).toHaveProperty('bytesSent');
      expect(stats).toHaveProperty('packetsReceived');
      expect(stats).toHaveProperty('packetsSent');
      expect(typeof stats.bytesReceived).toBe('number');
    });

    it('should return zeros for non-existent interface', () => {
      const stats = getNetworkStats('nonexistent_iface_xyz');
      expect(stats.bytesReceived).toBe(0);
      expect(stats.bytesSent).toBe(0);
    });
  });

  describe('calculatePhysicalCapacity', () => {
    it('should cap at MAX_PHYSICAL_CAP', () => {
      // 128GB, 32 cores => would be huge without cap
      const result = calculatePhysicalCapacity(131072, 32);
      expect(result).toBeLessThanOrEqual(MAX_PHYSICAL_CAP);
    });

    it('should floor at 2', () => {
      // Very small system
      const result = calculatePhysicalCapacity(2000, 1);
      expect(result).toBeGreaterThanOrEqual(2);
    });

    it('should account for SYSTEM_RESERVED_MB', () => {
      expect(SYSTEM_RESERVED_MB).toBe(5000);
      // 16GB Mac mini: (16384 - 5000) * 0.8 / 350 = ~26, capped to 20
      // CPU: 10 * 0.8 / 0.5 = 16
      // min(26, 16) = 16, capped to 20 → result = 16
      const result = calculatePhysicalCapacity(16384, 10, 350, 0.5);
      expect(result).toBe(16);
    });

    it('should give reasonable value for Mac mini 16GB 10-core', () => {
      const result = calculatePhysicalCapacity(16384, 10, 350, 0.5);
      expect(result).toBeLessThanOrEqual(20);
      expect(result).toBeGreaterThanOrEqual(2);
    });
  });

  describe('evaluateMemoryHealth (PIVOT 2026-04-18)', () => {
    // 4 canonical scenarios — Brain OK/bad × System OK/low
    it('scenario 1: Brain OK + System OK → proceed', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 500,
        system_available_mb: 8000,
        system_total_mb: 16384,
      });
      expect(r.brain_memory_ok).toBe(true);
      expect(r.system_memory_ok).toBe(true);
      expect(r.action).toBe('proceed');
    });

    it('scenario 2: Brain OK + System LOW → warn (do NOT halt; Brain is victim)', () => {
      // Exact scenario from the user report: system=274MB, Brain=631MB
      const r = evaluateMemoryHealth({
        brain_rss_mb: 631,
        system_available_mb: 274,
        system_total_mb: 16384,
      });
      expect(r.brain_memory_ok).toBe(true);
      expect(r.system_memory_ok).toBe(false);
      expect(r.action).toBe('warn');
      expect(r.reason).toMatch(/other apps/i);
    });

    it('scenario 3: Brain BAD (RSS > danger) + System OK → halt (real leak)', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 1600,
        system_available_mb: 8000,
        system_total_mb: 16384,
      });
      expect(r.brain_memory_ok).toBe(false);
      expect(r.system_memory_ok).toBe(true);
      expect(r.action).toBe('halt');
      expect(r.reason).toMatch(/real leak/i);
    });

    it('scenario 4: Brain BAD + System LOW → halt (Brain is the cause)', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 2000,
        system_available_mb: 200,
        system_total_mb: 16384,
      });
      expect(r.brain_memory_ok).toBe(false);
      expect(r.system_memory_ok).toBe(false);
      expect(r.action).toBe('halt');
    });

    it('Brain in warn zone (>1GB, <1.5GB) + System OK → warn', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 1200,
        system_available_mb: 8000,
        system_total_mb: 16384,
      });
      expect(r.brain_memory_ok).toBe(true);
      expect(r.action).toBe('warn');
      expect(r.reason).toMatch(/warn level/i);
    });

    it('system threshold scales: 16GB → 819MB (5%), not 600MB floor', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 500,
        system_available_mb: 700, // between 600 floor and 819 ratio
        system_total_mb: 16384,
      });
      // 16384 * 5% = 819, > 600 floor → threshold = 819, 700 < 819 → low
      expect(r.system_threshold_mb).toBe(819);
      expect(r.system_memory_ok).toBe(false);
    });

    it('system threshold on 4GB VPS clamps to 600MB floor', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 500,
        system_available_mb: 800,
        system_total_mb: 4096,
      });
      // 4096 * 5% = 204.8, < 600 floor → threshold = 600, 800 > 600 → OK
      expect(r.system_threshold_mb).toBe(600);
      expect(r.system_memory_ok).toBe(true);
    });

    it('system_total_mb omitted falls back to floor', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 500,
        system_available_mb: 2000,
      });
      expect(r.system_threshold_mb).toBe(SYSTEM_AVAILABLE_FLOOR_MB);
      expect(r.system_memory_ok).toBe(true);
    });

    it('exports sensible defaults', () => {
      expect(BRAIN_RSS_DANGER_MB).toBe(1500);
      expect(BRAIN_RSS_WARN_MB).toBe(1000);
      expect(SYSTEM_AVAILABLE_FLOOR_MB).toBe(600);
    });

    it('custom thresholds can override defaults', () => {
      const r = evaluateMemoryHealth({
        brain_rss_mb: 800,
        system_available_mb: 8000,
        system_total_mb: 16384,
        rss_danger_mb: 500,
        rss_warn_mb: 300,
      });
      // Brain RSS 800 > custom danger 500 → halt
      expect(r.action).toBe('halt');
    });

    it('handles undefined/invalid inputs gracefully', () => {
      const r = evaluateMemoryHealth({});
      expect(r.brain_memory_ok).toBe(true);   // brainRss=0
      expect(r.system_memory_ok).toBe(true);  // sysAvail=Infinity
      expect(r.action).toBe('proceed');
    });
  });

  describe('getBrainRssMB', () => {
    it('returns positive integer (this very process has RSS)', () => {
      const rss = getBrainRssMB();
      expect(typeof rss).toBe('number');
      expect(rss).toBeGreaterThan(0);
      expect(Number.isInteger(rss)).toBe(true);
    });
  });
});
