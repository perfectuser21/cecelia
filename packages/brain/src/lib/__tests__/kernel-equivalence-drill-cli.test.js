import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  compileReportDrillPlan,
} from '../kernel-equivalence-report-clock.js';
import {
  createTrustFixture,
} from './kernel-equivalence-test-fixtures.js';

const scriptPath = fileURLToPath(new URL(
  '../../../../../scripts/ci/run-kernel-equivalence-drill.mjs',
  import.meta.url,
));
const repositoryRoot = dirname(dirname(dirname(scriptPath)));

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('kernel equivalence drill CLI', () => {
  it('prints a deterministic 99-cell plan with eleven signer handoffs', () => {
    const first = run(['--plan', '--format=json']);
    const second = run(['--plan', '--format=json']);

    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(second.stdout).toBe(first.stdout);
    const report = JSON.parse(first.stdout);
    expect(report).toMatchObject({
      schema_version: 'kernel-equivalence-drill-cli/v1',
      mode: 'plan',
      behavior_count: 11,
      cell_count: 99,
      blocker_count: 99,
      signer_handoff_count: 11,
    });
    expect(report.cells).toHaveLength(99);
    expect(report.signer_handoffs).toHaveLength(11);
    expect(JSON.stringify(report)).not.toMatch(/private_key|signature|nonce/i);
  });

  it('distinguishes a valid contract from execution readiness', () => {
    const result = run(['--check', '--format=json']);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      mode: 'check',
      contract_valid: true,
      execution_ready: false,
      behavior_gap_count: 11,
      cell_blocker_count: 99,
      configured_bundle_ref_count: 0,
      trusted_bundle_count: 0,
      trust_key_count: 0,
      verified_cell_count: 0,
      proof_matrix_ready: false,
      execution_wiring_ready: false,
      execution_wiring_blockers: [
        'trusted_nonce_consumer_unavailable',
        'trusted_adapter_registry_unavailable',
        'trusted_collector_unavailable',
        'trusted_bundle_chain_store_unavailable',
        'trusted_cleanup_verifier_unavailable',
      ],
    });
  });

  it('compiles a historical check with the same finite report_as_of clock', () => {
    const contract = load(readFileSync(
      join(repositoryRoot, 'regression-contract.yaml'),
      'utf8',
    ));
    const keys = createTrustFixture();
    contract.behavior_equivalence.drill_trust_registry = keys.registry;
    for (const behavior of contract.behavior_equivalence.behaviors) {
      behavior.drill.seam_id = keys.effect.record.service_id;
      behavior.drill.effect_signer_status = 'available';
      behavior.drill.effect_key_id = keys.effect.record.key_id;
      behavior.drill.blocked_by = null;
    }

    const compiled = compileReportDrillPlan(contract);

    expect(compiled.now).toBe(
      Date.parse(contract.behavior_equivalence.report_as_of),
    );
    expect(compiled.plan.cells).toHaveLength(99);
    expect(compiled.plan.cells.every((cell) => cell.blocked_by == null)).toBe(true);
  });

  it('accepts an explicit safe read-only bundle directory in check mode', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'kernel-eq-cli-store-'));
    try {
      const result = run([
        '--check',
        '--bundle-dir',
        temporaryRoot,
        '--format=json',
      ]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        mode: 'check',
        configured_bundle_ref_count: 0,
        trusted_bundle_count: 0,
      });
      expect(existsSync(temporaryRoot)).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [[]],
    [['--plan', '--check']],
    [['--plan', '--unknown']],
    [['--plan', '--cell', 'anything']],
    [['--execute']],
  ])('rejects invalid or incomplete arguments: %j', (args) => {
    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^kernel_equivalence_cli_usage:/);
  });

  it('fails a root execute cell at the explicit trusted-wiring gate without writes', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'kernel-eq-cli-'));
    try {
      const stateDir = join(temporaryRoot, 'state');
      const receiptDir = join(temporaryRoot, 'receipts');
      const grantPath = join(temporaryRoot, 'missing.grant.json');
      const result = run([
        '--execute',
        '--cell',
        'KERNEL-P0-01-BRANCH-PROTECTION::codex::normal',
        '--grant',
        grantPath,
        '--state-dir',
        stateDir,
        '--receipt-dir',
        receiptDir,
      ]);

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        mode: 'execute',
        status: 'blocked',
        code: 'trusted_execution_wiring_unavailable',
        execution_ready: false,
        missing_wiring: [
          'trusted_nonce_consumer_unavailable',
          'trusted_adapter_registry_unavailable',
          'trusted_collector_unavailable',
          'trusted_bundle_chain_store_unavailable',
          'trusted_cleanup_verifier_unavailable',
        ],
      });
      expect(existsSync(stateDir)).toBe(false);
      expect(existsSync(receiptDir)).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
