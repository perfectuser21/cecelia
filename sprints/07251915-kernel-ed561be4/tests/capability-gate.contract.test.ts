import { describe, expect, it } from 'vitest';

import {
  buildCapabilitySnapshot,
  runCapabilityPreflight,
  routeCapabilityFailure,
  shouldRetryCapabilitySignature,
  assertNoContractInheritanceOrTelemetrySchemaDrift,
} from '../../../packages/brain/src/orchestrator/capability-gate.js';

describe('Kernel capability gate contract [BEHAVIOR]', () => {
  it('server-owned capability snapshot 覆盖 provider/GitHub/PostgreSQL/model，并复用既有账本', async () => {
    const snapshot = await buildCapabilitySnapshot({
      contractRequirements: {
        provider_auth: true,
        github: true,
        postgresql_test_dependency: true,
        external_model: ['structured_output'],
      },
      roleAssignment: { provider: 'codex', account: 'team1' },
    });

    expect(snapshot.server_owned).toBe(true);
    expect(snapshot.capabilities.provider_auth.status).toBe('ok');
    expect(snapshot.capabilities.github.status).toBe('ok');
    expect(snapshot.capabilities.postgresql_test_dependency.status).toBe('ok');
    expect(snapshot.capabilities.external_model.status).toBe('ok');
    expect(snapshot.persistence.kind).toBe('existing_json_ledger');
  });

  it('createAttempt 前阻断 provider_auth/GitHub/PostgreSQL/model capability 缺失并返回 infrastructure_blocked', async () => {
    const result = await runCapabilityPreflight({
      requiredCapabilities: ['provider_auth', 'github', 'postgresql_test_dependency', 'external_model'],
      probes: {
        provider_auth: async () => ({ status: 'missing', signature: 'provider_auth:codex:team1' }),
        github: async () => ({ status: 'ok' }),
        postgresql_test_dependency: async () => ({ status: 'ok' }),
        external_model: async () => ({ status: 'ok' }),
      },
      createAttempt: async () => {
        throw new Error('createAttempt must not run before preflight passes');
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.failure_class).toBe('infrastructure_blocked');
    expect(result.attempt_created).toBe(false);
  });

  it('capability mismatch 路由人审和告警，不进入 generator-fix', () => {
    const routed = routeCapabilityFailure({
      failure_class: 'contract_capability_mismatch',
      missing: ['postgresql_test_dependency'],
      currentRoute: 'spawn:generator-fix',
    });

    expect(routed.action).toBe('wait:human_review');
    expect(routed.alert).toBe(true);
    expect(routed.action).not.toBe('spawn:generator-fix');
  });

  it('product failure 保持 generator-fix 路由', () => {
    const routed = routeCapabilityFailure({
      failure_class: 'product_failure',
      missing: [],
      currentRoute: 'spawn:generator-fix',
    });

    expect(routed.action).toBe('spawn:generator-fix');
    expect(routed.alert).toBe(false);
  });

  it('同签名网络瞬断重试受收敛闸约束', () => {
    expect(shouldRetryCapabilitySignature({
      failure_class: 'transient_network',
      signature: 'github:timeout:team1',
      failureCount: 1,
      cap: 2,
    })).toBe(true);

    expect(shouldRetryCapabilitySignature({
      failure_class: 'transient_network',
      signature: 'github:timeout:team1',
      failureCount: 2,
      cap: 2,
    })).toBe(false);
  });

  it('不修改 contract 继承和 telemetry schema', () => {
    const guard = assertNoContractInheritanceOrTelemetrySchemaDrift({
      touchedFiles: [
        'packages/brain/src/orchestrator/capability-gate.js',
        'packages/brain/src/orchestrator/dispatcher.js',
        'packages/brain/src/orchestrator/derive.js',
      ],
    });

    expect(guard.contractInheritanceChanged).toBe(false);
    expect(guard.telemetrySchemaChanged).toBe(false);
  });
});
