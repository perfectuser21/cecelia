import { describe, expect, it } from 'vitest';
import {
  buildTrustedExecutionRequest,
  verifyTrustedExecution,
} from '../gp-assertion-trusted-execution.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const FILE_DIGEST = `sha256:${'f'.repeat(64)}`;
const TOOLCHAIN_PATHS = ['/usr/local/bin/node', '/repo/vitest.mjs'];
const BASE = {
  run_id: '11111111-1111-4111-8111-111111111111',
  journey_step_link_id: '22222222-2222-4222-8222-222222222222',
  machine_id: 'us-mac-m4',
  expected_runner_digest: DIGEST,
  source_repo: 'github.com/perfectuser21/cecelia',
  source_sha: 'c'.repeat(40),
  workspace_root: '/repo',
  timeout_ms: 2_000,
  command: {
    executable: '/usr/local/bin/node',
    argv: ['/repo/vitest.mjs', 'run', './contract.test.js', '--'],
    options: {
      cwd: '/repo/packages/brain',
      evidenceKind: 'vitest',
      toolchain_paths: TOOLCHAIN_PATHS,
    },
  },
};
const input = () => structuredClone(BASE);
const request = () => buildTrustedExecutionRequest(input());
const admission = (subject, patch = {}) => ({
  machine_id: subject.machine_id,
  state: 'base_admitted',
  base_admitted: true,
  dispatch_ready: true,
  observed_at: '2026-07-30T07:59:59.000Z',
  ...patch,
});
const receipt = (subject, patch = {}) => ({
  schema_version: 'gp-assertion-execution/v1',
  run_id: subject.run_id,
  journey_step_link_id: subject.journey_step_link_id,
  machine_id: subject.machine_id,
  runner_image_digest: subject.expected_runner_digest,
  source_repo: subject.source_repo,
  source_sha: subject.source_sha,
  command_digest: subject.command_digest,
  isolation: {
    rootfs_read_only: true,
    workspace_read_only: true,
    non_root: true,
  },
  toolchain_attestation: {
    kind: 'pinned_toolchain',
    actual_runner_digest: DIGEST,
    expected_runner_digest: DIGEST,
    files: TOOLCHAIN_PATHS.map(path => ({ path, sha256: FILE_DIGEST })),
  },
  exit_code: 0,
  stdout: '1 passed',
  stderr: '',
  started_at: '2026-07-30T08:00:00.000Z',
  completed_at: '2026-07-30T08:00:01.000Z',
  ...patch,
});
const verify = (subject, receiptPatch = {}, admissionPatch = {}) => (
  verifyTrustedExecution({
    request: subject,
    admission: admission(subject, admissionPatch),
    receipt: receipt(subject, receiptPatch),
  })
);

describe('GP assertion trusted execution contract', () => {
  it('builds a deterministic deeply frozen request bound to the command', () => {
    const subject = request();
    expect(subject.command_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(request().command_digest).toBe(subject.command_digest);
    expect(subject.command).toEqual({
      executable: BASE.command.executable,
      argv: BASE.command.argv,
      cwd: BASE.command.options.cwd,
      evidence_kind: 'vitest',
      timeout_ms: 2_000,
      toolchain_paths: TOOLCHAIN_PATHS,
    });
    expect([
      subject,
      subject.command,
      subject.command.argv,
      subject.command.toolchain_paths,
    ].every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ['digest', value => { delete value.expected_runner_digest; }],
    ['workspace', value => { value.workspace_root = 'repo'; }],
    ['executable', value => { value.command.executable = 'node'; }],
    ['argv', value => { value.command.argv = ['bad\0arg']; }],
    ['evidence', value => { value.command.options.evidenceKind = 'unknown'; }],
    ['toolchain', value => {
      value.command.options.toolchain_paths = ['/bin/node', '/bin/node'];
    }],
    ['timeout', value => { value.timeout_ms = 0; }],
  ])('rejects invalid request %s', (_label, mutate) => {
    const value = input();
    mutate(value);
    expect(() => buildTrustedExecutionRequest(value)).toThrowError(
      expect.objectContaining({ code: 'ASSERTION_TRUSTED_REQUEST_INVALID' }),
    );
  });

  it('returns bounded execution plus merge-safe trusted evidence', () => {
    const subject = request();
    const result = verify(subject);
    expect(result.execution).toMatchObject({ exitCode: 0, stdout: '1 passed' });
    expect(result.scenario_evidence.trusted_execution).toMatchObject({
      machine_id: 'us-mac-m4',
      runner_image_digest: DIGEST,
      command_digest: subject.command_digest,
      rootfs_read_only: true,
      workspace_read_only: true,
      non_root: true,
      admission_observed_at: '2026-07-30T07:59:59.000Z',
      toolchain_attestation: {
        actual_runner_digest: DIGEST,
        files: TOOLCHAIN_PATHS.map(path => ({ path, sha256: FILE_DIGEST })),
      },
    });
    expect(Object.isFrozen(result.scenario_evidence.trusted_execution)).toBe(true);
  });

  it.each([
    ['missing', null],
    ['draining', { state: 'draining' }],
    ['machine', { machine_id: 'xian-mac-m4' }],
    ['readiness', { dispatch_ready: false }],
  ])('rejects invalid admission %s', (_label, patch) => {
    const subject = request();
    expect(() => verifyTrustedExecution({
      request: subject,
      admission: patch === null ? null : admission(subject, patch),
      receipt: receipt(subject),
    })).toThrowError(expect.objectContaining({
      code: 'ASSERTION_RUNNER_NOT_ADMITTED',
    }));
  });

  it.each([
    ['run_id', '33333333-3333-4333-8333-333333333333'],
    ['journey_step_link_id', '44444444-4444-4444-8444-444444444444'],
    ['machine_id', 'xian-mac-m4'],
    ['runner_image_digest', `sha256:${'b'.repeat(64)}`],
    ['source_repo', 'github.com/example/other'],
    ['source_sha', 'd'.repeat(40)],
    ['command_digest', 'e'.repeat(64)],
  ])('rejects binding drift in %s', (field, value) => {
    expect(() => verify(request(), { [field]: value })).toThrowError(
      expect.objectContaining({ code: 'ASSERTION_RUNNER_BINDING_MISMATCH' }),
    );
  });

  it.each([
    [{ rootfs_read_only: false, workspace_read_only: true }],
    [{ rootfs_read_only: true, workspace_read_only: false }],
    [{ rootfs_read_only: true, workspace_read_only: true }],
    [{ rootfs_read_only: true, workspace_read_only: true, non_root: false }],
  ])('requires exact read-only isolation %#', isolation => {
    expect(() => verify(request(), { isolation })).toThrowError(
      expect.objectContaining({ code: 'ASSERTION_RUNNER_ISOLATION_UNVERIFIED' }),
    );
  });

  it.each([
    ['missing', { toolchain_attestation: undefined },
      'ASSERTION_RUNNER_RECEIPT_INVALID'],
    ['path drift', {
      toolchain_attestation: {
        ...receipt(request()).toolchain_attestation,
        files: [{ path: '/other/node', sha256: FILE_DIGEST }],
      },
    }, 'ASSERTION_TOOLCHAIN_DRIFT'],
    ['digest drift', {
      toolchain_attestation: {
        ...receipt(request()).toolchain_attestation,
        actual_runner_digest: `sha256:${'b'.repeat(64)}`,
      },
    }, 'ASSERTION_RUNNER_DIGEST_MISMATCH'],
  ])('rejects trusted toolchain attestation %s', (_label, patch, code) => {
    expect(() => verify(request(), patch)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    ['schema', { schema_version: 'other/v1' }, {}, 'ASSERTION_RUNNER_RECEIPT_INVALID'],
    ['exit', { exit_code: 256 }, {}, 'ASSERTION_RUNNER_RECEIPT_INVALID'],
    ['extra', { unexpected: true }, {}, 'ASSERTION_RUNNER_RECEIPT_INVALID'],
    ['output', { stdout: 'x'.repeat(16 * 1024 + 1) }, {}, 'ASSERTION_RUNNER_RECEIPT_INVALID'],
    ['time', { started_at: 'today' }, {}, 'ASSERTION_EXECUTION_TIME_INVALID'],
    ['reverse', { completed_at: '2026-07-30T07:59:59.000Z' }, {}, 'ASSERTION_EXECUTION_TIME_INVALID'],
    ['timeout', { completed_at: '2026-07-30T08:00:03.000Z' }, {}, 'ASSERTION_EXECUTION_TIME_INVALID'],
    ['stale', {}, { observed_at: '2026-07-30T07:58:29.999Z' }, 'ASSERTION_EXECUTION_TIME_INVALID'],
  ])('rejects invalid evidence %s', (_label, receiptPatch, admissionPatch, code) => {
    expect(() => verify(request(), receiptPatch, admissionPatch)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});
