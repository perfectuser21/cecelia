#!/usr/bin/env node
import { kernelRuntimeRetiredError } from '../../src/lib/kernel-retirement.js';
/* global console, process */

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MACHINE_IDS = Object.freeze([
  'us-mac-m4',
  'xian-mac-m4',
  'xian-mac-m1',
]);

export const READ_ONLY_OBJECTIVE = [
  'Kernel fleet synthetic canary.',
  'Return only structured execution evidence.',
  'Return decision outcome CANARY_OK after successful execution.',
  'Do not merge, push, modify a worktree, or write business data.',
].join(' ');

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);
const LIVE_BRAIN_URL = 'http://localhost:5221';
function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function parseCanaryArgs(argv) {
  const args = {
    dryRun: true,
    execute: false,
    explicitDryRun: false,
    runId: null,
    brainUrl: null,
    ackNoBusinessWrites: false,
    mode: 'serial',
    strict: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      args.explicitDryRun = true;
    } else if (arg === '--execute') {
      args.execute = true;
      args.dryRun = false;
    } else if (arg === '--run-id') {
      args.runId = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--brain-url') {
      args.brainUrl = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--ack-no-business-writes') {
      args.ackNoBusinessWrites = true;
    } else if (arg === '--mode') {
      args.mode = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--serial') {
      args.mode = 'serial';
    } else if (arg === '--parallel') {
      args.mode = 'parallel';
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--non-strict') {
      args.strict = false;
    } else {
      throw new Error(`unknown canary argument: ${arg}`);
    }
  }

  if (!['serial', 'parallel'].includes(args.mode)) {
    throw new Error(`invalid canary mode: ${args.mode}`);
  }
  return Object.freeze(args);
}

export function assertLiveSafety(args) {
  const violations = [];
  if (args.execute !== true || args.dryRun !== false || args.explicitDryRun === true) {
    violations.push('--execute without --dry-run');
  }
  if (!LOWERCASE_UUID.test(args.runId ?? '')) {
    violations.push('explicit lowercase UUID --run-id');
  }
  if (args.brainUrl !== LIVE_BRAIN_URL) {
    violations.push(`--brain-url ${LIVE_BRAIN_URL}`);
  }
  if (args.ackNoBusinessWrites !== true) {
    violations.push('--ack-no-business-writes');
  }
  if (violations.length > 0) {
    throw new Error(`live canary refused: requires ${violations.join(', ')}`);
  }
  return true;
}

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : clock.now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('canary clock returned an invalid timestamp');
  return date.toISOString();
}

function normalizeTimestamp(value, field, attemptId) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid_${field}:${attemptId}`);
  }
  return date.toISOString();
}

function validateTerminalIdentity(evidence, { runId, machine }) {
  if (!evidence || typeof evidence !== 'object') {
    throw new Error(`invalid_callback_evidence:${machine}`);
  }
  if (!LOWERCASE_UUID.test(evidence.attempt_id ?? '')) {
    throw new Error(`invalid_attempt_id:${String(evidence.attempt_id)}`);
  }
  if (evidence.run_id !== runId) {
    throw new Error(`run_id_mismatch:${String(evidence.run_id)}:${runId}`);
  }
  if (!TERMINAL_STATUSES.has(evidence.status)) {
    throw new Error(`callback_not_terminal:${evidence.attempt_id}:${String(evidence.status)}`);
  }
}

export function validateMachineEvidence(evidence, machine) {
  const requested = evidence.requested_machine_id;
  const actual = evidence.actual_machine_id;
  if (requested !== machine || actual !== machine || requested !== actual) {
    throw new Error(`machine_receipt_mismatch:${String(requested)}:${String(actual)}`);
  }
  if (evidence.status !== 'completed') {
    throw new Error(`canary_attempt_failed:${evidence.attempt_id}:${evidence.status}`);
  }
  if (evidence.result?.decision?.outcome !== 'CANARY_OK') {
    throw new Error(`canary_decision_mismatch:${evidence.attempt_id}`);
  }
  if (
    !Array.isArray(evidence.result?.artifacts)
    || evidence.result.artifacts.length !== 0
    || !Array.isArray(evidence.result?.checks)
    || evidence.result.checks.length !== 0
    || evidence.result?.error !== null
  ) {
    throw new Error(`canary_side_effect_envelope:${evidence.attempt_id}`);
  }
  const provider = evidence.result?.provider_metadata?.provider;
  if (provider !== 'codex') {
    throw new Error(`canary_provider_mismatch:${evidence.attempt_id}:${String(provider)}`);
  }

  const remote = machine !== 'us-mac-m4';
  const expectedTransport = remote ? 'remote-bridge' : 'local-docker';
  const expectedAttestation = remote ? 'verified' : 'local';
  if (evidence.execution_transport !== expectedTransport) {
    throw new Error(
      `execution_transport_mismatch:${machine}:${String(evidence.execution_transport)}`,
    );
  }
  if (evidence.machine_attestation_status !== expectedAttestation) {
    throw new Error(
      `machine_attestation_mismatch:${machine}:${String(evidence.machine_attestation_status)}`,
    );
  }

  const startedAt = normalizeTimestamp(evidence.started_at, 'started_at', evidence.attempt_id);
  const completedAt = normalizeTimestamp(
    evidence.completed_at,
    'completed_at',
    evidence.attempt_id,
  );
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error(`invalid_execution_window:${evidence.attempt_id}`);
  }
  return Object.freeze({
    ...evidence,
    started_at: startedAt,
    completed_at: completedAt,
  });
}

function overlappingMachineCount(evidence) {
  const overlapping = new Set();
  for (let left = 0; left < evidence.length; left += 1) {
    for (let right = left + 1; right < evidence.length; right += 1) {
      const a = evidence[left];
      const b = evidence[right];
      if (
        Date.parse(a.started_at) < Date.parse(b.completed_at)
        && Date.parse(b.started_at) < Date.parse(a.completed_at)
      ) {
        overlapping.add(a.actual_machine_id);
        overlapping.add(b.actual_machine_id);
      }
    }
  }
  return overlapping.size;
}

export async function runThreeMachineCanary({
  mode = 'serial',
  strict = true,
  runId = randomUUID(),
  dispatch,
  clock = () => new Date(),
} = {}) {
  if (!['serial', 'parallel'].includes(mode)) throw new Error(`invalid canary mode: ${mode}`);
  if (!LOWERCASE_UUID.test(runId)) throw new Error(`invalid canary run id: ${String(runId)}`);
  if (typeof dispatch !== 'function') throw new Error('runThreeMachineCanary requires dispatch');
  if (typeof clock !== 'function' && typeof clock?.now !== 'function') {
    throw new Error('runThreeMachineCanary requires a clock function or clock.now');
  }

  const attempts = new Map();
  const attemptMachines = new Map();
  let duplicateCallbackCount = 0;

  function recordCallback(callback, expectedMachine) {
    validateTerminalIdentity(callback, { runId, machine: expectedMachine });
    const existing = attempts.get(callback.attempt_id);
    if (existing) {
      if (
        existing.requested_machine_id !== callback.requested_machine_id
        || existing.actual_machine_id !== callback.actual_machine_id
        || existing.status !== callback.status
      ) {
        throw new Error(`conflicting_duplicate_callback:${callback.attempt_id}`);
      }
      duplicateCallbackCount += 1;
      return existing;
    }
    const frozen = Object.freeze({ ...callback });
    attempts.set(callback.attempt_id, frozen);
    attemptMachines.set(callback.attempt_id, expectedMachine);
    return frozen;
  }

  async function runMachine(machine) {
    const maxAttempts = strict ? 1 : 2;
    let previousAttemptId = null;
    let lastError = null;

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      const raw = await dispatch(Object.freeze({
        runId,
        run_id: runId,
        machine,
        requested_machine_id: machine,
        mode,
        strict,
        attemptNumber,
        objective: READ_ONLY_OBJECTIVE,
        readOnly: true,
        requested_at: nowIso(clock),
      }));
      const callbacks = Array.isArray(raw) ? raw : [raw];
      if (callbacks.length === 0) throw new Error(`missing_terminal_callback:${machine}`);
      const recorded = callbacks.map((callback) => recordCallback(callback, machine));
      const terminal = recorded.at(-1);

      if (previousAttemptId && previousAttemptId === terminal.attempt_id) {
        throw new Error(`non_strict_retry_reused_attempt:${terminal.attempt_id}`);
      }
      previousAttemptId = terminal.attempt_id;

      try {
        return validateMachineEvidence(terminal, machine);
      } catch (error) {
        lastError = error;
        if (strict || attemptNumber === maxAttempts) throw error;
      }
    }
    throw lastError ?? new Error(`canary_attempt_failed:${machine}`);
  }

  let evidence = [];
  let machineResults = [];
  if (mode === 'parallel') {
    const settled = await Promise.allSettled(
      MACHINE_IDS.map((machine) => runMachine(machine)),
    );
    machineResults = settled.map((entry, index) => {
      const machine = MACHINE_IDS[index];
      if (entry.status === 'fulfilled') {
        return Object.freeze({
          machine,
          status: 'fulfilled',
          evidence: entry.value,
          error: null,
        });
      }
      const terminalEvidence = [...attempts.entries()]
        .filter(([attemptId]) => attemptMachines.get(attemptId) === machine)
        .map(([, row]) => row)
        .at(-1) ?? null;
      return Object.freeze({
        machine,
        status: 'rejected',
        evidence: terminalEvidence,
        error: entry.reason?.message ?? String(entry.reason),
      });
    });
    evidence = machineResults
      .map((entry) => entry.evidence)
      .filter(Boolean);
    if (machineResults.some((entry) => entry.status === 'rejected')) {
      return Object.freeze({
        passed: false,
        mode,
        strict,
        run_id: runId,
        evidence: Object.freeze(evidence),
        machine_results: Object.freeze(machineResults),
        attempts: Object.freeze([...attempts.values()]),
        terminal_count: attempts.size,
        duplicate_callback_count: duplicateCallbackCount,
        overlapping_machine_count: 0,
      });
    }
  }
  if (mode === 'serial') {
    for (const machine of MACHINE_IDS) evidence.push(await runMachine(machine));
    machineResults = evidence.map((row, index) => Object.freeze({
      machine: MACHINE_IDS[index],
      status: 'fulfilled',
      evidence: row,
      error: null,
    }));
  }

  if (new Set(evidence.map((row) => row.attempt_id)).size !== MACHINE_IDS.length) {
    throw new Error('canary_attempt_ids_not_unique');
  }
  const overlapCount = mode === 'parallel' ? overlappingMachineCount(evidence) : 0;
  if (mode === 'parallel' && overlapCount < 2) {
    throw new Error('parallel_execution_windows_do_not_overlap');
  }

  return Object.freeze({
    passed: true,
    mode,
    strict,
    run_id: runId,
    evidence: Object.freeze(evidence),
    machine_results: Object.freeze(machineResults),
    attempts: Object.freeze([...attempts.values()]),
    terminal_count: attempts.size,
    duplicate_callback_count: duplicateCallbackCount,
    overlapping_machine_count: overlapCount,
  });
}

export function createDryRunDispatch({
  clock = () => new Date(),
  randomId = randomUUID,
} = {}) {
  return async ({ runId, machine }) => {
    const startedAt = nowIso(clock);
    return Object.freeze({
      attempt_id: randomId(),
      run_id: runId,
      requested_machine_id: machine,
      actual_machine_id: machine,
      execution_transport: machine === 'us-mac-m4' ? 'local-docker' : 'remote-bridge',
      machine_attestation_status: machine === 'us-mac-m4' ? 'local' : 'verified',
      status: 'completed',
      started_at: startedAt,
      completed_at: new Date(Date.parse(startedAt) + 1_000).toISOString(),
      result: {
        artifacts: [],
        checks: [],
        decision: { outcome: 'CANARY_OK' },
        error: null,
        provider_metadata: { provider: 'codex' },
      },
      synthetic: true,
    });
  };
}

export async function ensureSyntheticRun(_pool, _runId) { throw kernelRuntimeRetiredError(); }

export async function createLiveDispatch(_options = {}) { throw kernelRuntimeRetiredError(); }

async function main() {
  const args = parseCanaryArgs(process.argv.slice(2));
  const clock = () => new Date();
  const runId = args.runId ?? randomUUID();
  let dispatch;
  try {
    if (args.execute) {
      assertLiveSafety(args);
      dispatch = await createLiveDispatch({
        runId,
        brainUrl: args.brainUrl,
      });
    } else {
      dispatch = createDryRunDispatch({ clock });
    }
    const result = await runThreeMachineCanary({
      mode: args.mode,
      strict: args.strict,
      runId,
      dispatch,
      clock,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await dispatch?.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[kernel-fleet-three-machine-canary] ${error.message}`);
    process.exitCode = 1;
  });
}
