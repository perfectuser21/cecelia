import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:net';
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

function run(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function evaluateGateReports(reports) {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    [
      `import { atomicCutoverGateReady } from ${JSON.stringify(`file://${scriptPath}`)};`,
      `const reports = ${JSON.stringify(reports)};`,
      'process.stdout.write(JSON.stringify(reports.map(atomicCutoverGateReady)));',
    ].join('\n'),
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function evaluateReportExitCodes(cases) {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    [
      `import { kernelEquivalenceReportExitCode } from ${JSON.stringify(`file://${scriptPath}`)};`,
      `const cases = ${JSON.stringify(cases)};`,
      'process.stdout.write(JSON.stringify(cases.map(({ report, mode }) => kernelEquivalenceReportExitCode(report, mode))));',
    ].join('\n'),
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
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
      schema_valid: true,
      proof_complete: false,
      atomic_cutover_ready: false,
      atom_count: 43,
      proof_required_atom_count: 42,
      probe_count: 446,
      proof_required_probe_count: 442,
      provider_probe_required: 1326,
      provider_probe_proven: 0,
      cell_count: 99,
      legacy_verified_family_receipt_count: 0,
      atomic_proven_family_cell_count: 0,
      execution_ready: false,
      behavior_gap_count: 11,
      cell_blocker_count: 99,
      configured_bundle_ref_count: 0,
      trusted_bundle_count: 0,
      trust_key_count: 0,
      legacy_family_receipt_matrix_ready: false,
      execution_wiring_ready: false,
      execution_wiring_blockers: [
        'trusted_execution_config_file_missing',
      ],
    });
  });

  it('keeps check informational but makes gate fail closed on every readiness field', () => {
    const information = run(['--check', '--format=json']);
    const gate = run(['--gate', '--format=json']);

    expect(information.status).toBe(0);
    expect(JSON.parse(information.stdout)).toMatchObject({
      mode: 'check',
      contract_valid: true,
      execution_ready: false,
      schema_valid: true,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_proven_family_cell_count: 0,
      legacy_family_receipt_matrix_ready: false,
      execution_wiring_ready: false,
    });
    expect(gate.status).toBe(1);
    expect(gate.stderr).toBe('');
    expect(JSON.parse(gate.stdout)).toMatchObject({
      mode: 'gate',
      contract_valid: true,
      execution_ready: false,
      schema_valid: true,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_proven_family_cell_count: 0,
      legacy_family_receipt_matrix_ready: false,
      execution_wiring_ready: false,
    });
  });

  it('never treats 99 legacy family receipts as atomic cutover proof', () => {
    const atomicReady = {
      contract_valid: true,
      schema_valid: true,
      proof_complete: true,
      atomic_cutover_ready: true,
      atomic_proven_family_cell_count: 99,
      execution_wiring_ready: true,
    };
    const legacyOnly = {
      ...atomicReady,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_proven_family_cell_count: 0,
      legacy_verified_family_receipt_count: 99,
      verified_cell_count: 99,
      legacy_family_receipt_matrix_ready: true,
      proof_matrix_ready: true,
    };

    expect(evaluateGateReports([legacyOnly, atomicReady])).toEqual([false, true]);
  });

  it('fails closed when each atomic gate field is false or missing', () => {
    const ready = {
      contract_valid: true,
      schema_valid: true,
      proof_complete: true,
      atomic_cutover_ready: true,
      atomic_proven_family_cell_count: 99,
      execution_wiring_ready: true,
    };
    const fieldCases = [
      'schema_valid',
      'proof_complete',
      'atomic_cutover_ready',
      'atomic_proven_family_cell_count',
      'execution_wiring_ready',
    ].flatMap((field) => {
      const falseReport = { ...ready };
      falseReport[field] = field === 'atomic_proven_family_cell_count'
        ? 98
        : false;
      const missingReport = { ...ready };
      delete missingReport[field];
      return [falseReport, missingReport];
    });

    expect(evaluateGateReports([ready, ...fieldCases])).toEqual([
      true,
      ...Array(fieldCases.length).fill(false),
    ]);
  });

  it('keeps check informational for incomplete proof but rejects invalid contracts', () => {
    const incomplete = run(['--check', '--format=json']);

    expect(incomplete.status).toBe(0);
    expect(JSON.parse(incomplete.stdout)).toMatchObject({
      contract_valid: true,
      schema_valid: true,
      proof_complete: false,
    });
    expect(evaluateReportExitCodes([
      {
        mode: 'check',
        report: {
          contract_valid: true,
          schema_valid: true,
          proof_complete: false,
        },
      },
      {
        mode: 'check',
        report: {
          contract_valid: false,
          schema_valid: false,
        },
      },
      {
        mode: 'check',
        report: {
          contract_valid: false,
          schema_valid: true,
        },
      },
    ])).toEqual([0, 1, 1]);
  });

  it('uses the fail-closed gate in the P0 regression contract', () => {
    const contract = readFileSync(
      join(repositoryRoot, 'regression-contract.yaml'),
      'utf8',
    );

    expect(contract).toContain(
      'run-kernel-equivalence-drill.mjs --gate --format=json',
    );
    expect(contract).not.toContain(
      'run-kernel-equivalence-drill.mjs --check --format=json',
    );
  });

  it('ignores raw socket and digest overrides without a protected manifest', async () => {
    const temporaryRoot = mkdtempSync('/tmp/keq-cli-');
    const socketPath = join(temporaryRoot, 'brain.sock');
    const listener = createServer((socket) => {
      socket.resume();
    });
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(socketPath, resolve);
    });
    chmodSync(socketPath, 0o600);
    try {
      const result = run(['--check', '--format=json'], {
        KERNEL_EQ_TRUSTED_EXECUTION_SOCKET_PATH: socketPath,
        KERNEL_EQ_TRUSTED_EXECUTION_PLAN_DIGEST: 'a'.repeat(64),
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        execution_ready: false,
        execution_wiring_ready: false,
        execution_wiring_blockers: [
          'trusted_execution_config_file_missing',
        ],
        legacy_family_receipt_matrix_ready: false,
      });
    } finally {
      await new Promise((resolve) => listener.close(resolve));
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('ignores a raw stale socket override without a protected manifest', () => {
    const temporaryRoot = mkdtempSync('/tmp/keq-cli-stale-');
    const socketPath = join(temporaryRoot, 'brain.sock');
    try {
      const created = spawnSync('python3', [
        '-c',
        [
          'import os, socket',
          'path = os.environ["KEQ_STALE_SOCKET"]',
          'sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
          'sock.bind(path)',
          'os.chmod(path, 0o600)',
        ].join('; '),
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          KEQ_STALE_SOCKET: socketPath,
        },
      });
      expect(created.status).toBe(0);

      const result = run(['--check', '--format=json'], {
        KERNEL_EQ_TRUSTED_EXECUTION_SOCKET_PATH: socketPath,
        KERNEL_EQ_TRUSTED_EXECUTION_PLAN_DIGEST: 'a'.repeat(64),
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        execution_ready: false,
        execution_wiring_ready: false,
        execution_wiring_blockers: [
          'trusted_execution_config_file_missing',
        ],
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
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
    [['--check', '--gate']],
    [['--plan', '--unknown']],
    [['--plan', '--cell', 'anything']],
    [['--execute']],
    [[
      '--execute',
      '--cell',
      'KERNEL-P0-01-BRANCH-PROTECTION::codex::normal',
      '--grant',
      '/tmp/caller.grant.json',
    ]],
    [[
      '--execute',
      '--cell',
      'KERNEL-P0-01-BRANCH-PROTECTION::codex::normal',
      '--grant-ref',
      'kernel-equivalence-grant:11111111-1111-4111-8111-111111111111',
      '--trusted-runtime',
    ]],
  ])('rejects invalid or incomplete arguments: %j', (args) => {
    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^kernel_equivalence_cli_usage:/);
  });

  it('sends only a canonical cell id and protected grant ref to Brain', () => {
    const result = run([
      '--execute',
      '--cell',
      'KERNEL-P0-01-BRANCH-PROTECTION::codex::normal',
      '--grant-ref',
      'kernel-equivalence-grant:11111111-1111-4111-8111-111111111111',
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: 'execute',
      status: 'blocked',
      code: 'trusted_execution_socket_unavailable',
      execution_ready: false,
    });
  });

  it('does not import trusted runtime, key, database, or registry code', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).not.toMatch(
      /kernel-equivalence-(?:runtime-loader|signers|runtime-registry)/,
    );
    expect(source).not.toMatch(/packages\/brain\/src\/db\.js/);
    expect(source).not.toMatch(
      /KERNEL_EQ_(?:COLLECTOR|EFFECT|GRANT_AUTHORITY)_[A-Z_]+/,
    );
    expect(source).not.toContain('--trusted-runtime');
    expect(source).not.toContain(
      'KERNEL_EQ_TRUSTED_EXECUTION_PLAN_DIGEST',
    );
    expect(source).toContain(
      'loadProductionTrustedExecutionReadinessConfiguration',
    );
    expect(source).toContain(
      'kernel-equivalence-readiness-configuration.js',
    );
    expect(source).not.toContain(
      'kernel-equivalence-production-wiring.js',
    );
  });
});
