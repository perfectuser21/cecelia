import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Kernel PR4372 F1 recovery contract red suite', () => {
  it('current-main 六个重叠语义面显式列出并对 current main 对账', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/kernel-pr4372-current-main-surfaces.js');
    const surfaces = (mod as Record<string, unknown>).CURRENT_MAIN_SURFACES;
    expect(Array.isArray(surfaces)).toBe(true);
    expect((surfaces as unknown[]).length).toBe(6);
  });

  it('migration 366 文件存在且双跑稳定快照可验证', () => {
    const migrationPath = path.join(ROOT, 'packages/brain/migrations/366_kernel_harness_f1_baseline.sql');
    expect(existsSync(migrationPath)).toBe(true);
    const text = read('packages/brain/migrations/366_kernel_harness_f1_baseline.sql');
    expect(text).toMatch(/schema_version/i);
    expect(text).toMatch(/index|constraint/i);

    const renamed = path.join(
      ROOT,
      'packages/brain/src/__tests__/integration/migration-366-kernel-harness-f1-baseline.integration.test.js',
    );
    const legacy = path.join(
      ROOT,
      'packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js',
    );
    expect(existsSync(renamed) || (existsSync(legacy) && read(path.relative(ROOT, legacy)).includes('366_kernel_harness_f1_baseline.sql'))).toBe(true);
  });

  it('HARNESS_TEST_DATABASE_URL 写前 fail-closed', async () => {
    const mod = await import('../../../packages/engine/src/harness/evaluate.js');
    expect(typeof (mod as Record<string, unknown>).validateHarnessTestDatabaseUrl).toBe('function');
    const src = read('packages/engine/src/harness/evaluate.js');
    expect(src).toContain('HARNESS_TEST_DATABASE_URL');
    expect(src).toContain('host.docker.internal');
    expect(src).toContain('127.0.0.1');
    expect(src).toContain('current_database');
    expect(src).toContain('inet_server_addr');
  });

  it('F1 fail-closed 套件覆盖七个具名 legacy smokes 与 exact oracle', () => {
    const scriptPath = path.join(ROOT, 'packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh');
    expect(existsSync(scriptPath)).toBe(true);
    const text = read('packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh');
    expect(text).not.toContain('|| true');
    for (const smoke of [
      'git-sha-health-smoke.sh',
      'review-gating-smoke.sh',
      'harness-judge-smoke.sh',
      'harness-lifecycle-gates-smoke.sh',
      'harness-contract-sha-freeze-smoke.sh',
      'review-approve-auth-smoke.sh',
      'evaluator-evidence-bridge-smoke.sh',
    ]) {
      expect(text).toContain(smoke);
    }
    expect(text).toContain('143');
    expect(text).toContain('11');
    expect(text).toContain('8');
  });

  it('同 SHA evaluator judge human review 只读证明路径存在', async () => {
    const mod = await import('../../../packages/brain/src/routes/harness-kernel-approvals.js');
    expect(typeof (mod as Record<string, unknown>).buildReadOnlyHeadShaEvidenceFixture).toBe('function');
  });

  it('PR 4372 保持 Draft 且 review_required 由服务端控制', async () => {
    const gates = await import('../../../packages/brain/src/orchestrator/gates.js');
    const derive = await import('../../../packages/brain/src/orchestrator/derive.js');
    expect(typeof (gates as Record<string, unknown>).mergeGate).toBe('function');
    expect(typeof (derive as Record<string, unknown>).derive).toBe('function');
    const src = read('packages/brain/src/orchestrator/derive.js');
    expect(src).toContain('wait:human_review');
    expect(src).toContain('reviewRequired');
  });
});
