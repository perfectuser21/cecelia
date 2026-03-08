/**
 * Tests for platform-utils.js
 * Validates platform abstraction layer functions work on the current platform.
 */

import { describe, it, expect } from 'vitest';
import {
  IS_DARWIN,
  IS_LINUX,
  parseEtime,
  listProcessesWithElapsed,
  listProcessesWithPpid,
  countClaudeProcesses,
  sampleCpuUsage,
  _resetCpuSampler,
  getSwapUsedPct,
  getDmesgInfo,
  readCmdline,
  readProcessCwd,
  readProcessEnv,
  processExists,
  getTopCpuUsage,
  getNetworkStats,
  calculatePhysicalCapacity,
  SYSTEM_RESERVED_MB,
  MAX_PHYSICAL_CAP,
} from '../platform-utils.js';

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
      // 16GB Mac mini: (16384 - 5000) * 0.8 / 350 = ~26, capped to 10
      // CPU: 10 * 0.8 / 0.5 = 16
      // min(26, 16) = 16, capped to 10
      const result = calculatePhysicalCapacity(16384, 10, 350, 0.5);
      expect(result).toBe(10);
    });

    it('should give reasonable value for Mac mini 16GB 10-core', () => {
      const result = calculatePhysicalCapacity(16384, 10, 350, 0.5);
      expect(result).toBeLessThanOrEqual(10);
      expect(result).toBeGreaterThanOrEqual(2);
    });
  });
});
