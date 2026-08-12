import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

describe('Map 与动作闸 [BEHAVIOR]', () => {
  it('stale Map 在 Provider 前失败', async () => {
    expect(process.env.DB_URL).toBeTruthy();
    const repo = await mkdtemp(join(tmpdir(), 'map-preflight-'));
    execFileSync('git', ['init', repo]);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'harness@example.invalid']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Harness']);
    execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'baseline']);
    const baselineSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const preflight = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    await preflight.persistMapHeader({ dbUrl: process.env.DB_URL, repo: 'scratch/map-red', revision: baselineSha, scannerVersion: 'test-v1', scannedAt: new Date(Date.now() - 16 * 60_000) });
    const before = await preflight.countProviderAttempts({ dbUrl: process.env.DB_URL, repo: 'scratch/map-red' });
    const result = await preflight.verifyMapImpactPreflight({ dbUrl: process.env.DB_URL, repo: 'scratch/map-red', repoPath: repo, baselineSha });
    expect(result).toMatchObject({ ok: false, reason_code: 'map_stale', provider_attempt_created: false });
    expect(await preflight.countProviderAttempts({ dbUrl: process.env.DB_URL, repo: 'scratch/map-red' })).toBe(before);
  });

  it('有头无头 receipt 均在动作前验证', async () => {
    expect(process.env.DB_URL).toBeTruthy();
    const headed = spawnSync('bash', ['packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh'], { encoding: 'utf8', env: { ...process.env, DB_URL: process.env.DB_URL } });
    expect(headed.status).toBe(0);
    expect(headed.stdout).toContain('MUTATION_BLOCKED_BEFORE_WRITE');
    const { runDispatcherReceiptIntegration } = await import('../../../packages/brain/src/orchestrator/__tests__/helpers/dispatcher-routing-receipt.integration.js');
    const invalid = await runDispatcherReceiptIntegration({ dbUrl: process.env.DB_URL, receiptState: 'superseded' });
    expect(invalid).toMatchObject({ reason_code: 'receipt_superseded', executor_calls: 0, route_violation_rows: 1 });
  });
});
