#!/usr/bin/env node
import { kernelRuntimeRetiredError } from '../../src/lib/kernel-retirement.js';
/* global console, process */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export {
  terminalizeCanaryParent,
  validateCleanupEvidence,
  waitForAttemptRunning,
} from './kernel-parent-terminal-worker-cleanup-contract.mjs';
export const CANARY_MACHINES = Object.freeze(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const LIVE_INSPECT_STATUSES = new Set([
  'prepared', 'starting', 'created', 'running', 'paused', 'restarting', 'removing',
]);
function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}
function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${flag} must be positive`);
  return parsed;
}
export function parseCleanupCanaryArgs(argv) {
  const args = {
    execute: false, dryRun: true, acknowledged: false, machines: [],
    timeoutMs: 120_000, pollMs: 1_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--execute') {
      args.execute = true;
      args.dryRun = false;
    } else if (flag === '--dry-run') {
      if (args.execute) throw new Error('--dry-run conflicts with --execute');
      args.dryRun = true;
    } else if (flag === '--ack-isolated-canary-cleanup') {
      args.acknowledged = true;
    } else if (flag === '--machines') {
      args.machines = takeValue(argv, index, flag).split(',').filter(Boolean);
      index += 1;
    } else if (flag === '--timeout-ms' || flag === '--poll-ms') {
      const value = positiveInteger(takeValue(argv, index, flag), flag);
      if (flag === '--timeout-ms') args.timeoutMs = value;
      else args.pollMs = value;
      index += 1;
    } else {
      throw new Error(`unknown cleanup canary argument: ${flag}`);
    }
  }
  return Object.freeze(args);
}
export function assertExecuteSafety(args) {
  const exactMachines = args.machines.length === CANARY_MACHINES.length
    && CANARY_MACHINES.every((machine) => args.machines.includes(machine))
    && new Set(args.machines).size === args.machines.length;
  if (
    args.execute !== true
    || args.dryRun !== false
    || args.acknowledged !== true
    || !exactMachines
  ) {
    throw new Error(
      'live cleanup canary refused: require --execute, '
      + '--ack-isolated-canary-cleanup, and the explicit canonical three-machine list',
    );
  }
  return true;
}
function createIdentity(randomId) {
  return Object.freeze({
    task_id: randomId(),
    initiative_id: randomId(),
    run_id: randomId(),
    controller_session_id: randomId(),
  });
}
export function buildCleanupCanaryTask({ taskId, runId } = {}) {
  return Object.freeze({
    id: taskId,
    title: 'Isolated parent-terminal Worker cleanup canary',
    description: 'Synthetic read-only cleanup delivery proof',
    task_type: 'audit',
    status: 'in_progress',
    payload: Object.freeze({
      cleanup_canary: true,
      run_id: runId,
      base_repo: 'perfectuser21/cecelia',
      role_assignments: Object.freeze({
        reporter: Object.freeze({ provider: 'codex' }),
      }),
    }),
  });
}
export function launchMachinesConcurrently(machines, launch) {
  return Promise.all(machines.map((machine, index) => launch(machine, index)));
}
export async function runCleanupCanary({
  args,
  randomId = randomUUID,
  createLiveOperations = createProductionOperations,
} = {}) {
  const identity = createIdentity(randomId);
  const steps = Object.freeze([
    'create isolated task, controller, run, and three active Worker attempts',
    'terminalize isolated parent run',
    'wait for confirmed outbox, decision, and non-live Worker inspect',
    'run a second drain and require zero claims',
    'finalize only the isolated canary identities',
  ]);
  if (!args?.execute) {
    return Object.freeze({
      dry_run: true,
      machines: CANARY_MACHINES,
      identity,
      steps,
    });
  }
  assertExecuteSafety(args);
  const operations = await createLiveOperations({ args, identity });
  let attempts = [];
  try {
    await operations.createIdentity(identity);
    attempts = await operations.launchAttempts(identity, args.machines);
    await operations.terminalizeParent(identity, attempts);
    const evidence = await operations.drainUntilConfirmed(identity, attempts, args);
    if (!evidence?.confirmed) throw new Error('cleanup canary confirmation evidence missing');
    const inspections = await operations.inspectWorkers(attempts);
    if (inspections.some((entry) => LIVE_INSPECT_STATUSES.has(entry.status))) {
      throw new Error('cleanup canary Worker inspect still reports a live job');
    }
    const secondDrain = await operations.drainAgain();
    if (secondDrain?.claimed !== 0) throw new Error('cleanup canary second drain was not inert');
    return Object.freeze({
      dry_run: false,
      machines: args.machines,
      identity,
      attempts,
      evidence,
      inspections,
      second_drain: secondDrain,
    });
  } finally {
    await operations.finalize(identity);
  }
}
async function createProductionOperations(_options) { throw kernelRuntimeRetiredError(); }
async function main() {
  const args = parseCleanupCanaryArgs(process.argv.slice(2));
  const result = await runCleanupCanary({ args });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[kernel-parent-terminal-worker-cleanup] ${error.message}`);
    process.exitCode = 1;
  });
}
