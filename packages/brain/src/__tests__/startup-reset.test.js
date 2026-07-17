/**
 * startup-reset.js 单元测试
 *
 * BEHAVIOR-1: runProcessZero — 检测并清理 exited docker 容器与 stale tmux session
 * BEHAVIOR-2: runProcessZero — docker ps 失败时 fail-open，返回 ok:false 不抛出
 * BEHAVIOR-3: runWechatUnify — ROG_HOST 未配置时跳过，返回 skipped:true
 * BEHAVIOR-4: runWechatUnify — ROG SSH 不可达时 fail-open，返回 ok:false 不抛出
 * BEHAVIOR-5: runWechatUnify — ROG 上存在多余 wechat 进程时终止并报告
 * BEHAVIOR-6: runEnvCheck — docker+git 均可用时返回 ok:true
 * BEHAVIOR-7: runEnvCheck — docker 不可用时返回 ok:false 但不抛出
 * BEHAVIOR-8: runResidueCleanup — 清理过期 /tmp/cecelia-* 文件，返回 removed 计数
 * BEHAVIOR-9: runResidueCleanup — readdirSync 失败时 fail-open，返回 removed:0
 * BEHAVIOR-10: reportStartupChecklist — console.log 输出 startup-reset 标签 JSON
 * BEHAVIOR-11: reportStartupChecklist — pool 存在时写入 working_memory（upsert）
 * BEHAVIOR-12: runStartupReset — 全流程串行执行五步，返回 checklist 对象
 * BEHAVIOR-13: runStartupReset — 任一步失败不阻断后续步骤，全部步骤均执行
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock child_process ──────────────────────────────────────────────────────
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({ execSync: mockExecSync }));

// ── mock fs ─────────────────────────────────────────────────────────────────
const mockReaddir = vi.fn();
const mockStat = vi.fn();
const mockUnlink = vi.fn();
vi.mock('fs', () => ({
  readdirSync: mockReaddir,
  statSync: mockStat,
  unlinkSync: mockUnlink,
  existsSync: vi.fn().mockReturnValue(false),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function freshImport() {
  vi.resetModules();
  return import('../startup-reset.js');
}

// ── S1: 进程归零 ─────────────────────────────────────────────────────────────
describe('BEHAVIOR-1: runProcessZero — 清理 exited 容器与 stale tmux', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns ok:true and reports containers_removed', async () => {
    // docker ps -a exited cecelia containers
    mockExecSync
      .mockReturnValueOnce('cecelia-task-abc\ncecelia-task-def\n') // docker ps exited
      .mockReturnValueOnce('')  // docker rm
      .mockReturnValueOnce('cecelia-stale-0\n'); // tmux dead sessions

    const { runProcessZero } = await freshImport();
    const result = await runProcessZero({ execFn: mockExecSync });

    expect(result.ok).toBe(true);
    expect(result.step).toBe('process_zero');
    expect(typeof result.containers_removed).toBe('number');
  });
});

describe('BEHAVIOR-2: runProcessZero — docker ps 失败时 fail-open', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns ok:false but does not throw', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('docker daemon not running'); });

    const { runProcessZero } = await freshImport();
    const result = await runProcessZero({ execFn: mockExecSync });

    expect(result.ok).toBe(false);
    expect(result.step).toBe('process_zero');
    expect(result.error).toBeDefined();
  });
});

// ── S2: 微信归一 ─────────────────────────────────────────────────────────────
describe('BEHAVIOR-3: runWechatUnify — ROG_HOST 未配置时跳过', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns skipped:true when ROG_HOST is not set', async () => {
    const originalEnv = process.env.CECELIA_ROG_HOST;
    delete process.env.CECELIA_ROG_HOST;

    const { runWechatUnify } = await freshImport();
    const result = await runWechatUnify({ execFn: mockExecSync });

    expect(result.skipped).toBe(true);
    expect(result.step).toBe('wechat_unify');

    if (originalEnv !== undefined) process.env.CECELIA_ROG_HOST = originalEnv;
  });
});

describe('BEHAVIOR-4: runWechatUnify — ROG SSH 不可达时 fail-open', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns ok:false and does not throw', async () => {
    process.env.CECELIA_ROG_HOST = 'rog';
    mockExecSync.mockImplementation(() => { throw new Error('ssh: connect to host rog port 22: No route to host'); });

    const { runWechatUnify } = await freshImport();
    const result = await runWechatUnify({ execFn: mockExecSync });

    expect(result.step).toBe('wechat_unify');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();

    delete process.env.CECELIA_ROG_HOST;
  });
});

describe('BEHAVIOR-5: runWechatUnify — 多余 wechat 进程被终止', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('kills extra processes and reports killed_count', async () => {
    process.env.CECELIA_ROG_HOST = 'rog';
    // First call: pgrep returns 3 pids (>1), second call: kill
    mockExecSync
      .mockReturnValueOnce('1001\n1002\n1003\n') // pgrep wechat_rpa
      .mockReturnValueOnce('');                   // kill 1002 1003

    const { runWechatUnify } = await freshImport();
    const result = await runWechatUnify({ execFn: mockExecSync });

    expect(result.step).toBe('wechat_unify');
    expect(result.ok).toBe(true);
    expect(result.killed_count).toBe(2);

    delete process.env.CECELIA_ROG_HOST;
  });
});

// ── S3: 环境自检 ─────────────────────────────────────────────────────────────
describe('BEHAVIOR-6: runEnvCheck — docker+git 均可用', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns ok:true with details', async () => {
    mockExecSync
      .mockReturnValueOnce('Docker version 24.0.0')  // docker --version
      .mockReturnValueOnce('git version 2.40.0');    // git --version

    const { runEnvCheck } = await freshImport();
    const result = await runEnvCheck({ execFn: mockExecSync });

    expect(result.ok).toBe(true);
    expect(result.step).toBe('env_check');
    expect(result.docker).toBe(true);
    expect(result.git).toBe(true);
  });
});

describe('BEHAVIOR-7: runEnvCheck — docker 不可用时 ok:false 但不抛出', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns ok:false with docker:false', async () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('docker: command not found'); })
      .mockReturnValueOnce('git version 2.40.0');

    const { runEnvCheck } = await freshImport();
    const result = await runEnvCheck({ execFn: mockExecSync });

    expect(result.ok).toBe(false);
    expect(result.step).toBe('env_check');
    expect(result.docker).toBe(false);
    expect(result.git).toBe(true);
  });
});

// ── S4: 残骸清理 ─────────────────────────────────────────────────────────────
describe('BEHAVIOR-8: runResidueCleanup — 清理过期 /tmp/cecelia-* 文件', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('removes stale files and returns removed count', async () => {
    const NOW = 1000000000000;
    const STALE_MS = 7 * 3600 * 1000; // older than TTL
    mockReaddir.mockReturnValue(['cecelia-tmp-abc.json', 'cecelia-tmp-def.lock', 'unrelated.txt']);
    mockStat
      .mockReturnValueOnce({ mtimeMs: NOW - STALE_MS - 1 }) // stale
      .mockReturnValueOnce({ mtimeMs: NOW - STALE_MS - 1 }) // stale
      .mockReturnValueOnce({ mtimeMs: NOW - 1000 });         // fresh (unrelated, but we skip by name)

    const { runResidueCleanup } = await freshImport();
    const result = await runResidueCleanup({ tmpDir: '/tmp', ttlMs: 6 * 3600 * 1000, nowMs: NOW });

    expect(result.ok).toBe(true);
    expect(result.step).toBe('residue_cleanup');
    expect(result.removed).toBeGreaterThanOrEqual(2);
  });
});

describe('BEHAVIOR-9: runResidueCleanup — readdirSync 失败时 fail-open', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns ok:false removed:0 without throwing', async () => {
    mockReaddir.mockImplementation(() => { throw new Error('EACCES: permission denied'); });

    const { runResidueCleanup } = await freshImport();
    const result = await runResidueCleanup({ tmpDir: '/tmp', ttlMs: 6 * 3600 * 1000 });

    expect(result.ok).toBe(false);
    expect(result.step).toBe('residue_cleanup');
    expect(result.removed).toBe(0);
  });
});

// ── S5: checklist 上报 ───────────────────────────────────────────────────────
describe('BEHAVIOR-10: reportStartupChecklist — console.log 输出 startup-reset JSON', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('calls console.log with startup-reset label', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { reportStartupChecklist } = await freshImport();
    const steps = [
      { step: 'process_zero', ok: true },
      { step: 'wechat_unify', skipped: true },
      { step: 'env_check', ok: true },
      { step: 'residue_cleanup', ok: true, removed: 3 },
    ];
    await reportStartupChecklist(steps, null);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[startup-reset]'),
      expect.anything(),
    );
    logSpy.mockRestore();
  });
});

describe('BEHAVIOR-11: reportStartupChecklist — pool 存在时写入 working_memory', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('calls pool.query with upsert into working_memory', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { reportStartupChecklist } = await freshImport();
    const steps = [{ step: 'process_zero', ok: true }];
    await reportStartupChecklist(steps, mockPool);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('working_memory'),
      expect.arrayContaining([
        expect.stringContaining('startup-reset'),
        expect.any(String),
      ])
    );
    logSpy.mockRestore();
  });
});

// ── S0: 全流程 ────────────────────────────────────────────────────────────────
describe('BEHAVIOR-12: runStartupReset — 全流程五步均执行，返回 checklist', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns checklist with all step results', async () => {
    mockExecSync.mockReturnValue('');
    mockReaddir.mockReturnValue([]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runStartupReset } = await freshImport();
    const result = await runStartupReset({ pool: null });

    expect(result).toHaveProperty('steps');
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(4);

    const stepNames = result.steps.map(s => s.step);
    expect(stepNames).toContain('process_zero');
    expect(stepNames).toContain('wechat_unify');
    expect(stepNames).toContain('env_check');
    expect(stepNames).toContain('residue_cleanup');
    logSpy.mockRestore();
  });
});

describe('BEHAVIOR-13: runStartupReset — 任一步失败不阻断后续', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('all 4 steps appear in result even when process_zero throws', async () => {
    // First call throws (docker), subsequent calls succeed
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('docker daemon not running'); })
      .mockReturnValue('');
    mockReaddir.mockReturnValue([]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runStartupReset } = await freshImport();
    const result = await runStartupReset({ pool: null });

    const stepNames = result.steps.map(s => s.step);
    expect(stepNames).toContain('process_zero');
    expect(stepNames).toContain('env_check');
    expect(stepNames).toContain('residue_cleanup');
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
