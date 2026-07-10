/**
 * executor-contracts.test.js
 * TDD: 合同矩阵(五kind×三态) + unknown fail-open + assessTaskLiveness 入口
 *
 * 每个 probe 返回 'alive'|'dead'|'unknown'
 * unknown 一律 fail-open（不杀 + console.warn + cecelia_events）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pool for cecelia_events writes
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock child_process for brain-local probe
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

describe('EXECUTOR_CONTRACTS — 五合同结构', () => {
  let EXECUTOR_CONTRACTS;

  beforeEach(async () => {
    vi.resetModules();
    ({ EXECUTOR_CONTRACTS } = await import('../executor-contracts.js'));
  });

  it('包含五个 executor_kind 键', () => {
    const kinds = Object.keys(EXECUTOR_CONTRACTS);
    expect(kinds).toContain('brain-local');
    expect(kinds).toContain('relay-container');
    expect(kinds).toContain('headed-session');
    expect(kinds).toContain('bridge');
    expect(kinds).toContain('external-worker');
    expect(kinds).toHaveLength(5);
  });

  it.each([
    ['brain-local',     60,   'fail'],
    ['relay-container', null, 'reignite'],
    ['headed-session',  120,  'release-claim-and-alert'],
    ['bridge',          60,   'requeue'],
    ['external-worker', null, 'never'],
  ])('%s: staleMinutes=%s onStale=%s', (kind, staleMinutes, onStale) => {
    const contract = EXECUTOR_CONTRACTS[kind];
    expect(contract.staleMinutes).toBe(staleMinutes);
    expect(contract.onStale).toBe(onStale);
    expect(typeof contract.probe).toBe('function');
  });
});

describe('probe 返回值约束 — 每种 kind × alive/dead/unknown', () => {
  let EXECUTOR_CONTRACTS;

  beforeEach(async () => {
    vi.resetModules();
    ({ EXECUTOR_CONTRACTS } = await import('../executor-contracts.js'));
  });

  describe('external-worker — 永远 alive', () => {
    it('probe() 返回 alive', async () => {
      const task = { id: 'task-1', task_type: 'content-pipeline' };
      const result = await EXECUTOR_CONTRACTS['external-worker'].probe(task, {});
      expect(result).toBe('alive');
    });
  });

  describe('brain-local — 基于进程存活', () => {
    it('进程存活时返回 alive', async () => {
      const { execSync } = await import('child_process');
      execSync.mockImplementation(() => {}); // kill -0 成功 = 进程存活
      const task = { id: 'task-1', payload: { pid: 12345 } };
      const result = await EXECUTOR_CONTRACTS['brain-local'].probe(task, {});
      expect(result).toBe('alive');
    });

    it('进程不存在时返回 dead', async () => {
      const { execSync } = await import('child_process');
      execSync.mockImplementation(() => { throw new Error('kill -0 failed'); });
      const task = { id: 'task-1', payload: { pid: 99999 } };
      const result = await EXECUTOR_CONTRACTS['brain-local'].probe(task, {});
      expect(result).toBe('dead');
    });

    it('无 pid 时返回 unknown', async () => {
      const task = { id: 'task-1', payload: {} };
      const result = await EXECUTOR_CONTRACTS['brain-local'].probe(task, {});
      expect(result).toBe('unknown');
    });
  });

  describe('bridge — 基于 execution_attempts 或回调信号', () => {
    it('有最近 execution_attempts 记录时返回 alive', async () => {
      const task = { id: 'task-1', last_attempt_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() };
      const result = await EXECUTOR_CONTRACTS['bridge'].probe(task, {});
      expect(result).toBe('alive');
    });

    it('last_attempt_at 超过 staleMinutes 时返回 dead', async () => {
      const task = { id: 'task-1', last_attempt_at: new Date(Date.now() - 70 * 60 * 1000).toISOString() };
      const result = await EXECUTOR_CONTRACTS['bridge'].probe(task, {});
      expect(result).toBe('dead');
    });

    it('无 last_attempt_at 时返回 unknown', async () => {
      const task = { id: 'task-1' };
      const result = await EXECUTOR_CONTRACTS['bridge'].probe(task, {});
      expect(result).toBe('unknown');
    });
  });

  describe('headed-session — 基于 claimed_by 进程存活', () => {
    it('无 claimed_by 时返回 unknown', async () => {
      const task = { id: 'task-1', claimed_by: null };
      const result = await EXECUTOR_CONTRACTS['headed-session'].probe(task, {});
      expect(result).toBe('unknown');
    });

    it('有 claimed_by 返回 unknown（无法从 brain 内探测外部进程）', async () => {
      const task = { id: 'task-1', claimed_by: 'session:abc123' };
      const result = await EXECUTOR_CONTRACTS['headed-session'].probe(task, {});
      // headed-session probe 从 brain 内无法可靠探测外部 claude session → unknown
      expect(result).toBe('unknown');
    });
  });

  describe('relay-container — 基于 docker ps', () => {
    it('容器存活时返回 alive', async () => {
      const { execSync } = await import('child_process');
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('docker ps')) return 'cecelia-relay-abcd1234\n';
        return '';
      });
      const task = { id: 'abcd1234-1111-1111-1111-111111111111' };
      const result = await EXECUTOR_CONTRACTS['relay-container'].probe(task, {});
      expect(result).toBe('alive');
    });

    it('容器不存在时返回 dead', async () => {
      const { execSync } = await import('child_process');
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('docker ps')) return '';
        return '';
      });
      const task = { id: 'abcd1234-1111-1111-1111-111111111111' };
      const result = await EXECUTOR_CONTRACTS['relay-container'].probe(task, {});
      expect(result).toBe('dead');
    });

    it('docker 不可用时返回 unknown', async () => {
      const { execSync } = await import('child_process');
      execSync.mockImplementation(() => { throw new Error('docker: command not found'); });
      const task = { id: 'abcd1234-1111-1111-1111-111111111111' };
      const result = await EXECUTOR_CONTRACTS['relay-container'].probe(task, {});
      expect(result).toBe('unknown');
    });
  });
});

describe('assessTaskLiveness — 唯一入口', () => {
  let assessTaskLiveness;
  let warnSpy;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockResolvedValue({ rows: [] });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ({ assessTaskLiveness } = await import('../executor-contracts.js'));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('executor_kind=null → unknown → fail-open (not fail)', async () => {
    const task = { id: 'task-null', executor_kind: null, updated_at: new Date().toISOString() };
    const result = await assessTaskLiveness(task, {});
    expect(result.liveness).toBe('unknown');
    expect(result.action).not.toBe('fail');
    expect(result.action).toBe('fail-open');
  });

  it('external-worker → alive → 不杀', async () => {
    const task = { id: 'task-ext', executor_kind: 'external-worker', updated_at: new Date().toISOString() };
    const result = await assessTaskLiveness(task, {});
    expect(result.liveness).toBe('alive');
    expect(result.action).toBe('keep');
  });

  it('brain-local + dead → action=fail', async () => {
    const { execSync } = await import('child_process');
    execSync.mockImplementation(() => { throw new Error('no process'); });
    const task = { id: 'task-bl', executor_kind: 'brain-local', payload: { pid: 99999 }, updated_at: new Date().toISOString() };
    const result = await assessTaskLiveness(task, {});
    expect(result.liveness).toBe('dead');
    expect(result.action).toBe('fail');
  });

  it('unknown probe → fail-open + console.warn + cecelia_events INSERT', async () => {
    const task = { id: 'task-unk', executor_kind: 'brain-local', payload: {}, updated_at: new Date().toISOString() };
    const result = await assessTaskLiveness(task, {});
    expect(result.liveness).toBe('unknown');
    expect(result.action).toBe('fail-open');
    // console.warn 被调用
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    // cecelia_events INSERT 被调用
    const eventInserts = mockQuery.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('cecelia_events')
    );
    expect(eventInserts.length).toBeGreaterThan(0);
  });

  it('headed-session + unknown → action=fail-open (绝不 fail)', async () => {
    const task = { id: 'task-hs', executor_kind: 'headed-session', claimed_by: null, updated_at: new Date().toISOString() };
    const result = await assessTaskLiveness(task, {});
    expect(result.liveness).toBe('unknown');
    expect(result.action).toBe('fail-open');
    expect(result.action).not.toBe('fail');
  });
});
