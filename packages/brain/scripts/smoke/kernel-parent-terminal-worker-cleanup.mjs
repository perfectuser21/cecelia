#!/usr/bin/env node
/* global console, process, setTimeout */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  terminalizeCanaryParent,
  validateCleanupEvidence,
  waitForAttemptRunning,
} from './kernel-parent-terminal-worker-cleanup-contract.mjs';

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
async function createProductionOperations({ args, identity }) {
  const [
    { default: pool },
    { buildRealDeps },
    transportModule,
    workerModule,
    outboxStoreModule,
  ] = await Promise.all([
    import('../../src/db.js'),
    import('../../src/orchestrator/run.js'),
    import('../../src/orchestrator/production-transport.js'),
    import('../../src/orchestrator/attempt-cleanup-worker.js'),
    import('../../src/orchestrator/attempt-cleanup-outbox-store.js'),
  ]);
  const transport = transportModule.createProductionExecutionTransport({
    env: process.env,
    fetchFn: globalThis.fetch,
  });
  const storeFactory = (db) => {
    const store = outboxStoreModule.createAttemptCleanupOutboxStore(db);
    if (db !== pool) return store;
    return Object.freeze({
      ...store,
      async claimBatch({ claimOwner, leaseSeconds, limit }) {
        const { rows } = await pool.query(
          `WITH claimable AS (
             SELECT id
               FROM harness_attempt_cleanup_outbox
              WHERE run_id = $4
                AND (
                  (status='pending' AND available_at<=NOW())
                  OR (status='leased' AND claim_expires_at<=NOW())
                )
              ORDER BY created_at,id
              LIMIT $3
              FOR UPDATE SKIP LOCKED
           )
           UPDATE harness_attempt_cleanup_outbox AS outbox
              SET status='leased',claim_owner=$1,
                  claim_generation=outbox.claim_generation+1,
                  claim_expires_at=NOW()+($2*INTERVAL '1 second'),
                  delivery_attempts=outbox.delivery_attempts+1,updated_at=NOW()
             FROM claimable
            WHERE outbox.id=claimable.id
           RETURNING outbox.*`,
          [claimOwner, leaseSeconds, limit, identity.run_id],
        );
        return rows;
      },
    });
  };
  const cleanupWorker = workerModule.createAttemptCleanupWorker({
    pool,
    transport,
    storeFactory: storeFactory,
    claimOwner: `cleanup-canary:${identity.run_id}`,
    limit: CANARY_MACHINES.length,
    retryAfterSeconds: 1,
  });
  let dispatcher;
  const taskSnapshot = buildCleanupCanaryTask({
    taskId: identity.task_id,
    runId: identity.run_id,
  });
  async function createCanaryIdentity() {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO tasks(id,title,description,task_type,status,payload)
         VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          taskSnapshot.id,
          taskSnapshot.title,
          taskSnapshot.description,
          taskSnapshot.task_type,
          taskSnapshot.status,
          JSON.stringify(taskSnapshot.payload),
        ],
      );
      await client.query(
        `INSERT INTO kernel_controller_sessions
           (id,task_id,generation,source,status,last_heartbeat_at,lease_expires_at)
         VALUES($1,$2,1,'kernel_dispatch','active',NOW(),NOW()+INTERVAL '10 minutes')`,
        [identity.controller_session_id, identity.task_id],
      );
      await client.query(
        `INSERT INTO initiative_runs(
           id,initiative_id,phase,current_task_id,orchestrator_version,created_source,
           record_trust_status,orchestrator_host,impact_contract_policy,
           impact_contract_policy_reason,controller_session_id,controller_generation,
           controller_lease_expires_at
         ) VALUES($1,$2,'gan',$3,'v2','kernel_dispatch','trusted',
                  'kernel-cleanup-canary','legacy_exempt','isolated read-only canary',
                  $4,1,(SELECT lease_expires_at FROM kernel_controller_sessions WHERE id=$4))`,
        [identity.run_id, identity.initiative_id, identity.task_id, identity.controller_session_id],
      );
      await client.query(
        'UPDATE kernel_controller_sessions SET run_id=$2,updated_at=NOW() WHERE id=$1',
        [identity.controller_session_id, identity.run_id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function launchAttempts(_identity, machines) {
    const deps = await buildRealDeps({ pool, env: process.env });
    dispatcher = deps.dispatch;
    return launchMachinesConcurrently(machines, async (machine, index) => {
      const launched = await dispatcher('spawn:canary', {
        taskId: identity.task_id,
        runId: identity.run_id,
        hop: index + 1,
        decision: { phase: 'gan' },
        observed: {
          task: taskSnapshot,
          run: { id: identity.run_id, phase: 'gan' },
          candidate: { machine_id: machine },
          contract: { row: { propose_branch: `cp-cleanup-canary-${identity.run_id.slice(0, 8)}` } },
        },
      });
      if (launched?.status !== 'LAUNCHED' || !launched.attempt_id) {
        throw new Error(`cleanup canary launch failed:${machine}:${launched?.detail}`);
      }
      return waitForAttemptRunning({
        pool,
        snapshot: {
          attempt_id: launched.attempt_id,
          run_id: identity.run_id,
          machine_id: machine,
          lease_owner: launched.lease_owner,
          lease_generation: launched.lease_generation,
        },
        timeoutMs: args.timeoutMs,
        pollMs: args.pollMs,
      });
    });
  }
  const terminalizeParent = (_identity, attempts) => terminalizeCanaryParent({
    pool,
    identity,
    attempts,
  });
  async function readEvidence(attempts) {
    const ids = attempts.map((attempt) => attempt.attempt_id);
    const outbox = (await pool.query(
      `SELECT id,run_id,attempt_id,target_machine_id,execution_transport,status,receipt,
              lease_owner,lease_generation
         FROM harness_attempt_cleanup_outbox
        WHERE run_id=$1 AND attempt_id=ANY($2::uuid[]) ORDER BY attempt_id`,
      [identity.run_id, ids],
    )).rows;
    const decisionCount = (await pool.query(
      `SELECT COUNT(*)::int AS count FROM orchestrator_decision_log
        WHERE run_id=$1 AND action='effect:attempt_cleanup_confirmed'`,
      [identity.run_id],
    )).rows[0].count;
    const complete = outbox.length === ids.length
      && outbox.every((row) => row.status === 'confirmed')
      && decisionCount === ids.length;
    if (complete) validateCleanupEvidence({ attempts, outbox, decisionCount });
    return {
      confirmed: complete,
      outbox_count: outbox.length,
      decision_count: decisionCount,
      outbox,
    };
  }
  return Object.freeze({
    createIdentity: createCanaryIdentity,
    launchAttempts,
    terminalizeParent,
    async drainUntilConfirmed(_identity, attempts) {
      const deadline = Date.now() + args.timeoutMs;
      do {
        await cleanupWorker.runOnce();
        const evidence = await readEvidence(attempts);
        if (evidence.confirmed) return evidence;
        await new Promise((resolve) => setTimeout(resolve, args.pollMs));
      } while (Date.now() < deadline);
      throw new Error('cleanup canary confirmation timeout');
    },
    async inspectWorkers(attempts) {
      return Promise.all(attempts.map((attempt) => transport.inspect({
        attempt: {
          id: attempt.attempt_id,
          lease_owner: attempt.lease_owner,
          lease_generation: attempt.lease_generation,
        },
        target: { machine: attempt.actual_machine_id ?? attempt.requested_machine_id },
      })));
    },
    drainAgain: () => cleanupWorker.runOnce(),
    async finalize() {
      try {
        await pool.query(
          `UPDATE initiative_runs SET phase='failed',failure_reason=COALESCE(failure_reason,
                  'cleanup_canary_finalizer'),completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
            WHERE id=$1 AND current_task_id=$2 AND phase NOT IN ('done','failed')`,
          [identity.run_id, identity.task_id],
        );
        await cleanupWorker.runOnce();
        await pool.query(
          `UPDATE kernel_controller_sessions SET status='closed',lease_expires_at=NOW(),updated_at=NOW()
            WHERE id=$1 AND task_id=$2 AND run_id=$3`,
          [identity.controller_session_id, identity.task_id, identity.run_id],
        );
        await pool.query(
          `UPDATE tasks SET status='failed',completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
            WHERE id=$1 AND payload->>'run_id'=$2`,
          [identity.task_id, identity.run_id],
        );
      } finally {
        await pool.end();
      }
    },
  });
}
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
