/**
 * spawn() attempt-loop 测试。
 * 覆盖：
 *   1. success first try
 *   2. transient → success
 *   3. transient × MAX → give up
 *   4. permanent → 不重试
 *   5. 429 transient → spawn 不删 env（换号责任留内层）
 *   6. shouldRetry 返回 false → 提前退
 *   7. MAX_ATTEMPTS 边界（恰好 3 次）
 *   8. SPAWN_V2_ENABLED=false → 跳过所有外层 middleware
 *   9. SPAWN_V2_ENABLED=true → 外层 4 middleware 按 cost-cap → spawn-pre → logging → billing 顺序调用
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteInDocker = vi.fn();
vi.mock('../../docker-executor.js', () => ({
  executeInDocker: (...args) => mockExecuteInDocker(...args),
}));

const mockShouldRetry = vi.fn();
vi.mock('../middleware/retry-circuit.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    shouldRetry: (...args) => mockShouldRetry(...args),
  };
});

// 外层 4 middleware mock — 用 vi.mock 拦截 spawn.js 的 import
const mockCheckCostCap = vi.fn();
vi.mock('../middleware/cost-cap.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    checkCostCap: (...args) => mockCheckCostCap(...args),
  };
});

const mockPrepare = vi.fn();
vi.mock('../middleware/spawn-pre.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    preparePromptAndCidfile: (...args) => mockPrepare(...args),
  };
});

const mockCreateLogger = vi.fn();
vi.mock('../middleware/logging.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createSpawnLogger: (...args) => mockCreateLogger(...args),
  };
});

const mockRecordBilling = vi.fn();
vi.mock('../middleware/billing.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    recordBilling: (...args) => mockRecordBilling(...args),
  };
});

// Helpers
function successResult() {
  return { exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 100, timed_out: false };
}
function transientTimeout() {
  return { exit_code: 124, stdout: '', stderr: 'timeout', duration_ms: 30000, timed_out: true };
}
function permanentOOM() {
  return { exit_code: 137, stdout: '', stderr: 'killed', duration_ms: 500, timed_out: false };
}
function transient429() {
  return { exit_code: 1, stdout: '', stderr: 'api_error_status: 429', duration_ms: 200, timed_out: false };
}

describe('spawn() attempt-loop', () => {
  beforeEach(() => {
    mockExecuteInDocker.mockReset();
    mockShouldRetry.mockReset();
    mockCheckCostCap.mockReset();
    mockPrepare.mockReset();
    mockCreateLogger.mockReset();
    mockRecordBilling.mockReset();
    // 默认 shouldRetry 用真实实现（除 case 6 会覆盖）
    mockShouldRetry.mockImplementation((cls, idx, max = 3) => {
      if (!cls) return false;
      if (cls.class !== 'transient') return false;
      return idx + 1 < max;
    });
    // 默认外层 mock 都 noop，但 mockPrepare/mockCreateLogger 必须返回 valid shape
    mockCheckCostCap.mockResolvedValue(undefined);
    mockPrepare.mockReturnValue({ promptPath: '/tmp/_test.prompt', cidfilePath: '/tmp/_test.cid' });
    mockCreateLogger.mockReturnValue({ logStart: vi.fn(), logEnd: vi.fn() });
    mockRecordBilling.mockResolvedValue({ recorded: false, account: null });
    // 默认 v2 走开（覆盖 entrypoint 可能注入的 SPAWN_V2_ENABLED=false）
    delete process.env.SPAWN_V2_ENABLED;
  });

  it('exports spawn as async function', async () => {
    const { spawn } = await import('../spawn.js');
    expect(typeof spawn).toBe('function');
  });

  it('case 1: success first try — 调 1 次，返回该 result', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker.mockResolvedValueOnce(successResult());
    const result = await spawn({ task: { id: 't1' }, prompt: 'hi' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    expect(result.exit_code).toBe(0);
  });

  it('case 2: transient → success — attempt 0 超时，attempt 1 成功', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker
      .mockResolvedValueOnce(transientTimeout())
      .mockResolvedValueOnce(successResult());
    const result = await spawn({ task: { id: 't2' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(2);
    expect(result.exit_code).toBe(0);
  });

  it('case 3: transient × 3 → give up，返回最后失败 result', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker
      .mockResolvedValueOnce(transientTimeout())
      .mockResolvedValueOnce(transientTimeout())
      .mockResolvedValueOnce(transientTimeout());
    const result = await spawn({ task: { id: 't3' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(3);
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBe(124);
  });

  it('case 4: permanent 不重试 — exit_code 137 立即返回', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker.mockResolvedValueOnce(permanentOOM());
    const result = await spawn({ task: { id: 't4' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    expect(result.exit_code).toBe(137);
  });

  it('case 5: 429 transient — spawn 层不删 opts.env.CECELIA_CREDENTIALS', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker
      .mockResolvedValueOnce(transient429())
      .mockResolvedValueOnce(successResult());
    const opts = {
      task: { id: 't5' },
      prompt: 'x',
      env: { CECELIA_CREDENTIALS: 'account1', OTHER: 'keep' },
    };
    const result = await spawn(opts);
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(2);
    expect(result.exit_code).toBe(0);
    // 核心断言：spawn 层未主动 delete env — 换号责任留给内层 account-rotation
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
    expect(opts.env.OTHER).toBe('keep');
  });

  it('case 6: shouldRetry 返回 false → 提前退循环', async () => {
    const { spawn } = await import('../spawn.js');
    mockShouldRetry.mockReturnValueOnce(false);
    mockExecuteInDocker.mockResolvedValueOnce(transientTimeout());
    const result = await spawn({ task: { id: 't6' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    expect(result.timed_out).toBe(true);
    expect(mockShouldRetry).toHaveBeenCalledTimes(1);
  });

  it('case 7: MAX_ATTEMPTS 边界 — 恰好调用 3 次', async () => {
    const { spawn } = await import('../spawn.js');
    for (let i = 0; i < 5; i++) {
      mockExecuteInDocker.mockResolvedValueOnce(transientTimeout());
    }
    await spawn({ task: { id: 't7' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(3);
  });

  it('case 8: SPAWN_V2_ENABLED=false 时 spawn() 不调用任何外层 middleware', async () => {
    process.env.SPAWN_V2_ENABLED = 'false';
    try {
      const { spawn } = await import('../spawn.js');
      mockExecuteInDocker.mockResolvedValueOnce(successResult());
      const result = await spawn({ task: { id: 't8', task_type: 'planner' }, prompt: 'x' });
      expect(result.exit_code).toBe(0);
      // 关键断言：4 个外层 middleware 一个都不许被调
      expect(mockCheckCostCap).not.toHaveBeenCalled();
      expect(mockPrepare).not.toHaveBeenCalled();
      expect(mockCreateLogger).not.toHaveBeenCalled();
      expect(mockRecordBilling).not.toHaveBeenCalled();
      // 旧 executeInDocker 路径仍走（attempt-loop 还在）
      expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.SPAWN_V2_ENABLED;
    }
  });

  it('case 9: SPAWN_V2_ENABLED=true 时外层 middleware 按声明顺序调用 (cost-cap → spawn-pre → logging → billing)', async () => {
    // 默认 v2 enabled（beforeEach 已 delete env）
    const order = [];
    mockCheckCostCap.mockImplementation(async () => {
      order.push('cost-cap');
    });
    mockPrepare.mockImplementation(() => {
      order.push('spawn-pre');
      return { promptPath: '/tmp/x.prompt', cidfilePath: '/tmp/x.cid' };
    });
    const startSpy = vi.fn(() => order.push('logging-start'));
    const endSpy = vi.fn(() => order.push('logging-end'));
    mockCreateLogger.mockImplementation(() => {
      order.push('logging-create');
      return { logStart: startSpy, logEnd: endSpy };
    });
    mockRecordBilling.mockImplementation(async () => {
      order.push('billing');
      return { recorded: true, account: 'account1' };
    });
    mockExecuteInDocker.mockImplementation(async () => {
      order.push('execute');
      return successResult();
    });

    const { spawn } = await import('../spawn.js');
    await spawn({ task: { id: 't9', task_type: 'planner' }, prompt: 'x' });

    // 关键断言：
    // 1. cost-cap 第一个被调（pre-flight）
    // 2. spawn-pre 在 cost-cap 之后、execute 之前
    // 3. logging-create + logging-start 在 execute 之前
    // 4. logging-end + billing 在 execute 之后
    expect(order).toEqual([
      'cost-cap',
      'spawn-pre',
      'logging-create',
      'logging-start',
      'execute',
      'logging-end',
      'billing',
    ]);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });
});
