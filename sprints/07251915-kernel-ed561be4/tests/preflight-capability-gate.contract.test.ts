import { describe, expect, it } from 'vitest';

import {
  createCapabilityGate,
} from '../../../packages/brain/src/orchestrator/preflight/capability-gate.js';

describe('Kernel capability gate contract [BEHAVIOR]', () => {
  it('capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id', async () => {
    const gate = createCapabilityGate({
      probeProviderAuth: async () => ({ ok: true, provider: 'codex', account: 'team1' }),
      probeGitHub: async () => ({ ok: true }),
      probePostgres: async () => ({ ok: true }),
      probeModelCapability: async () => ({ ok: true, capability: 'structured_output' }),
      resolveCanonicalMachineId: async () => 'us-mac-m4',
      getMachineHealth: async () => ({ ok: true, machine: 'us-mac-m4' }),
      getMachineCapacity: async () => ({ ok: true, available: 3 }),
    });

    const result = await gate.evaluate({
      logical_cycle: 7,
      role: 'generator',
      phase: 'generate',
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    });

    expect(result.status).toBe('ok');
    expect(Object.keys(result.snapshot).sort()).toEqual([
      'account',
      'capabilities',
      'capacity',
      'capability_snapshot_id',
      'health',
      'logical_cycle',
      'machine',
      'provider',
      'verified',
    ]);
    expect(result.snapshot.machine).toBe('us-mac-m4');
    expect(result.snapshot.capabilities.github.ok).toBe(true);
    expect(result.snapshot.capabilities.postgres.ok).toBe(true);
  });

  it('team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1', async () => {
    const calls: string[] = [];
    const gate = createCapabilityGate({
      probeProviderAuth: async ({ account }: { account: string }) => {
        calls.push(account);
        if (account === 'team4') {
          return {
            ok: false,
            transient: true,
            signature: 'http_503',
            http_status: 503,
          };
        }
        return { ok: true, provider: 'codex', account };
      },
      probeGitHub: async () => ({ ok: true }),
      probePostgres: async () => ({ ok: true }),
      probeModelCapability: async () => ({ ok: true, capability: 'structured_output' }),
      resolveCanonicalMachineId: async () => 'us-mac-m4',
      getMachineHealth: async () => ({ ok: true, machine: 'us-mac-m4' }),
      getMachineCapacity: async () => ({ ok: true, available: 3 }),
      listProviderAccounts: async () => ['team4', 'team1', 'team2'],
    });

    const result = await gate.evaluate({
      logical_cycle: 11,
      role: 'generator',
      phase: 'generate',
      preferred_target: { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    });

    expect(calls).toEqual(['team4', 'team4', 'team1']);
    expect(result.status).toBe('ok');
    expect(result.from_target.account).toBe('team4');
    expect(result.to_target.account).toBe('team1');
    expect(result.fallback_reason).toBe('provider_transient_retry_exhausted');
  });

  it('全池失败或 contract capability mismatch 返回 infrastructure_blocked 且不创建 attempt', async () => {
    const gate = createCapabilityGate({
      probeProviderAuth: async () => ({ ok: false, transient: false, signature: 'auth_failed' }),
      probeGitHub: async () => ({ ok: true }),
      probePostgres: async () => ({ ok: false, signature: 'pg_unreachable' }),
      probeModelCapability: async () => ({ ok: false, capability: 'structured_output' }),
      resolveCanonicalMachineId: async () => 'us-mac-m4',
      getMachineHealth: async () => ({ ok: true, machine: 'us-mac-m4' }),
      getMachineCapacity: async () => ({ ok: false, available: 0 }),
      listProviderAccounts: async () => ['team1', 'team2', 'team3', 'team4', 'team5'],
    });

    const result = await gate.evaluate({
      logical_cycle: 13,
      role: 'generator',
      phase: 'generate',
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    });

    expect(result.status).toBe('blocked');
    expect(['infrastructure_blocked', 'contract_capability_mismatch']).toContain(result.failure_class);
    expect(result.should_create_attempt).toBe(false);
  });

  it('capacity cache 误报与宿主真实凭据不一致时 fail-safe', async () => {
    const gate = createCapabilityGate({
      probeProviderAuth: async () => ({ ok: false, signature: 'credential_missing' }),
      probeGitHub: async () => ({ ok: true }),
      probePostgres: async () => ({ ok: true }),
      probeModelCapability: async () => ({ ok: true, capability: 'structured_output' }),
      resolveCanonicalMachineId: async () => 'us-mac-m4',
      getMachineHealth: async () => ({ ok: true, machine: 'us-mac-m4' }),
      getMachineCapacity: async () => ({ ok: true, available: 9, source: 'cache' }),
      listProviderAccounts: async () => ['team1'],
    });

    const result = await gate.evaluate({
      logical_cycle: 17,
      role: 'generator',
      phase: 'generate',
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.failure_class).toBe('infrastructure_blocked');
    expect(result.fallback_reason).toBe('credential_probe_mismatch');
  });

  it('未验证 provider-account-machine 组合与未知 machine_id fail-closed', async () => {
    const gate = createCapabilityGate({
      probeProviderAuth: async () => ({ ok: true, provider: 'claude', account: 'account1' }),
      probeGitHub: async () => ({ ok: true }),
      probePostgres: async () => ({ ok: true }),
      probeModelCapability: async () => ({ ok: true, capability: 'structured_output' }),
      resolveCanonicalMachineId: async () => 'unknown-host',
      getMachineHealth: async () => ({ ok: false, machine: 'unknown-host' }),
      getMachineCapacity: async () => ({ ok: false, available: 0 }),
      listProviderAccounts: async () => ['account1'],
    });

    const result = await gate.evaluate({
      logical_cycle: 19,
      role: 'generator',
      phase: 'generate',
      preferred_target: { provider: 'claude', account: 'account1', machine: 'xian-mac-m4' },
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.failure_class).toBe('contract_capability_mismatch');
    expect(result.fallback_reason).toMatch(/unknown_machine|unverified_execution_target/);
  });

  it('USM4 才允许跨厂商降级，CM4/CM1 禁止本地 Claude 或 Grok', async () => {
    const gate = createCapabilityGate({
      probeProviderAuth: async ({ provider }: { provider: string }) => ({ ok: provider !== 'codex' }),
      probeGitHub: async () => ({ ok: true }),
      probePostgres: async () => ({ ok: true }),
      probeModelCapability: async () => ({ ok: true, capability: 'structured_output' }),
      resolveCanonicalMachineId: async ({ machine }: { machine: string }) => machine,
      getMachineHealth: async ({ machine }: { machine: string }) => ({ ok: true, machine }),
      getMachineCapacity: async ({ machine }: { machine: string }) => ({ ok: machine === 'us-mac-m4', available: machine === 'us-mac-m4' ? 1 : 0 }),
      listProviderAccounts: async ({ provider }: { provider: string }) => provider === 'codex' ? ['team1'] : ['account1'],
    });

    const us = await gate.evaluate({
      logical_cycle: 23,
      role: 'generator',
      phase: 'generate',
      preferred_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    });
    const cm4 = await gate.evaluate({
      logical_cycle: 23,
      role: 'generator',
      phase: 'generate',
      preferred_target: { provider: 'codex', account: 'team1', machine: 'xian-mac-m4' },
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    });

    expect(us.status).toBe('ok');
    expect(us.to_target.provider).toBe('claude');
    expect(cm4.status).toBe('blocked');
    expect(cm4.fallback_reason).toMatch(/migrate_to_usm4|infrastructure_blocked/);
  });
});
