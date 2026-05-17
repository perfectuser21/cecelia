/**
 * Tests for CRISIS_KILL_MIN_RSS_MB: Crisis 模式下最小 RSS 阈值保护
 *
 * 回归场景：系统压力 >1.0 时，仅有 RSS=2MB 的刚启动任务运行
 * 期望行为：这些任务被降级为 warn 而非 kill（它们不是内存压力的来源）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const _pidRssMap = new Map();
const _validPids = new Set();

vi.mock('fs', () => ({
  readFileSync: vi.fn((path) => {
    const statmMatch = path.match(/\/proc\/(\d+)\/statm/);
    if (statmMatch) {
      const pid = parseInt(statmMatch[1], 10);
      const rssMb = _pidRssMap.get(pid);
      if (rssMb !== undefined) return `0 ${rssMb * 256} 0 0 0 0 0`;
    }
    const statMatch = path.match(/\/proc\/(\d+)\/stat$/);
    if (statMatch) {
      const pid = parseInt(statMatch[1], 10);
      return `${pid} (node) S ${new Array(40).fill('0').join(' ')}`;
    }
    if (path.endsWith('/info.json')) {
      const match = path.match(/slot-(\d+)\/info\.json$/);
      if (match) {
        const i = parseInt(match[1], 10);
        const pid = 2000 + i;
        return JSON.stringify({
          task_id: `task-min-rss-${i}`,
          pid,
          pgid: pid,
          started: new Date(Date.now() - 120000).toISOString(),
        });
      }
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

vi.mock('child_process', () => ({
  execSync: vi.fn((cmd) => {
    if (cmd === 'getconf PAGE_SIZE') return '4096';
    const psMatch = cmd.match(/ps -o rss=,time= -p (\d+)/);
    if (psMatch) {
      const pid = parseInt(psMatch[1], 10);
      const rssMb = _pidRssMap.get(pid);
      if (rssMb !== undefined) return `${rssMb * 1024}   0:01.00`;
      throw new Error('process not found');
    }
    if (cmd.startsWith('ps -ax')) return '';
    return '';
  }),
}));

vi.mock('os', () => ({
  default: { totalmem: () => 8 * 1024 * 1024 * 1024, platform: () => 'linux' },
  totalmem: () => 8 * 1024 * 1024 * 1024,
  platform: () => 'linux',
}));

import { readdirSync } from 'fs';

const {
  checkRunaways,
  _taskMetrics,
  CRISIS_KILL_MIN_RSS_MB,
} = await import('../watchdog.js');

function setupLowRssTasks(count, rssMb) {
  _taskMetrics.clear();
  _pidRssMap.clear();
  _validPids.clear();

  const slotEntries = [];
  for (let i = 0; i < count; i++) {
    const pid = 2000 + i;
    _pidRssMap.set(pid, rssMb);
    _validPids.add(pid);
    slotEntries.push({ name: `slot-${i}`, isDirectory: () => true });
  }

  readdirSync.mockImplementation((path) => {
    if (path === '/tmp/cecelia-locks') return slotEntries;
    return [];
  });
}

describe('watchdog crisis min RSS threshold (CRISIS_KILL_MIN_RSS_MB)', () => {
  let processKillSpy;
  const origKill = process.kill.bind(process);

  beforeEach(() => {
    _taskMetrics.clear();
    _pidRssMap.clear();
    _validPids.clear();
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 0 && _validPids.has(pid)) return true;
      if (sig === 0) throw new Error('ESRCH');
      return origKill(pid, sig);
    });
  });

  afterEach(() => {
    processKillSpy.mockRestore();
  });

  it('CRISIS_KILL_MIN_RSS_MB 常量应存在且默认值为 20', () => {
    expect(CRISIS_KILL_MIN_RSS_MB).toBe(20);
  });

  it('Crisis 模式: top offender RSS < CRISIS_KILL_MIN_RSS_MB 时全部降级为 warn', () => {
    // 模拟 RSS=2MB 的刚启动任务（历史失败场景）
    setupLowRssTasks(3, 2);
    const result = checkRunaways(1.04);

    const kills = result.actions.filter(a => a.action === 'kill');
    const warns = result.actions.filter(a => a.action === 'warn');

    expect(kills.length).toBe(0);
    expect(warns.length).toBe(3);
  });

  it('Crisis 模式: top offender RSS === CRISIS_KILL_MIN_RSS_MB - 1 时也不 kill', () => {
    setupLowRssTasks(1, CRISIS_KILL_MIN_RSS_MB - 1);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    expect(kills.length).toBe(0);
  });

  it('Crisis 模式: top offender RSS === CRISIS_KILL_MIN_RSS_MB 时正常 kill（边界值）', () => {
    setupLowRssTasks(1, CRISIS_KILL_MIN_RSS_MB);
    const result = checkRunaways(1.0);

    const kills = result.actions.filter(a => a.action === 'kill');
    expect(kills.length).toBe(1);
  });

  it('Crisis 模式: top offender RSS > CRISIS_KILL_MIN_RSS_MB 时正常 kill top 25%', () => {
    // 混合场景：部分任务 RSS 高，部分低
    _taskMetrics.clear();
    _pidRssMap.clear();
    _validPids.clear();

    const slotEntries = [];
    const rssList = [100, 80, 5, 3]; // 前两个超阈值，后两个低于阈值
    for (let i = 0; i < rssList.length; i++) {
      const pid = 2000 + i;
      _pidRssMap.set(pid, rssList[i]);
      _validPids.add(pid);
      slotEntries.push({ name: `slot-${i}`, isDirectory: () => true });
    }
    readdirSync.mockImplementation((path) => {
      if (path === '/tmp/cecelia-locks') return slotEntries;
      return [];
    });

    const result = checkRunaways(1.0);
    const kills = result.actions.filter(a => a.action === 'kill');

    // top offender = 100MB >= 20MB → 应该 kill（top 25% of 4 = 1）
    expect(kills.length).toBe(1);
    expect(kills[0].reason).toContain('100MB');
  });
});
