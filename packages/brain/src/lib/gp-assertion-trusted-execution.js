import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { assertionRunnerError } from './gp-assertion-command.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMAND_DIGEST = /^[0-9a-f]{64}$/;
const EVIDENCE_KINDS = new Set(['vitest', 'pytest', 'bash']);
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const RECEIPT_KEYS = [
  'schema_version', 'run_id', 'journey_step_link_id', 'machine_id',
  'runner_image_digest', 'source_repo', 'source_sha', 'command_digest',
  'isolation', 'exit_code', 'stdout', 'stderr', 'started_at', 'completed_at',
];

function fail(code) {
  throw assertionRunnerError(code, code);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function canonicalTime(value) {
  if (typeof value !== 'string') return null;
  try {
    return new Date(value).toISOString() === value ? Date.parse(value) : null;
  } catch {
    return null;
  }
}

export function buildTrustedExecutionRequest(input = {}) {
  const command = input.command;
  const options = command?.options;
  const argv = command?.argv;
  const valid = UUID.test(input.run_id ?? '')
    && UUID.test(input.journey_step_link_id ?? '')
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.machine_id ?? '')
    && DIGEST.test(input.expected_runner_digest ?? '')
    && typeof input.source_repo === 'string' && input.source_repo.length <= 512
    && /^[^@\s/]+\/[^\s]+$/.test(input.source_repo)
    && SHA.test(input.source_sha ?? '')
    && isAbsolute(input.workspace_root ?? '')
    && isAbsolute(command?.executable ?? '')
    && Array.isArray(argv) && argv.length > 0
    && argv.every(arg => typeof arg === 'string'
      && arg.length <= 4_096 && !/[\0\r\n]/.test(arg))
    && isAbsolute(options?.cwd ?? '')
    && EVIDENCE_KINDS.has(options?.evidenceKind)
    && Number.isInteger(input.timeout_ms)
    && input.timeout_ms > 0 && input.timeout_ms <= MAX_TIMEOUT_MS;
  if (!valid) fail('ASSERTION_TRUSTED_REQUEST_INVALID');
  const frozenCommand = deepFreeze({
    executable: command.executable,
    argv: [...argv],
    cwd: options.cwd,
    evidence_kind: options.evidenceKind,
    timeout_ms: input.timeout_ms,
  });
  const commandDigest = createHash('sha256')
    .update(JSON.stringify(frozenCommand)).digest('hex');
  return deepFreeze({
    schema_version: 'gp-assertion-request/v1',
    run_id: input.run_id,
    journey_step_link_id: input.journey_step_link_id,
    machine_id: input.machine_id,
    expected_runner_digest: input.expected_runner_digest,
    source_repo: input.source_repo,
    source_sha: input.source_sha,
    workspace_root: input.workspace_root,
    command: frozenCommand,
    command_digest: commandDigest,
  });
}

export function verifyTrustedExecution({ request, admission, receipt } = {}) {
  if (!admission || admission.machine_id !== request?.machine_id
    || admission.state !== 'base_admitted' || admission.base_admitted !== true
    || admission.dispatch_ready !== true) {
    fail('ASSERTION_RUNNER_NOT_ADMITTED');
  }
  if (!exactKeys(receipt, RECEIPT_KEYS)
    || receipt.schema_version !== 'gp-assertion-execution/v1'
    || !DIGEST.test(receipt.runner_image_digest ?? '')
    || !COMMAND_DIGEST.test(receipt.command_digest ?? '')
    || !Number.isInteger(receipt.exit_code)
    || receipt.exit_code < 0 || receipt.exit_code > 255
    || typeof receipt.stdout !== 'string' || typeof receipt.stderr !== 'string'
    || Buffer.byteLength(receipt.stdout) + Buffer.byteLength(receipt.stderr)
      > MAX_OUTPUT_BYTES) {
    fail('ASSERTION_RUNNER_RECEIPT_INVALID');
  }
  const bindings = [
    ['run_id', 'run_id'],
    ['journey_step_link_id', 'journey_step_link_id'],
    ['machine_id', 'machine_id'],
    ['runner_image_digest', 'expected_runner_digest'],
    ['source_repo', 'source_repo'],
    ['source_sha', 'source_sha'],
    ['command_digest', 'command_digest'],
  ];
  if (bindings.some(([actual, expected]) => receipt[actual] !== request[expected])) {
    fail('ASSERTION_RUNNER_BINDING_MISMATCH');
  }
  if (!exactKeys(receipt.isolation, ['rootfs_read_only', 'workspace_read_only'])
    || receipt.isolation.rootfs_read_only !== true
    || receipt.isolation.workspace_read_only !== true) {
    fail('ASSERTION_RUNNER_ISOLATION_UNVERIFIED');
  }
  const admitted = canonicalTime(admission.observed_at);
  const started = canonicalTime(receipt.started_at);
  const completed = canonicalTime(receipt.completed_at);
  if (admitted === null || started === null || completed === null
    || started - admitted < -30_000 || started - admitted > 90_000
    || completed < started || completed - started > request.command.timeout_ms) {
    fail('ASSERTION_EXECUTION_TIME_INVALID');
  }
  return deepFreeze({
    execution: {
      exitCode: receipt.exit_code,
      stdout: receipt.stdout,
      stderr: receipt.stderr,
      startedAt: receipt.started_at,
      completedAt: receipt.completed_at,
    },
    scenario_evidence: {
      trusted_execution: {
        schema_version: receipt.schema_version,
        machine_id: receipt.machine_id,
        runner_image_digest: receipt.runner_image_digest,
        source_repo: receipt.source_repo,
        source_sha: receipt.source_sha,
        command_digest: receipt.command_digest,
        rootfs_read_only: true,
        workspace_read_only: true,
        started_at: receipt.started_at,
        completed_at: receipt.completed_at,
        admission_observed_at: admission.observed_at,
      },
    },
  });
}
