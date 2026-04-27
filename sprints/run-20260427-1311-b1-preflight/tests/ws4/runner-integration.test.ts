import { describe, it, expect, vi } from 'vitest';

const MODULE_PATH = '../../../../packages/brain/src/initiative-runner.js';

async function loadRunInitiative(): Promise<
  (input: { initiativeId: string; deps: any }) => Promise<any>
> {
  const mod = (await import(MODULE_PATH)) as any;
  if (typeof mod.runInitiative !== 'function') {
    throw new Error('runInitiative not exported from initiative-runner.js');
  }
  return mod.runInitiative;
}

function makeDeps(overrides: Partial<any> = {}) {
  const generator = vi.fn().mockResolvedValue(undefined);
  const writeResult = vi.fn().mockResolvedValue(undefined);
  const logger = { error: vi.fn(), info: vi.fn() };
  return {
    generator,
    writeResult,
    logger,
    preflight: vi.fn(),
    ...overrides,
  };
}

describe('Workstream 4 — runner preflight gating [BEHAVIOR]', () => {
  it('does not invoke Generator when preflight returns rejected', async () => {
    const runInitiative = await loadRunInitiative();
    const deps = makeDeps({
      preflight: vi.fn().mockResolvedValue({
        status: 'rejected',
        reasons: ['dag_has_cycle: a->b->a'],
      }),
    });
    await runInitiative({ initiativeId: 'init-1', deps });
    expect(deps.generator).not.toHaveBeenCalled();
  });

  it('invokes Generator exactly once when preflight returns passed', async () => {
    const runInitiative = await loadRunInitiative();
    const deps = makeDeps({
      preflight: vi.fn().mockResolvedValue({ status: 'passed', reasons: [] }),
    });
    await runInitiative({ initiativeId: 'init-1', deps });
    expect(deps.generator).toHaveBeenCalledTimes(1);
  });

  it('does not invoke Generator when preflight throws (fail-close default)', async () => {
    const runInitiative = await loadRunInitiative();
    const deps = makeDeps({
      preflight: vi.fn().mockRejectedValue(new Error('preflight upstream timeout')),
    });
    await runInitiative({ initiativeId: 'init-1', deps });
    expect(deps.generator).not.toHaveBeenCalled();
  });

  it('writes reasons array into task result when preflight rejects', async () => {
    const runInitiative = await loadRunInitiative();
    const reasons = ['dag_has_cycle: a->b->a', 'task_count_exceeded'];
    const deps = makeDeps({
      preflight: vi.fn().mockResolvedValue({ status: 'rejected', reasons }),
    });
    await runInitiative({ initiativeId: 'init-1', deps });
    expect(deps.writeResult).toHaveBeenCalledTimes(1);
    const arg = deps.writeResult.mock.calls[0][0];
    expect(arg.reasons).toEqual(reasons);
  });

  it('logs an error when preflight throws', async () => {
    const runInitiative = await loadRunInitiative();
    const deps = makeDeps({
      preflight: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await runInitiative({ initiativeId: 'init-1', deps });
    expect(deps.logger.error).toHaveBeenCalled();
  });
});
