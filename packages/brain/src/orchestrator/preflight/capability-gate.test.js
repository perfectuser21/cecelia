import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  buildCapabilityEvidence,
  classifyExecutionFailure,
  createCapabilityGate,
  parseCapabilityRequirements,
} from './capability-gate.js';

const preferredTarget = {
  provider: 'codex',
  account: 'team3',
  machine: 'xian-mac-m4',
};
const fallbackTargets = [
  { provider: 'codex', account: 'team5', machine: 'xian-mac-m1' },
  { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
];

function healthyGateDeps() {
  return {
    resolveCanonicalMachineId: vi.fn(async ({ machine }) => machine),
    getMachineHealth: vi.fn(async ({ machine }) => ({ ok: true, machine })),
    getMachineCapacity: vi.fn(async () => ({ ok: true, available: 1 })),
    listProviderAccounts: vi.fn(async () => ['team3', 'team5', 'team1', 'account1']),
    probeProviderAuth: vi.fn(async () => ({ ok: true })),
    probeGitHub: vi.fn(async () => ({ ok: true })),
    probePostgres: vi.fn(async () => ({ ok: true })),
    probeModelCapability: vi.fn(async () => ({ ok: true })),
  };
}

async function evaluateAfterProbeTimeout(gate, input) {
  const result = gate.evaluate(input);
  await vi.advanceTimersByTimeAsync(11);
  return result;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('capability gate stable helpers', () => {
  it('解析冻结 requirements 并递归脱敏结构化 evidence', () => {
    expect(parseCapabilityRequirements({
      contract_requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    })).toEqual({
      provider_auth: true,
      github: true,
      postgres: true,
      model_capabilities: ['structured_output'],
    });

    expect(buildCapabilityEvidence({
      authorization: 'Bearer secret',
      nested: { token: 'secret-token', signature: 'http_503' },
    })).toEqual({
      authorization: '[REDACTED]',
      nested: { token: '[REDACTED]', signature: 'http_503' },
    });
  });

  it('能力匹配后的产品失败进入 generator-fix', () => {
    expect(classifyExecutionFailure({
      capability_matched: true,
      provider_result: { exit_code: 1 },
    })).toMatchObject({
      failure_class: 'product_failure',
      action: 'generator-fix',
      should_enter_generator_fix: true,
    });
  });
});

describe('capability gate deterministic target recovery', () => {
  it('preserves bounded Fleet admission reasons in blocked evidence', async () => {
    const deps = healthyGateDeps();
    deps.getMachineHealth.mockResolvedValue({
      ok: false,
      machine: 'xian-mac-m4',
      signature: 'node_not_base_admitted',
      admission_reasons: ['container_probe_timeout'],
    });
    deps.getMachineCapacity.mockResolvedValue({
      ok: false,
      available: 0,
      signature: 'node_not_base_admitted',
      admission_reasons: ['container_probe_timeout'],
    });
    const gate = createCapabilityGate(deps);

    const result = await gate.evaluate({
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget],
      requirements: {},
      task_bundle: { logical_cycle: 'intent:admission-reason' },
    });

    expect(result).toMatchObject({
      status: 'blocked',
      fallback_reason: 'node_not_base_admitted',
      evidence: {
        probe_detail: {
          machine_health: {
            admission_reasons: ['container_probe_timeout'],
          },
          machine_capacity: {
            admission_reasons: ['container_probe_timeout'],
          },
        },
      },
    });
  });

  it.each(['health', 'capacity'])(
    'non-strict recovery continues to Xi’an M1 when preferred Xi’an M4 %s probe times out',
    async (timedOutProbe) => {
      vi.useFakeTimers();
      const deps = healthyGateDeps();
      if (timedOutProbe === 'health') {
        deps.getMachineHealth.mockImplementation(async ({ machine }) => (
          machine === 'xian-mac-m4'
            ? new Promise(() => {})
            : { ok: true, machine }
        ));
      } else {
        deps.getMachineCapacity.mockImplementation(async ({ machine }) => (
          machine === 'xian-mac-m4'
            ? new Promise(() => {})
            : { ok: true, available: 1 }
        ));
      }
      const gate = createCapabilityGate({ ...deps, probeTimeoutMs: 10 });

      const result = await evaluateAfterProbeTimeout(gate, {
        preferred_target: preferredTarget,
        candidate_targets: [preferredTarget, fallbackTargets[0]],
        failed_targets: [],
        requirements: { provider_auth: true },
        task_bundle: { logical_cycle: `intent:run-timeout:${timedOutProbe}` },
      });

      expect(result).toMatchObject({
        status: 'ok',
        to_target: fallbackTargets[0],
      });
      expect(deps.getMachineHealth).toHaveBeenCalledWith(expect.objectContaining({
        machine: 'xian-mac-m1',
      }));
    },
  );

  it('non-strict recovery continues to Xi’an M1 when preferred provider auth times out', async () => {
    vi.useFakeTimers();
    const deps = healthyGateDeps();
    deps.probeProviderAuth.mockImplementation(async ({ machine }) => (
      machine === 'xian-mac-m4'
        ? new Promise(() => {})
        : { ok: true }
    ));
    const gate = createCapabilityGate({ ...deps, probeTimeoutMs: 10 });

    const result = await evaluateAfterProbeTimeout(gate, {
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget, fallbackTargets[0]],
      failed_targets: [],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-timeout:provider-auth' },
    });

    expect(result).toMatchObject({
      status: 'ok',
      to_target: fallbackTargets[0],
    });
    expect(deps.probeProviderAuth).toHaveBeenCalledWith(expect.objectContaining({
      ...fallbackTargets[0],
    }));
  });

  it('non-strict recovery continues after the preferred transient auth retry times out', async () => {
    vi.useFakeTimers();
    const deps = healthyGateDeps();
    deps.probeProviderAuth.mockImplementation(async ({ machine, recovery_retry: recoveryRetry }) => {
      if (machine !== 'xian-mac-m4') return { ok: true };
      if (recoveryRetry) return new Promise(() => {});
      return { ok: false, transient: true, signature: 'http_503' };
    });
    const gate = createCapabilityGate({ ...deps, probeTimeoutMs: 10 });

    const result = await evaluateAfterProbeTimeout(gate, {
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget, fallbackTargets[0]],
      failed_targets: [],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-timeout:provider-auth-retry' },
    });

    expect(result).toMatchObject({
      status: 'ok',
      to_target: fallbackTargets[0],
    });
    expect(deps.probeProviderAuth).toHaveBeenCalledWith(expect.objectContaining({
      ...fallbackTargets[0],
    }));
  });

  it('strict single-candidate timeout remains blocked and bounded', async () => {
    vi.useFakeTimers();
    const deps = healthyGateDeps();
    deps.getMachineHealth.mockImplementation(async () => new Promise(() => {}));
    const gate = createCapabilityGate({ ...deps, probeTimeoutMs: 10 });

    const result = await evaluateAfterProbeTimeout(gate, {
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget],
      failed_targets: [],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-timeout:strict' },
    });

    expect(result).toMatchObject({
      status: 'blocked',
      failure_class: 'infrastructure_blocked',
      fallback_reason: 'preflight_timeout',
      should_create_attempt: false,
    });
    expect(deps.getMachineHealth).toHaveBeenCalledOnce();
    expect(deps.getMachineCapacity).not.toHaveBeenCalled();
  });

  it('probes the explicit remote tuple rather than replacing it with the Brain machine', async () => {
    const deps = healthyGateDeps();
    deps.resolveCanonicalMachineId.mockResolvedValue('us-mac-m4');
    const gate = createCapabilityGate(deps);

    const result = await gate.evaluate({
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget, ...fallbackTargets],
      failed_targets: [],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-1:6' },
    });

    expect(result).toMatchObject({
      status: 'ok',
      to_target: preferredTarget,
    });
    expect(deps.getMachineHealth).toHaveBeenCalledWith(expect.objectContaining({
      machine: 'xian-mac-m4',
    }));
  });

  it('skips a terminally failed preferred tuple and selects the first supplied fallback', async () => {
    const deps = healthyGateDeps();
    const gate = createCapabilityGate(deps);

    const result = await gate.evaluate({
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget, ...fallbackTargets],
      failed_targets: [preferredTarget],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-1:7' },
    });

    expect(result).toMatchObject({
      status: 'ok',
      to_target: fallbackTargets[0],
    });
    expect(deps.getMachineHealth.mock.calls.map(([input]) => input.machine))
      .toEqual(['xian-mac-m1']);
    expect(deps.probeProviderAuth).toHaveBeenCalledWith(expect.objectContaining({
      ...fallbackTargets[0],
    }));
  });

  it('advances to US M4 when both Xi’an targets are terminally exhausted', async () => {
    const deps = healthyGateDeps();
    const gate = createCapabilityGate(deps);

    const result = await gate.evaluate({
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget, ...fallbackTargets],
      failed_targets: [preferredTarget, fallbackTargets[0]],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-1:8' },
    });

    expect(result).toMatchObject({
      status: 'ok',
      to_target: fallbackTargets[1],
    });
    expect(deps.getMachineHealth.mock.calls.map(([input]) => input.machine))
      .toEqual(['us-mac-m4']);
  });

  it('never invents a cross-vendor candidate from account discovery', async () => {
    const deps = healthyGateDeps();
    const gate = createCapabilityGate(deps);

    await gate.evaluate({
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget, ...fallbackTargets],
      failed_targets: [preferredTarget],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-1:9' },
    });

    expect(deps.listProviderAccounts).not.toHaveBeenCalled();
    expect(deps.probeProviderAuth.mock.calls.map(([input]) => input.provider))
      .toEqual(['codex']);
  });

  it('returns infrastructure_blocked without probing when every supplied tuple is exhausted', async () => {
    const deps = healthyGateDeps();
    const gate = createCapabilityGate(deps);
    const candidates = [preferredTarget, ...fallbackTargets];

    const result = await gate.evaluate({
      preferred_target: preferredTarget,
      candidate_targets: candidates,
      failed_targets: candidates,
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:run-1:10' },
    });

    expect(result).toMatchObject({
      status: 'blocked',
      failure_class: 'infrastructure_blocked',
      fallback_reason: 'all_execution_targets_exhausted',
      should_create_attempt: false,
    });
    expect(deps.resolveCanonicalMachineId).not.toHaveBeenCalled();
    expect(deps.probeProviderAuth).not.toHaveBeenCalled();
  });

  it('preserves final dispatch-readiness failure in the result and alert evidence', async () => {
    const deps = healthyGateDeps();
    deps.getMachineHealth.mockResolvedValue({
      ok: false,
      signature: 'node_not_dispatch_ready',
    });
    deps.emitAlert = vi.fn();
    deps.recordDecision = vi.fn();
    const gate = createCapabilityGate(deps);

    const result = await gate.evaluate({
      preferred_target: preferredTarget,
      candidate_targets: [preferredTarget],
      failed_targets: [],
      requirements: { provider_auth: true },
      task_bundle: { logical_cycle: 'intent:dispatch-not-ready:1' },
    });

    expect(result).toMatchObject({
      status: 'blocked',
      fallback_reason: 'node_not_dispatch_ready',
      evidence: {
        fallback_reason: 'node_not_dispatch_ready',
      },
    });
    expect(deps.emitAlert).toHaveBeenCalledWith(expect.objectContaining({
      evidence: expect.objectContaining({
        fallback_reason: 'node_not_dispatch_ready',
      }),
    }));
    expect(deps.recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      evidence: expect.objectContaining({
        fallback_reason: 'node_not_dispatch_ready',
      }),
    }));
    expect(deps.probeProviderAuth).not.toHaveBeenCalled();
  });
});
