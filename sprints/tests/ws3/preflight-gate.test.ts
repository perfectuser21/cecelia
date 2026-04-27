import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { mockValidate, mockRecord } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
  mockRecord: vi.fn(),
}));

vi.mock('../../../packages/brain/src/preflight.js', () => ({
  validatePreflight: mockValidate,
}));

vi.mock('../../../packages/brain/src/preflight-store.js', () => ({
  recordPreflightResult: mockRecord,
}));

let runPreflightGate: (initiativeId: string) => Promise<{
  advanced: boolean;
  newStatus: string;
  failures?: string[];
}>;

beforeAll(async () => {
  const modPath = '../../../packages/brain/src/initiative-runner.js';
  try {
    const mod = await import(/* @vite-ignore */ modPath);
    runPreflightGate = mod.runPreflightGate;
    if (typeof runPreflightGate !== 'function') {
      throw new Error('runPreflightGate is not exported as a function');
    }
  } catch (loadErr) {
    const err = loadErr;
    runPreflightGate = async () => {
      throw err;
    };
  }
});

describe('Workstream 3 — runPreflightGate [BEHAVIOR]', () => {
  beforeEach(() => {
    mockValidate.mockReset();
    mockRecord.mockReset();
    mockRecord.mockResolvedValue(undefined);
  });

  it('advances state to ready_for_generator when preflight passes', async () => {
    mockValidate.mockResolvedValueOnce({ verdict: 'pass', failures: [] });
    const result = await runPreflightGate('ini-A');
    expect(result.advanced).toBe(true);
    expect(result.newStatus).toBe('ready_for_generator');
  });

  it('keeps state at awaiting_plan when preflight fails', async () => {
    mockValidate.mockResolvedValueOnce({
      verdict: 'fail',
      failures: ['missing_section:成功标准'],
    });
    const result = await runPreflightGate('ini-A');
    expect(result.advanced).toBe(false);
    expect(result.newStatus).toBe('awaiting_plan');
  });

  it('records exactly one preflight_results row per gate invocation regardless of verdict', async () => {
    mockValidate.mockResolvedValueOnce({ verdict: 'pass', failures: [] });
    await runPreflightGate('ini-A');
    expect(mockRecord).toHaveBeenCalledTimes(1);

    mockRecord.mockClear();
    mockValidate.mockResolvedValueOnce({ verdict: 'fail', failures: ['x'] });
    await runPreflightGate('ini-B');
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it('records failures array verbatim from validator into the store on fail', async () => {
    const failures = ['missing_section:目标', 'task_plan_missing'];
    mockValidate.mockResolvedValueOnce({ verdict: 'fail', failures });
    await runPreflightGate('ini-A');
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const arg = mockRecord.mock.calls[0][0];
    expect(arg).toMatchObject({
      initiativeId: 'ini-A',
      verdict: 'fail',
      failures,
    });
  });

  it('throws when initiativeId is missing or empty', async () => {
    mockValidate.mockResolvedValue({ verdict: 'pass', failures: [] });
    await expect(runPreflightGate('')).rejects.toThrow(/initiativeId/i);
    await expect(runPreflightGate(undefined as unknown as string)).rejects.toThrow(/initiativeId/i);
    expect(mockValidate).not.toHaveBeenCalled();
  });
});
