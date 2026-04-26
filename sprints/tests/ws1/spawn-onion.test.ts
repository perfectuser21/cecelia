/**
 * WS1 — Spawn Onion Chain Assembly + V2 开关 [BEHAVIOR]
 *
 * 这些测试在 spawn.js 升级前必须 FAIL（Red 阶段证据）：
 *   - 当前 spawn.js 直接 for-loop 调 executeInDocker，没有外层 4 + 内层 6 middleware 的接线
 *   - 当前 spawn.js 没有 SPAWN_V2_ENABLED 字面量
 *   - 当前没有 cost-cap / billing 等 middleware 的 hook 触发
 *
 * 实施完毕（spawn.js 装配真洋葱链 + 加 SPAWN_V2_ENABLED 分支）后，全部 PASS（Green）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 所有外层 + 内层 middleware mock
const mockCheckCostCap = vi.fn();
const mockPreparePromptAndCidfile = vi.fn();
const mockLogStart = vi.fn();
const mockLogEnd = vi.fn();
const mockCreateSpawnLogger = vi.fn(() => ({ logStart: mockLogStart, logEnd: mockLogEnd }));
const mockRecordBilling = vi.fn();

const mockResolveAccount = vi.fn();
const mockResolveCascade = vi.fn();
const mockResolveResourceTier = vi.fn();
const mockRunDocker = vi.fn();
const mockCheckCap = vi.fn();
const mockExecuteInDocker = vi.fn();

vi.mock('../../../packages/brain/src/spawn/middleware/cost-cap.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, checkCostCap: (...args: any[]) => mockCheckCostCap(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/spawn-pre.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, preparePromptAndCidfile: (...args: any[]) => mockPreparePromptAndCidfile(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/logging.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, createSpawnLogger: (...args: any[]) => mockCreateSpawnLogger(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/billing.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, recordBilling: (...args: any[]) => mockRecordBilling(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/account-rotation.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, resolveAccount: (...args: any[]) => mockResolveAccount(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/cascade.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, resolveCascade: (...args: any[]) => mockResolveCascade(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/resource-tier.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, resolveResourceTier: (...args: any[]) => mockResolveResourceTier(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/docker-run.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, runDocker: (...args: any[]) => mockRunDocker(...args) };
});
vi.mock('../../../packages/brain/src/spawn/middleware/cap-marking.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, checkCap: (...args: any[]) => mockCheckCap(...args) };
});
vi.mock('../../../packages/brain/src/docker-executor.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, executeInDocker: (...args: any[]) => mockExecuteInDocker(...args) };
});

function successResult() {
  return { exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 100, timed_out: false };
}
function transient429(account = 'account1') {
  return { exit_code: 1, stdout: '', stderr: `api_error_status: 429 [account=${account}]`, duration_ms: 200, timed_out: false };
}
function transientTimeout() {
  return { exit_code: 124, stdout: '', stderr: 'timeout', duration_ms: 30000, timed_out: true };
}

function resetAllMocks() {
  mockCheckCostCap.mockReset();
  mockPreparePromptAndCidfile.mockReset();
  mockLogStart.mockReset();
  mockLogEnd.mockReset();
  mockCreateSpawnLogger.mockReset();
  mockCreateSpawnLogger.mockImplementation(() => ({ logStart: mockLogStart, logEnd: mockLogEnd }));
  mockRecordBilling.mockReset();
  mockResolveAccount.mockReset();
  mockResolveCascade.mockReset();
  mockResolveResourceTier.mockReset();
  mockRunDocker.mockReset();
  mockCheckCap.mockReset();
  mockExecuteInDocker.mockReset();
}

describe('WS1 — Spawn Onion Chain Assembly + V2 开关 [BEHAVIOR]', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetAllMocks();
    vi.resetModules();
    delete process.env.SPAWN_V2_ENABLED;
    mockResolveResourceTier.mockReturnValue({ tier: 'normal', memoryMB: 1024, cpuCores: 1, timeoutMs: 5_400_000 });
    mockCheckCap.mockResolvedValue({ capped: false, account: null, reason: null });
    mockResolveAccount.mockResolvedValue(undefined);
    mockResolveCascade.mockResolvedValue(undefined);
    mockCheckCostCap.mockResolvedValue(undefined);
    mockPreparePromptAndCidfile.mockReturnValue({ promptPath: '/tmp/p', cidfilePath: '/tmp/c' });
    mockRecordBilling.mockResolvedValue({ recorded: true, account: 'account1' });
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('SPAWN_V2_ENABLED unset (default true): runs full onion chain — outer 4 + inner 6 middleware all invoked once on success', async () => {
    mockRunDocker.mockResolvedValueOnce(successResult());
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn({ task: { id: 't1', task_type: 'planner' }, prompt: 'hi', skill: '/x' });
    expect(mockCheckCostCap).toHaveBeenCalledTimes(1);
    expect(mockPreparePromptAndCidfile).toHaveBeenCalledTimes(1);
    expect(mockCreateSpawnLogger).toHaveBeenCalledTimes(1);
    expect(mockLogStart).toHaveBeenCalledTimes(1);
    expect(mockLogEnd).toHaveBeenCalledTimes(1);
    expect(mockRecordBilling).toHaveBeenCalledTimes(1);
    expect(mockResolveAccount).toHaveBeenCalledTimes(1);
    expect(mockResolveCascade).toHaveBeenCalledTimes(1);
    expect(mockResolveResourceTier).toHaveBeenCalledTimes(1);
    expect(mockRunDocker).toHaveBeenCalledTimes(1);
    expect(mockCheckCap).toHaveBeenCalledTimes(1);
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(0);
  });

  it('SPAWN_V2_ENABLED=false: bypasses all middleware, calls executeInDocker directly — outer/inner middleware invocation count is 0', async () => {
    process.env.SPAWN_V2_ENABLED = 'false';
    mockExecuteInDocker.mockResolvedValueOnce(successResult());
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn({ task: { id: 't2', task_type: 'planner' }, prompt: 'hi', skill: '/x' });
    expect(mockCheckCostCap).toHaveBeenCalledTimes(0);
    expect(mockPreparePromptAndCidfile).toHaveBeenCalledTimes(0);
    expect(mockCreateSpawnLogger).toHaveBeenCalledTimes(0);
    expect(mockRecordBilling).toHaveBeenCalledTimes(0);
    expect(mockResolveAccount).toHaveBeenCalledTimes(0);
    expect(mockResolveCascade).toHaveBeenCalledTimes(0);
    expect(mockRunDocker).toHaveBeenCalledTimes(0);
    expect(mockCheckCap).toHaveBeenCalledTimes(0);
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
  });

  it('account capped fallback: account1 marked capped → account-rotation selects account2/3, billing records the actually-used account', async () => {
    mockResolveAccount.mockImplementation(async (opts: any) => {
      opts.env = opts.env || {};
      opts.env.CECELIA_CREDENTIALS = 'account2';
    });
    mockRunDocker.mockResolvedValueOnce(successResult());
    mockRecordBilling.mockImplementation(async (_result: any, opts: any) => ({
      recorded: true,
      account: opts?.env?.CECELIA_CREDENTIALS || null,
    }));
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn({ task: { id: 't3', task_type: 'planner' }, prompt: 'hi', skill: '/x', env: {} });
    expect(mockResolveAccount).toHaveBeenCalled();
    const billingArgs = mockRecordBilling.mock.calls[0];
    expect(billingArgs[1].env.CECELIA_CREDENTIALS).toBe('account2');
  });

  it('cascade preserves sonnet across accounts: account1 sonnet capped does NOT trigger model downgrade — cascade still tries account2/3 sonnet first', async () => {
    let attempts = 0;
    mockResolveAccount.mockImplementation(async (opts: any) => {
      opts.env = opts.env || {};
      opts.env.CECELIA_CREDENTIALS = `account${attempts + 2}`;
      opts.env.CECELIA_MODEL = 'claude-sonnet-4-6';
    });
    mockRunDocker.mockImplementation(async () => {
      attempts++;
      if (attempts < 2) return transient429(`account${attempts}`);
      return successResult();
    });
    mockCheckCap.mockImplementation(async () => ({ capped: true, account: `account${attempts}`, reason: '429' }));
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn({ task: { id: 't4', task_type: 'planner' }, prompt: 'hi', skill: '/x' });
    expect(mockResolveAccount).toHaveBeenCalled();
    expect(mockResolveAccount.mock.calls.length).toBeGreaterThanOrEqual(2);
    const usedModels = mockResolveAccount.mock.calls.map((c: any) => c[0]?.env?.CECELIA_MODEL).filter(Boolean);
    expect(usedModels.length).toBeGreaterThanOrEqual(2);
    expect(usedModels.every((m: string) => /sonnet/.test(m))).toBe(true);
  });

  it('429 transient retry: attempt 0 returns api_error_status:429 → cap-marking marks account, attempt 1 account-rotation switches account, no opts.env.CECELIA_CREDENTIALS delete by spawn itself', async () => {
    mockRunDocker
      .mockResolvedValueOnce(transient429('account1'))
      .mockResolvedValueOnce(successResult());
    mockCheckCap
      .mockResolvedValueOnce({ capped: true, account: 'account1', reason: '429' })
      .mockResolvedValueOnce({ capped: false, account: null, reason: null });

    const opts: any = { task: { id: 't5', task_type: 'planner' }, prompt: 'hi', skill: '/x', env: { CECELIA_CREDENTIALS: 'account1', OTHER: 'keep' } };
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn(opts);

    expect(mockRunDocker).toHaveBeenCalledTimes(2);
    expect(mockCheckCap).toHaveBeenCalledTimes(2);
    expect(mockResolveAccount).toHaveBeenCalledTimes(2);
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
    expect(opts.env.OTHER).toBe('keep');
  });

  it('cost-cap blocks spawn: when getBudget reports usage_usd >= usd, spawn rejects with CostCapExceededError before any docker call', async () => {
    const { CostCapExceededError } = await import('../../../packages/brain/src/spawn/middleware/cost-cap.js');
    mockCheckCostCap.mockRejectedValueOnce(new CostCapExceededError('planner', 11, 10));
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await expect(
      spawn({ task: { id: 't6', task_type: 'planner' }, prompt: 'hi', skill: '/x' })
    ).rejects.toBeInstanceOf(CostCapExceededError);
    expect(mockRunDocker).toHaveBeenCalledTimes(0);
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(0);
  });

  it('SPAWN_V2_ENABLED=true preserves attempt-loop semantics: transient × 3 still gives up after MAX_ATTEMPTS=3', async () => {
    mockRunDocker.mockResolvedValue(transientTimeout());
    mockCheckCap.mockResolvedValue({ capped: false, account: null, reason: null });
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    const result = await spawn({ task: { id: 't7', task_type: 'planner' }, prompt: 'hi', skill: '/x' });
    expect(mockRunDocker).toHaveBeenCalledTimes(3);
    expect(result.exit_code).toBe(124);
    expect(result.timed_out).toBe(true);
  });
});
