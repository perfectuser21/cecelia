import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCapabilityGate } from './capability-gate.js';
import { CREDENTIAL_FRESHNESS_REASONS } from './credential-freshness.js';

const claudeTarget = { provider: 'claude', account: 'account1', machine: 'us-mac-m4' };

function gateDeps(overrides = {}) {
  return {
    resolveCanonicalMachineId: vi.fn(async ({ machine }) => machine),
    getMachineHealth: vi.fn(async ({ machine }) => ({ ok: true, machine })),
    getMachineCapacity: vi.fn(async () => ({ ok: true, available: 1 })),
    probeProviderAuth: vi.fn(async () => ({ ok: true })),
    probeGitHub: vi.fn(async () => ({ ok: true })),
    probePostgres: vi.fn(async () => ({ ok: true })),
    probeModelCapability: vi.fn(async () => ({ ok: true })),
    emitAlert: vi.fn(async () => {}),
    recordDecision: vi.fn(async () => {}),
    ...overrides,
  };
}

async function evaluate(gate, { requirements } = {}) {
  return gate.evaluate({
    preferred_target: { ...claudeTarget },
    candidate_targets: [{ ...claudeTarget }],
    failed_targets: [],
    requirements: { provider_auth: true, ...requirements },
    task_bundle: { logical_cycle: 'cycle-1' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('capability gate — credential freshness preflight', () => {
  it('blocks dispatch with infrastructure backoff semantics when the token is expiring soon', async () => {
    const checkCredentialFreshness = vi.fn(() => ({
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON,
      remainingMs: 5 * 60 * 1000,
      account: 'account1',
      provider: 'claude',
      machine: 'us-mac-m4',
    }));
    const deps = gateDeps({ checkCredentialFreshness });
    const gate = createCapabilityGate(deps);

    const result = await evaluate(gate);

    expect(result.status).toBe('blocked');
    expect(result.should_create_attempt).toBe(false);
    expect(result.failure_class).toBe('infrastructure_blocked');
    expect(result.fallback_reason).toBe(CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON);

    // freshness runs BEFORE the (network) provider-auth probe — no provider work is attempted
    expect(checkCredentialFreshness).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude',
      account: 'account1',
    }));
    expect(deps.probeProviderAuth).not.toHaveBeenCalled();
  });

  it('emits an alert naming the account and the reason it is not fresh', async () => {
    const checkCredentialFreshness = vi.fn(() => ({
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON,
      remainingMs: 5 * 60 * 1000,
      account: 'account1',
      provider: 'claude',
      machine: 'us-mac-m4',
      message: 'token expires in 300s',
    }));
    const deps = gateDeps({ checkCredentialFreshness });
    const gate = createCapabilityGate(deps);

    await evaluate(gate);

    expect(deps.emitAlert).toHaveBeenCalledTimes(1);
    const alert = deps.emitAlert.mock.calls[0][0];
    expect(alert.failure_class).toBe('infrastructure_blocked');
    const evidenceJson = JSON.stringify(alert.evidence);
    expect(evidenceJson).toContain('account1');
    expect(evidenceJson).toContain(CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON);
    expect(evidenceJson).toContain('300000'); // remaining_ms surfaced for human triage
  });

  it.each([
    ['file missing', CREDENTIAL_FRESHNESS_REASONS.FILE_MISSING],
    ['parse error', CREDENTIAL_FRESHNESS_REASONS.PARSE_ERROR],
    ['oauth missing', CREDENTIAL_FRESHNESS_REASONS.OAUTH_MISSING],
  ])('blocks and alerts when credentials are unresolvable (%s)', async (_label, reason) => {
    const deps = gateDeps({
      checkCredentialFreshness: vi.fn(() => ({ fresh: false, reason, account: 'account1' })),
    });
    const gate = createCapabilityGate(deps);

    const result = await evaluate(gate);

    expect(result.status).toBe('blocked');
    expect(result.should_create_attempt).toBe(false);
    expect(result.fallback_reason).toBe(reason);
    expect(deps.emitAlert).toHaveBeenCalledTimes(1);
  });

  it('dispatches normally when the token is fresh', async () => {
    const checkCredentialFreshness = vi.fn(() => ({ fresh: true, reason: CREDENTIAL_FRESHNESS_REASONS.FRESH }));
    const deps = gateDeps({ checkCredentialFreshness });
    const gate = createCapabilityGate(deps);

    const result = await evaluate(gate);

    expect(result.status).toBe('ok');
    expect(result.should_create_attempt).toBe(true);
    expect(result.to_target).toMatchObject(claudeTarget);
    expect(deps.emitAlert).not.toHaveBeenCalled();
  });

  it('is a no-op when no freshness checker is injected (backward compatible)', async () => {
    const deps = gateDeps();
    const gate = createCapabilityGate(deps);

    const result = await evaluate(gate);

    expect(result.status).toBe('ok');
    expect(result.should_create_attempt).toBe(true);
  });
});
