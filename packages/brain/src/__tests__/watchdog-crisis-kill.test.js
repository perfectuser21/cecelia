/**
 * Tests for P0 #4: Watchdog Crisis 模式杀 top 25% 而非仅 1 个
 *
 * 通过 mock fs、child_process、process.kill 来隔离 checkRunaways。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Map of pid -> desired RSS in MB (set per test)
const _pidRssMap = new Map();
const _validPids = new Set();

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn((path) => {
    // info.json files
    if (path.endsWith('/info.json')) {
      // Extract slot number from path
      const match = path.match(/slot-(\d+)\/info\.json$/);
      if (match) {
        const i = parseInt(match[1], 10);
        const pid = 1000 + i;
        return JSON.stringify({
          task_id: `task-${i}`,
          pid: pid,
          pgid: pid,
          started: new Date(Date.now() - 120000).toISOString(),
        });
      }
    }
    // Linux /proc paths
    const statmMatch = path.match(/\/proc\/(\d+)\/statm/);
    if (statmMatch) {
      const pid = parseInt(statmMatch[1], 10);
      const rssMb = _pidRssMap.get(pid);
      if (rssMb !== undefined) {
        return `0 ${rssMb * 256} 0 0 0 0 0`;
      }
    }
    const statMatch = path.match(/\/proc\/(\d+)\/stat$/);
    if (statMatch) {
      const pid = parseInt(statMatch[1], 10);
      return `${pid} (node) S ${new Array(40).fill('0').join(' ')}`;
    }
    throw new Error(`ENOENT: ${path}`);
  }),
  readdirSync: vi.fn(() => []),
  existsSync: vi.fn((path) => {
    if (path.endsWith('/info.json')) return true;
    if (path.match(/\/proc\/\d+$/)) {
      const pid = parseInt(path.split('/').pop(), 10);
      return _validPids.has(pid);
    }
    return false;
  }),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd) => {
    if (cmd === 'getconf PAGE_SIZE') return '4096';
    // Darwin: ps -o rss=,time= -p <pid>
    const psMatch = cmd.match(/ps -o rss=,time= -p (\d+)/);
    if (psMatch) {
      const pid = parseInt(psMatch[1], 10);
      const rssMb = _pidRssMap.get(pid);
      if (rssMb !== undefined) {
        return `${rssMb * 1024}   0:01.00`;
      }
      throw new Error('process not found');
    }
    if (cmd.startsWith('ps -ax')) return '';
    return '';
  }),
}));

// Spy on process.kill to handle Darwin isProcessAlive(pid) check
const origKill = process.kill.bind(process);
let processKillSpy;

import { readdirSync } from 'fs';

const {
  checkRunaways,
  _taskMetrics,
  CRISIS_KILL_RATIO,
  CRISIS_KILL_MAX,
} = await import('../watchdog.js');

function setupCrisisTasks(count) {
  _taskMetrics.clear();
  _pidRssMap.clear();
  _validPids.clear();

  const slotEntries = [];
  for (let i = 0; i < count; i++) {
    const pid = 1000 + i;
    const rssMb = 800 - i * 10;
    _pidRssMap.set(pid, rssMb);
    _validPids.add(pid);

    slotEntries.push({
      name: `slot-${i}`,
      isDirectory: () => true,
    });
  }

  readdirSync.mockImplementation((path) => {
    if (path === '/tmp/cecelia-locks') return slotEntries;
    return [];
  });
}

describe('watchdog crisis kill count (P0 #4)', () => {
  beforeEach(() => {
    _taskMetrics.clear();
    _pidRssMap.clear();
    _validPids.clear();

    // Mock process.kill so isProcessAlive returns true for our test PIDs
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 0 && _validPids.has(pid)) return true;
      if (sig === 0) throw new Error('ESRCH');
      return origKill(pid, sig);
    });
  });

  afterEach(() => {
    processKillSpy.mockRestore();
  });

  it('should export CRISIS_KILL_RATIO=0.25 and CRISIS_KILL_MAX=4', () => {
    expect(CRISIS_KILL_RATIO).toBe(0.25);
    expect(CRISIS_KILL_MAX).toBe(4);
  });

  it('should kill 1 out of 4 crisis candidates (25% of 4 = 1)', () => {
    setupCrisisTasks(4);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    const warns = result.actions.filter(a => a.action === 'warn');

    expect(kills.length).toBe(1);
    expect(warns.length).toBe(3);
    expect(kills[0].taskId).toBe('task-0');
  });

  it('should kill 2 out of 8 crisis candidates (25% of 8 = 2)', () => {
    setupCrisisTasks(8);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    const warns = result.actions.filter(a => a.action === 'warn');

    expect(kills.length).toBe(2);
    expect(warns.length).toBe(6);
  });

  it('should kill 4 out of 16 crisis candidates (capped at CRISIS_KILL_MAX)', () => {
    setupCrisisTasks(16);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    const warns = result.actions.filter(a => a.action === 'warn');

    expect(kills.length).toBe(4);
    expect(warns.length).toBe(12);
  });

  it('should cap at CRISIS_KILL_MAX=4 even with 20 candidates', () => {
    setupCrisisTasks(20);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    const warns = result.actions.filter(a => a.action === 'warn');

    expect(kills.length).toBe(4);
    expect(warns.length).toBe(16);
  });

  it('should kill at least 1 with only 1 candidate', () => {
    setupCrisisTasks(1);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    expect(kills.length).toBe(1);
  });

  it('should kill 1 out of 3 candidates (ceil(0.75) = 1)', () => {
    setupCrisisTasks(3);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    const warns = result.actions.filter(a => a.action === 'warn');

    expect(kills.length).toBe(1);
    expect(warns.length).toBe(2);
  });
});
