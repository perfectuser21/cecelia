import { createAttemptStore } from './attempt-store.js';
import { deriveCounters } from './counters.js';
import { derive } from './derive.js';
import { collectGroundTruth } from './ground-truth.js';

function assertInput(input) {
  const required = [
    'pool',
    'taskId',
    'runId',
    'leaseOwner',
    'leaseSeconds',
    'providerRegistry',
    'launchResume',
    'execCmd',
    'fileExists',
    'readFile',
    'readAuthCircuit',
  ];
  for (const field of required) {
    if (input?.[field] == null) {
      throw new Error(`recoverDurableRun requires ${field}`);
    }
  }
}

async function reconcile(input, terminatedAttemptId = null, errorCode = null) {
  const observed = await collectGroundTruth({
    pool: input.pool,
    execCmd: input.execCmd,
    fileExists: input.fileExists,
    readFile: input.readFile,
    readAuthCircuit: input.readAuthCircuit,
  }, {
    taskId: input.taskId,
    runId: input.runId,
    prdPath: input.prdPath ?? 'sprint-prd.md',
    callbackResultPath: input.callbackResultPath ?? '.brain-result.json',
  });
  const counters = deriveCounters(observed.decisionLog, {
    proposeBranchMaxRn: observed.proposeBranchRn,
  });
  const decision = derive({
    ...observed,
    counters: {
      ...counters,
      ganCostUsd: Number(observed.run.cost_usd ?? 0),
    },
  });
  return {
    outcome: 'reconciled',
    terminated_attempt_id: terminatedAttemptId,
    error_code: errorCode,
    decision,
  };
}

/**
 * Recover a Kernel run exclusively from the existing durable ledgers.
 *
 * The primitive intentionally does not create attempts. An expired attempt is
 * reclaimed in place and either resumed with its provider session or
 * terminally reconciled before the normal ground-truth/derive loop continues.
 */
export async function recoverDurableRun(input) {
  assertInput(input);
  const attempts = createAttemptStore(input.pool);
  const active = await attempts.getActiveByRun(input.runId);

  if (!active || active.lease_expired !== true) {
    return reconcile(input);
  }

  const reclaimed = await attempts.reclaim(active.id, {
    leaseOwner: input.leaseOwner,
    leaseSeconds: input.leaseSeconds,
  });
  if (!reclaimed) {
    return reconcile(input);
  }

  if (reclaimed.provider_session_id) {
    const adapter = input.providerRegistry.resolve({
      provider: reclaimed.provider,
      requires: ['resume'],
    });
    const spec = adapter.resume({
      attempt: reclaimed,
      input: {
        reason: 'durable_resume',
        run_id: input.runId,
      },
      execution: input.execution ?? {},
    });
    const launchResult = await input.launchResume({
      attempt: reclaimed,
      spec,
    });
    return {
      outcome: 'resumed',
      attempt_id: reclaimed.id,
      provider_session_id: reclaimed.provider_session_id,
      launch_result: launchResult,
    };
  }

  const errorCode = 'orphan_without_provider_session';
  const failed = await attempts.fail(reclaimed.id, {
    code: errorCode,
    message: 'expired attempt has no provider session to resume',
  }, {
    leaseOwner: input.leaseOwner,
  });
  return reconcile(
    input,
    failed.attempt?.id ?? reclaimed.id,
    errorCode,
  );
}
