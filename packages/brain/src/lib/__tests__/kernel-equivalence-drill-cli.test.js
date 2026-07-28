import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

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
    });
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

  it('fails a root execute cell at signer preflight without writing directories', () => {
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
        code: 'seam_receipt_signer_missing',
      });
      expect(existsSync(stateDir)).toBe(false);
      expect(existsSync(receiptDir)).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
