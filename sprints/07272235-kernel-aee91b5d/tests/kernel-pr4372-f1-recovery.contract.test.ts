import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Kernel PR4372 F1 recovery contract red suite', () => {
  it('current main 漂移会作废旧 merge-base 证据', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/ground-truth.js');
    expect(typeof (mod as Record<string, unknown>).resolveCurrentMainEvidence).toBe('function');
  });

  it('六个重叠语义面与 current main 对账', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/derive.js');
    expect(typeof (mod as Record<string, unknown>).enumerateKernelSemanticSurfaces).toBe('function');
  });

  it('migration 366 文件存在且双跑稳定快照可验证', () => {
    const migrationPath = path.join(ROOT, 'packages/brain/migrations/366_kernel_harness_f1_baseline.sql');
    expect(existsSync(migrationPath)).toBe(true);
    const text = read('packages/brain/migrations/366_kernel_harness_f1_baseline.sql');
    expect(text).toContain('schema_version');
    expect(text).toMatch(/INDEX|CONSTRAINT/);
  });

  it('HARNESS_TEST_DATABASE_URL 写前 fail-closed', async () => {
    const mod = await import('../../../packages/engine/src/harness/evaluate.js');
    expect(typeof (mod as Record<string, unknown>).validateHarnessTestDatabaseUrl).toBe('function');
  });

  it('F1 fail-closed 套件覆盖七个 legacy smokes 与 exact oracle', () => {
    const scriptPath = path.join(ROOT, 'packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh');
    expect(existsSync(scriptPath)).toBe(true);
    const text = read('packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh');
    expect(text).not.toContain('|| true');
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
    expect(typeof (derive as Record<string, unknown>).requireServerOwnedReviewForHeadSha).toBe('function');
  });
});

