import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repo = process.cwd();
const temps: string[] = [];
const file = (relative: string) => join(repo, relative);

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function readRequired(relative: string): string {
  const target = file(relative);
  expect(existsSync(target), `缺少合同要求的文件: ${relative}`).toBe(true);
  return readFileSync(target, 'utf8');
}

function runLegacyWithTripwires(script: string, args: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'codex-slot-contract-'));
  temps.push(root);
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const trace = join(root, 'trace');
  mkdirSync(home);
  mkdirSync(bin);
  for (const command of ['ssh', 'scp', 'codex', 'tmux']) {
    const shim = join(bin, command);
    writeFileSync(shim, `#!/bin/sh\nprintf 'called\\n' >> ${JSON.stringify(trace)}\nexit 97\n`);
    chmodSync(shim, 0o755);
  }
  const result = spawnSync('bash', [file(script), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      CODEX_BIN: 'codex',
      CODEX_US_HOST: 'forbidden',
      CODEX_REMOTE_HOST: 'forbidden',
    },
  });
  return {
    result,
    output: `${result.stdout}\n${result.stderr}`,
    trace: existsSync(trace) ? readFileSync(trace, 'utf8') : '',
  };
}

describe('完整 Codex Slot Round 4 合同 [BEHAVIOR]', () => {
  it('旧 codex-request 合法参数在任何网络前 exit 64', () => {
    const { result, output, trace } = runLegacyWithTripwires(
      'scripts/codex-request.sh',
      ['--team', 'team1'],
    );
    expect(result.status).toBe(64);
    expect(output).toContain('codex-slot start');
    expect(trace).toBe('');
  });

  it('旧 codex-remote-launch 合法参数在任何网络前 exit 64', () => {
    const { result, output, trace } = runLegacyWithTripwires(
      'scripts/codex-remote-launch.sh',
      ['--team', 'team3'],
    );
    expect(result.status).toBe(64);
    expect(output).toContain('codex-slot start');
    expect(trace).toBe('');
  });

  it('三路 executor 与 harness relay 只发 broker receipt', () => {
    const executor = readRequired('packages/brain/src/executor.js');
    const relay = readRequired('packages/brain/src/harness-skill-relay.js');
    expect(executor).not.toMatch(/accounts\s*:\s*injectedAccounts/);
    expect(executor).not.toContain('pickLocalAccountByDeficit');
    expect(executor).toContain('slot');
    expect(executor).toContain('receipt');
    expect(executor).toContain('codex-slot-broker');
    expect(executor).toContain("route.executor === 'codex'");
    expect(executor).toContain("location === 'xian'");
    expect(executor).toContain("location === 'xian_m1'");
    expect(executor).not.toMatch(/function selectBestBridge[\s\S]{0,1500}\/health[\s\S]{0,500}\.accounts/);
    expect(executor).not.toMatch(/所有 Codex Bridge 不可用[\s\S]{0,200}XIAN_CODEX_BRIDGE_URL/);
    expect(relay).not.toMatch(/account_id\s*:/);
    expect(relay).toContain('codex-slot-broker');
    expect(relay).toContain('receipt');
  });

  it('bridge/消费者删除 raw auth fallback 与 accounts 依赖', () => {
    const bridge = readRequired('packages/brain/scripts/codex-bridge/codex-bridge.cjs');
    const meta = readRequired('packages/brain/src/routes/brain-meta.js');
    const health = readRequired('packages/brain/src/credentials-health-scheduler.js');
    expect(bridge).not.toMatch(/loadRawAuth|injectLocalAccount|setupInjectedAccounts/);
    expect(bridge).not.toMatch(/accounts\s*&&\s*accounts\.length/);
    expect(bridge).toContain('CODEX_SLOT_RECEIVER_TOKEN');
    expect(bridge).toContain("'/run'");
    expect(bridge).toMatch(/\/execute[\s\S]{0,500}\b410\b/);
    expect(bridge).toMatch(/\/execute-review[\s\S]{0,500}\b410\b/);
    expect(meta).not.toMatch(/CODEX_BRIDGE_URL[\s\S]{0,300}\/accounts/);
    expect(health).not.toMatch(/CODEX_BRIDGE_URL[\s\S]{0,300}\/accounts/);
    expect(meta).toContain('account_usage_cache');
    expect(health).toContain('account_usage_cache');
  });

  it('migration 用 account_ref 全局 blocking 唯一且不建 codex_slot_agents', () => {
    const migration = readRequired('packages/brain/migrations/360_codex_slot.sql');
    expect(migration).toMatch(
      /UNIQUE INDEX[\s\S]*\(account_ref\)[\s\S]*active[\s\S]*quarantined[\s\S]*blocked/i,
    );
    expect(migration).not.toMatch(/CREATE TABLE[^;]*codex_slot_agents/is);
    expect(migration).toContain('codex_slot_actor_identities');
    expect(migration).toContain('identity_kind');
    expect(migration).toContain('identity_ref');
    expect(migration).toContain('ssh_key');
    expect(migration).toContain('tenant_id');
  });

  it('agent 身份容量复用 machine fleet slot SSOT', () => {
    const broker = readRequired('packages/brain/src/codex-slot-broker.js');
    expect(broker).toContain('system_registry');
    expect(broker).toContain('fleet-resource-cache');
    expect(broker).toContain('slot-allocator');
    expect(broker).toContain('deficit');
    expect(broker).not.toContain('codex_slot_agents');
  });

  it('authenticated frozen inventory cutover 与 durable crash restart smoke 存在', () => {
    const smoke = readRequired('packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh');
    expect(smoke).toContain('frozen-inventory-cutover');
    expect(smoke).toContain('durable-crash-restart');
    expect(smoke).toContain('global-account-contention');
    expect(smoke).toContain('usage-deficit-selection');
  });

  it('identity authority error matrix 与 stop 类型 exact，acquire stop reap 鉴权幂等', () => {
    const route = readRequired('packages/brain/src/routes/codex-slots.js');
    expect(route).toContain('CODEX_SLOT_BROKER_TOKEN');
    expect(route).toContain('timingSafeEqual');
    expect(route).toContain('/acquire');
    expect(route).toContain('/:session_id/stop');
    expect(route).toContain('/reap');
    expect(route).not.toContain('/status');
    expect(route).toContain('retryable');
    for (const marker of [
      'INVALID_REQUEST',
      'FORBIDDEN_IDENTITY',
      'ACCOUNT_BUSY',
      'ROLLOUT_FROZEN',
      'AGENT_UNAVAILABLE',
      'DURABILITY_FAILED',
    ]) {
      expect(route).toContain(marker);
    }
  });

  it('durable crash 重启覆盖每个写边界且禁止 unknown success', () => {
    const smoke = readRequired('packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh');
    for (const fault of [
      'after-lease-write',
      'after-session-write',
      'after-audit-write',
      'before-commit',
      'after-commit-before-response',
    ]) {
      expect(smoke).toContain(fault);
    }
    expect(smoke).toContain('unknown_success');
    expect(smoke).toContain('pid_before');
    expect(smoke).toContain('pid_after');
  });

  it('stop reaper schema副作用与连续失败P0回执 smoke 存在', () => {
    const smoke = readRequired('packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh');
    expect(smoke).toContain('idempotent-stop');
    expect(smoke).toContain('reaper-two-pass-and-alert');
    expect(smoke).toContain('release_transitions');
    expect(smoke).toContain('stop_audits');
    expect(smoke).toContain('action_receipts');
  });

  it('六条 blocking invariant 含 INV-19 全消费者与 INV-27 双 Bash 真执行', () => {
    const smoke = readRequired('packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh');
    const installer = readRequired('scripts/install-codex-slot.sh');
    for (const marker of [
      'health_ms',
      'heartbeat_stale_ms',
      'quarantine_review_ms',
      'production-callers-broker-only',
      'reaper-two-pass-and-alert',
      'predicate_id',
      'identity-authority-error-matrix',
      'protected-delivery-and-launch',
      'prepare_to_receive',
      'receive_to_launch',
    ]) {
      expect(smoke).toContain(marker);
    }
    expect(installer).toContain('CODEX_SLOT_CONFIG');
    const modernBash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
    const bash32 = spawnSync('/bin/bash', ['--version'], { encoding: 'utf8' });
    expect(bash32.stdout).toContain('version 3.2');
    expect(modernBash.stdout).toMatch(/version ([4-9]|[1-9][0-9])\./);
    for (const [shell, name] of [['/bin/bash', 'bash32'], ['bash', 'modern']] as const) {
      const root = mkdtempSync(join(tmpdir(), `codex-slot-${name}-`));
      temps.push(root);
      const result = spawnSync(shell, [file('scripts/install-codex-slot.sh'), '--install-root', join(root, 'root')], {
        encoding: 'utf8',
        env: { ...process.env, CODEX_SLOT_CONFIG: join(root, 'missing.json') },
      });
      expect(result.status).toBe(78);
      expect(existsSync(join(root, 'root/usr/local/libexec/cecelia-codex-slot-agent'))).toBe(false);
    }
  });
});
