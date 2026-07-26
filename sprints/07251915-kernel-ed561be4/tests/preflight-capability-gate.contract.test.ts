import { describe, expect, it, vi } from 'vitest';

import {
  buildCapabilityEvidence,
  classifyExecutionFailure,
  createCapabilityGate,
  parseCapabilityRequirements,
} from '../../../packages/brain/src/orchestrator/preflight/capability-gate.js';
import {
  isVerifiedExecutionTarget,
  listVerifiedExecutionTargets,
  resolveExecutionTarget,
} from '../../../packages/brain/src/orchestrator/preflight/execution-targets.js';
import {
  resolveCanonicalMachineId,
} from '../../../packages/brain/src/orchestrator/preflight/canonical-machine-id.js';

const REQUIREMENTS = Object.freeze({
  provider_auth: true,
  github: true,
  postgres: true,
  model_capabilities: ['structured_output'],
});

const TASK_BUNDLE = Object.freeze({
  task_id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  role: 'generator',
  phase: 'generate',
  logical_cycle: 7,
  git_sha: 'abc1234',
  pr_url: 'https://github.com/perfectuser21/cecelia/pull/9999',
});

function healthyProbeDeps(overrides: Record<string, unknown> = {}) {
  return {
    probeProviderAuth: async ({ provider, account }: { provider: string; account: string }) => ({
      ok: true,
      provider,
      account,
    }),
    probeGitHub: async () => ({ ok: true }),
    probePostgres: async () => ({ ok: true }),
    probeModelCapability: async ({ capability }: { capability: string }) => ({ ok: true, capability }),
    resolveCanonicalMachineId: async ({ machine }: { machine: string }) => machine,
    getMachineHealth: async ({ machine }: { machine: string }) => ({ ok: true, machine }),
    getMachineCapacity: async () => ({ ok: true, available: 3 }),
    listProviderAccounts: async ({ provider }: { provider: string }) => (
      provider === 'codex' ? ['team1', 'team2', 'team3', 'team4', 'team5'] : ['account1', 'account2']
    ),
    now: () => 1_000,
    probeTimeoutMs: 50,
    snapshotTtlMs: 500,
    ...overrides,
  };
}

describe('Kernel capability gate contract [BEHAVIOR]', () => {
  it('capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id', async () => {
    const gate = createCapabilityGate(healthyProbeDeps());
    const result = await gate.evaluate({
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: REQUIREMENTS,
      task_bundle: TASK_BUNDLE,
    });

    expect(result.status).toBe('ok');
    expect(result.snapshot).toMatchObject({
      provider: 'codex',
      account: 'team1',
      machine: 'us-mac-m4',
      verified: true,
      health: { ok: true, machine: 'us-mac-m4' },
      capacity: { ok: true, available: 3 },
      capabilities: {
        github: { ok: true },
        postgres: { ok: true },
        model_capabilities: {
          structured_output: { ok: true, capability: 'structured_output' },
        },
      },
      capability_snapshot_id: expect.any(String),
      logical_cycle: 7,
      created_at: 1_000,
      expires_at: 1_500,
    });
  });

  it('capability parsing routing evidence 是 Commander 可消费的稳定导出且不依赖 Commander', async () => {
    expect(typeof parseCapabilityRequirements).toBe('function');
    expect(typeof resolveExecutionTarget).toBe('function');
    expect(typeof buildCapabilityEvidence).toBe('function');

    const requirements = parseCapabilityRequirements({
      contract_requirements: REQUIREMENTS,
      role: TASK_BUNDLE.role,
      phase: TASK_BUNDLE.phase,
      logical_cycle: TASK_BUNDLE.logical_cycle,
    });
    expect(requirements).toEqual(REQUIREMENTS);

    const routed = resolveExecutionTarget({
      preferred_target: { provider: 'codex', account: 'team1', machine: 'xian-mac-m4' },
      candidates: [{ provider: 'codex', account: 'team1', machine: 'xian-mac-m4' }],
      task_bundle: TASK_BUNDLE,
    });
    expect(routed.target).toEqual({
      provider: 'codex',
      account: 'team1',
      machine: 'xian-mac-m4',
    });
    expect(routed.task_bundle).toEqual(TASK_BUNDLE);
    expect(routed).not.toHaveProperty('commander_directive');
    expect(routed).not.toHaveProperty('actor_inbox');
  });

  it('ExecutionTarget 完整矩阵逐项放行且未列组合 fail-closed', () => {
    const machines = ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1'];
    const expected = [
      ...['team1', 'team2', 'team3', 'team4', 'team5'].flatMap((account) => (
        machines.map((machine) => ({ provider: 'codex', account, machine }))
      )),
      { provider: 'claude', account: 'account1', machine: 'us-mac-m4' },
      { provider: 'claude', account: 'account2', machine: 'us-mac-m4' },
      { provider: 'grok', account: 'grok', machine: 'us-mac-m4' },
    ];

    expect(listVerifiedExecutionTargets()).toEqual(expect.arrayContaining(expected));
    expect(listVerifiedExecutionTargets()).toHaveLength(expected.length);
    for (const target of expected) {
      expect(isVerifiedExecutionTarget(target), JSON.stringify(target)).toBe(true);
    }

    for (const target of [
      { provider: 'claude', account: 'account1', machine: 'xian-mac-m4' },
      { provider: 'claude', account: 'account2', machine: 'xian-mac-m1' },
      { provider: 'grok', account: 'grok', machine: 'xian-mac-m4' },
      { provider: 'grok', account: 'grok', machine: 'xian-mac-m1' },
      { provider: 'codex', account: 'team6', machine: 'us-mac-m4' },
      { provider: 'codex', account: 'team1', machine: 'docker-79f7d974a2ce' },
    ]) {
      expect(isVerifiedExecutionTarget(target), JSON.stringify(target)).toBe(false);
    }
  });

  it('team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1', async () => {
    const calls: string[] = [];
    const gate = createCapabilityGate(healthyProbeDeps({
      probeProviderAuth: async ({ provider, account }: { provider: string; account: string }) => {
        calls.push(account);
        if (account === 'team4') {
          return {
            ok: false,
            provider,
            account,
            transient: true,
            signature: 'http_503',
            http_status: 503,
          };
        }
        return { ok: true, provider, account };
      },
    }));

    const result = await gate.evaluate({
      preferred_target: { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
      requirements: REQUIREMENTS,
      task_bundle: TASK_BUNDLE,
    });

    expect(calls).toEqual(['team4', 'team4', 'team1']);
    expect(result).toMatchObject({
      status: 'ok',
      from_target: { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
      to_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      fallback_reason: 'provider_transient_retry_exhausted',
      evidence: {
        capability_snapshot_id: expect.any(String),
        from_target: expect.any(Object),
        to_target: expect.any(Object),
        fallback_reason: 'provider_transient_retry_exhausted',
        failure_class: 'infrastructure_blocked',
      },
    });
  });

  it('CM1 CM4 禁 Claude Grok 且 USM4 Claude Grok 可确定性降级', () => {
    for (const machine of ['xian-mac-m4', 'xian-mac-m1']) {
      const result = resolveExecutionTarget({
        preferred_target: { provider: 'codex', account: 'team1', machine },
        failure_class: 'infrastructure_blocked',
        exhausted_targets: [{ provider: 'codex', account: 'team1', machine }],
        candidates: [
          { provider: 'claude', account: 'account1', machine },
          { provider: 'grok', account: 'grok', machine },
        ],
        task_bundle: TASK_BUNDLE,
      });
      expect(result.status).toBe('blocked');
      expect(result.failure_class).toBe('infrastructure_blocked');
    }

    for (const target of [
      { provider: 'claude', account: 'account1', machine: 'us-mac-m4' },
      { provider: 'claude', account: 'account2', machine: 'us-mac-m4' },
      { provider: 'grok', account: 'grok', machine: 'us-mac-m4' },
    ]) {
      const result = resolveExecutionTarget({
        preferred_target: { provider: 'codex', account: 'team5', machine: 'us-mac-m4' },
        failure_class: 'infrastructure_blocked',
        exhausted_targets: [
          { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
          { provider: 'codex', account: 'team2', machine: 'us-mac-m4' },
          { provider: 'codex', account: 'team3', machine: 'us-mac-m4' },
          { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
          { provider: 'codex', account: 'team5', machine: 'us-mac-m4' },
        ],
        candidates: [target],
        task_bundle: TASK_BUNDLE,
      });
      expect(result.status).toBe('ok');
      expect(result.target).toEqual(target);
      expect(result.fallback_reason).toBe('usm4_cross_vendor_fallback');
    }
  });

  it('Codex 跨机 fresh recovery 保持 task bundle 并从 Git PR DB 真相恢复', () => {
    const result = resolveExecutionTarget({
      preferred_target: { provider: 'codex', account: 'team4', machine: 'xian-mac-m4' },
      failure_class: 'infrastructure_blocked',
      exhausted_targets: [
        { provider: 'codex', account: 'team4', machine: 'xian-mac-m4' },
      ],
      candidates: [
        { provider: 'codex', account: 'team1', machine: 'xian-mac-m1' },
      ],
      task_bundle: TASK_BUNDLE,
    });

    expect(result.status).toBe('ok');
    expect(result.target).toEqual({
      provider: 'codex',
      account: 'team1',
      machine: 'xian-mac-m1',
    });
    expect(result.recovery_mode).toBe('fresh_attempt');
    expect(result.resume_session).toBe(false);
    expect(result.truth_sources).toEqual(['git', 'pr', 'db']);
    expect(result.task_bundle).toMatchObject({
      role: 'generator',
      phase: 'generate',
      logical_cycle: 7,
      task_id: TASK_BUNDLE.task_id,
      run_id: TASK_BUNDLE.run_id,
      git_sha: TASK_BUNDLE.git_sha,
      pr_url: TASK_BUNDLE.pr_url,
    });
  });

  it('全池失败返回人审基础设施阻塞并产出结构化告警与 evidence', async () => {
    const probedAccounts: string[] = [];
    const emitAlert = vi.fn();
    const recordDecision = vi.fn();
    const gate = createCapabilityGate(healthyProbeDeps({
      probeProviderAuth: async ({ account }: { account: string }) => {
        probedAccounts.push(account);
        return {
          ok: false,
          transient: false,
          signature: `auth_failed:${account}`,
        };
      },
      emitAlert,
      recordDecision,
    }));

    const result = await gate.evaluate({
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: REQUIREMENTS,
      task_bundle: TASK_BUNDLE,
    });

    expect(probedAccounts).toEqual(['team1', 'team2', 'team3', 'team4', 'team5']);
    expect(result).toMatchObject({
      status: 'blocked',
      action: 'wait:human_review',
      failure_class: 'infrastructure_blocked',
      should_create_attempt: false,
      should_enter_generator_fix: false,
    });
    expect(result.evidence).toMatchObject({
      capability_snapshot_id: expect.any(String),
      from_target: expect.any(Object),
      to_target: null,
      fallback_reason: 'all_execution_targets_exhausted',
      failure_class: 'infrastructure_blocked',
    });
    expect(emitAlert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'kernel_capability_preflight_blocked',
      action: 'wait:human_review',
      failure_class: 'infrastructure_blocked',
      evidence: expect.objectContaining({
        capability_snapshot_id: expect.any(String),
        fallback_reason: 'all_execution_targets_exhausted',
      }),
    }));
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wait:human_review',
      evidence: {
        capability_snapshot_id: expect.any(String),
        from_target: expect.any(Object),
        to_target: null,
        fallback_reason: 'all_execution_targets_exhausted',
        failure_class: 'infrastructure_blocked',
      },
    }));
  });

  it('能力匹配后的 product failure 仍进入 generator-fix', () => {
    expect(classifyExecutionFailure({
      capability_matched: true,
      provider_result: {
        exit_code: 1,
        failure_class: 'test_assertion_failed',
        evidence: { failed_test: 'dispatcher product behavior' },
      },
    })).toMatchObject({
      failure_class: 'product_failure',
      action: 'generator-fix',
      should_enter_generator_fix: true,
    });
  });

  it('canonical machine 仅接受 env 或受控 Fleet 且忽略 Docker hostname', () => {
    const fleet = [
      { machine_id: 'us-mac-m4', registered: true },
      { machine_id: 'xian-mac-m4', registered: true },
      { machine_id: 'xian-mac-m1', registered: true },
    ];

    expect(resolveCanonicalMachineId({
      envMachineId: 'us-mac-m4',
      fleet,
      hostname: '79f7d974a2ce',
    })).toBe('us-mac-m4');
    expect(resolveCanonicalMachineId({
      fleetMachineId: 'xian-mac-m1',
      fleet,
      hostname: '79f7d974a2ce',
    })).toBe('xian-mac-m1');
    expect(() => resolveCanonicalMachineId({
      envMachineId: 'unknown-host',
      fleet,
      hostname: 'unknown-host',
    })).toThrow(/unknown.*machine|canonical/i);
    expect(() => resolveCanonicalMachineId({
      fleet,
      hostname: '79f7d974a2ce',
    })).toThrow(/missing.*machine|canonical/i);
  });

  it('preflight probe 有界 timeout 且过期 snapshot 竞态不得放行', async () => {
    let now = 1_000;
    const gate = createCapabilityGate(healthyProbeDeps({
      probeGitHub: async () => new Promise(() => {}),
      now: () => now,
      probeTimeoutMs: 20,
      snapshotTtlMs: 50,
    }));

    const startedAt = Date.now();
    const timeoutResult = await gate.evaluate({
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: REQUIREMENTS,
      task_bundle: TASK_BUNDLE,
    });
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(timeoutResult).toMatchObject({
      status: 'blocked',
      failure_class: 'infrastructure_blocked',
      fallback_reason: 'preflight_timeout',
      should_create_attempt: false,
    });

    const raceGate = createCapabilityGate(healthyProbeDeps({
      now: () => now,
      snapshotTtlMs: 50,
    }));
    const fresh = await raceGate.evaluate({
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: REQUIREMENTS,
      task_bundle: TASK_BUNDLE,
    });
    now = fresh.snapshot.expires_at + 1;
    const stale = await raceGate.validateSnapshotForDispatch(fresh.snapshot, TASK_BUNDLE);
    expect(stale).toMatchObject({
      status: 'blocked',
      failure_class: 'infrastructure_blocked',
      fallback_reason: 'capability_snapshot_expired',
      should_create_attempt: false,
    });
  });

  it('结构化 evidence 脱敏凭据并保留路由审计字段', () => {
    const evidence = buildCapabilityEvidence({
      capability_snapshot_id: 'snap-safe',
      from_target: { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
      to_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      fallback_reason: 'provider_transient_retry_exhausted',
      failure_class: 'infrastructure_blocked',
      probe_detail: {
        authorization: 'Bearer secret-authorization',
        token: 'secret-token',
        password: 'secret-password',
        cookie: 'secret-cookie',
        http_status: 503,
        signature: 'http_503',
      },
    });
    const serialized = JSON.stringify(evidence);

    expect(serialized).not.toContain('secret-authorization');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('secret-cookie');
    expect(evidence).toMatchObject({
      capability_snapshot_id: 'snap-safe',
      from_target: expect.any(Object),
      to_target: expect.any(Object),
      fallback_reason: 'provider_transient_retry_exhausted',
      failure_class: 'infrastructure_blocked',
      probe_detail: {
        authorization: '[REDACTED]',
        token: '[REDACTED]',
        password: '[REDACTED]',
        cookie: '[REDACTED]',
        http_status: 503,
        signature: 'http_503',
      },
    });
  });
});
