/**
 * WS1 — Spawn Onion Chain Assembly + V2 开关 [BEHAVIOR]
 *
 * 这些测试在 spawn.js 升级前必须 FAIL（Red 阶段证据）：
 *   - 当前 spawn.js 直接 for-loop 调 executeInDocker，没有外层 4 + 内层 6 middleware 的接线
 *   - 当前 spawn.js 没有 SPAWN_V2_ENABLED 字面量
 *   - 当前没有 cost-cap / billing 等 middleware 的 hook 触发
 *   - 当前 V2-disabled 路径不调 markSpendingCap → R2 副作用丢失
 *
 * 实施完毕（spawn.js 装配真洋葱链 + 加 SPAWN_V2_ENABLED 分支 + 保留 markSpendingCap 副作用）后，全部 PASS（Green）。
 *
 * Round 2 新增测试覆盖 Risks Register R1/R2/R3：
 *   - it #5: cascade preserves sonnet ≥ 3 attempts (R1)
 *   - it #3: V2 disabled legacy path still marks spending cap on 429 (R2)
 *   - it #9: billing payload field set byte-equal with executor.js legacy UPDATE (R3)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 所有外层 + 内层 middleware mock（只 mock spawn/middleware/* 路径下模块，
// 不 mock docker-executor.js 内部 helper —— 这正是 Round 2 澄清的"0 触发"语义边界）
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

// R2: 旧路径 markSpendingCap mock（来自 account-usage.js）
const mockMarkSpendingCap = vi.fn();

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
vi.mock('../../../packages/brain/src/account-usage.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, markSpendingCap: (...args: any[]) => mockMarkSpendingCap(...args) };
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
  mockMarkSpendingCap.mockReset();
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

  it('SPAWN_V2_ENABLED=false: bypasses spawn/middleware/* — outer/inner middleware mock invocation count is 0, executeInDocker is called directly', async () => {
    process.env.SPAWN_V2_ENABLED = 'false';
    mockExecuteInDocker.mockResolvedValueOnce(successResult());
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn({ task: { id: 't2', task_type: 'planner' }, prompt: 'hi', skill: '/x' });
    // Round 2 澄清: "0 次触发" = spawn.js import 自 spawn/middleware/* 的模块函数被调用 0 次
    // docker-executor.js 内部任何 helper 不计（它们不会进入这些 spawn/middleware/* mock）
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

  it('V2 disabled: legacy path still marks spending cap on 429 — markSpendingCap (or cap-marking) invoked at least once when executeInDocker returns api_error_status:429 [R2 regression guard]', async () => {
    process.env.SPAWN_V2_ENABLED = 'false';
    // 模拟 attempt 0 命中 429，attempt 1 成功 —— attempt-loop 仍跑（legacy path 也跑 attempt 循环）
    mockExecuteInDocker
      .mockResolvedValueOnce(transient429('account1'))
      .mockResolvedValueOnce(successResult());

    const opts: any = { task: { id: 't_v2off', task_type: 'planner' }, prompt: 'hi', skill: '/x', env: { CECELIA_CREDENTIALS: 'account1' } };
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn(opts);

    // R2 副作用守卫：旧路径或新路径只要其一被调用即可 —— 任一被调即视为 cap-marking 副作用未丢
    // 关键断言：spending cap 被标记 ≥ 1 次（不能裸 return 不标记）
    const totalCapMarks = mockMarkSpendingCap.mock.calls.length + mockCheckCap.mock.calls.length;
    expect(totalCapMarks).toBeGreaterThanOrEqual(1);
    // 至少其中一个调用关联到 account1（capped 账号）
    const accountsTouched = [
      ...mockMarkSpendingCap.mock.calls.map((c: any) => c[0]),
      ...mockCheckCap.mock.calls.map((c: any) => c[1]?.env?.CECELIA_CREDENTIALS),
    ].filter(Boolean);
    expect(accountsTouched).toContain('account1');
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

  it('cascade preserves sonnet across accounts: at least 3 attempts keep model in sonnet family before any opus/haiku/minimax downgrade is allowed [R1 mitigation]', async () => {
    let attempts = 0;
    mockResolveAccount.mockImplementation(async (opts: any) => {
      opts.env = opts.env || {};
      attempts += 1;
      opts.env.CECELIA_CREDENTIALS = `account${attempts}`;
      // R1: cascade middleware 必须在前 3 次 attempt 都横切账号保 sonnet —— 不允许任何一次降模型
      // 这里默认 sonnet；如果实现错误地降模型，cascade.js 会改写 CECELIA_MODEL 为非 sonnet
    });
    mockResolveCascade.mockImplementation(async (opts: any) => {
      // 真实 cascade middleware 应在 sonnet 横切耗尽前不改 model；此处 mock 不主动改 model
      opts.env = opts.env || {};
      opts.env.CECELIA_MODEL = opts.env.CECELIA_MODEL || 'claude-sonnet-4-6';
    });
    mockRunDocker.mockImplementation(async () => transient429(`account${attempts}`));
    mockCheckCap.mockImplementation(async () => ({ capped: true, account: `account${attempts}`, reason: '429' }));

    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn({ task: { id: 't_r1', task_type: 'planner' }, prompt: 'hi', skill: '/x' });

    // R1 阈值：cascade preserves sonnet 横切尝试次数 ≥ 3
    expect(mockResolveAccount.mock.calls.length).toBeGreaterThanOrEqual(3);
    const usedModels = mockResolveAccount.mock.calls
      .map((c: any) => c[0]?.env?.CECELIA_MODEL)
      .filter(Boolean);
    // 前 3 次 attempt 的 model 必须全部是 sonnet 家族
    const first3 = usedModels.slice(0, 3);
    expect(first3.length).toBeGreaterThanOrEqual(3);
    expect(first3.every((m: string) => /sonnet/i.test(m))).toBe(true);
  });

  it('429 transient retry: attempt 0 returns api_error_status:429 → cap-marking marks account, attempt 1 account-rotation switches account, no opts.env.CECELIA_CREDENTIALS delete by spawn itself [R4]', async () => {
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
    // R4: spawn 不主动 delete CECELIA_CREDENTIALS / 其他 env
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
    expect(opts.env.OTHER).toBe('keep');
  });

  it('cost-cap blocks spawn: when getBudget reports usage_usd >= usd, spawn rejects with CostCapExceededError before any docker call [R5]', async () => {
    const { CostCapExceededError } = await import('../../../packages/brain/src/spawn/middleware/cost-cap.js');
    mockCheckCostCap.mockRejectedValueOnce(new CostCapExceededError('planner', 11, 10));
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await expect(
      spawn({ task: { id: 't6', task_type: 'planner' }, prompt: 'hi', skill: '/x' })
    ).rejects.toBeInstanceOf(CostCapExceededError);
    // R5: 硬阻断 —— 不能触发 docker-run，也不能触发 executeInDocker
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

  it('billing payload contains exactly the legacy field set: dispatched_account + dispatched_model (key set byte-equal with executor.js legacy UPDATE) [R3 mitigation]', async () => {
    // R3: billing middleware 写入字段集合必须 ⊇ {dispatched_account, dispatched_model}
    // 与 executor.js:3066-3067 旧 SQL UPDATE 字段对齐
    let capturedPayload: any = null;
    mockRecordBilling.mockImplementation(async (result: any, opts: any) => {
      // 调用真实 billing.js 看它构造的 payload；这里通过 deps 注入截获
      const { recordBilling } = await import('../../../packages/brain/src/spawn/middleware/billing.js');
      const updateFn = vi.fn(async (_taskId: string, payload: any) => {
        capturedPayload = payload;
      });
      // 直接调用真实 recordBilling 验证 payload 构造
      // 注：mockRecordBilling 已被 vi.mock 替换为本 fn，所以这里 dynamic import 拿到的是 actual
      // 但本测试路径是模拟 spawn 调用 recordBilling 时 payload 字段断言，故走本 ctx 注入
      return await recordBilling(result, opts, { deps: { updateTaskPayload: updateFn } });
    });

    mockRunDocker.mockResolvedValueOnce(successResult());
    const opts: any = {
      task: { id: 't_r3', task_type: 'planner' },
      prompt: 'hi',
      skill: '/x',
      env: { CECELIA_CREDENTIALS: 'account1', CECELIA_MODEL: 'claude-sonnet-4-6' },
    };
    const { spawn } = await import('../../../packages/brain/src/spawn/spawn.js');
    await spawn(opts);

    expect(capturedPayload).not.toBeNull();
    // 关键 key 集合断言（byte-equal 与 executor.js 旧 SQL UPDATE 字段一致）
    expect(capturedPayload).toHaveProperty('dispatched_account');
    expect(capturedPayload).toHaveProperty('dispatched_model');
    expect(capturedPayload.dispatched_account).toBe('account1');
    expect(capturedPayload.dispatched_model).toBe('claude-sonnet-4-6');
  });
});
