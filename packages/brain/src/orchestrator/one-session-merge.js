import { deriveCounters } from './counters.js';
import { derive } from './derive.js';
import { mergeGate } from './gates.js';
import { appendHop as defaultAppendHop, nextHop as defaultNextHop } from './decision-log.js';

function denied(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function observedSnapshot(observed, impactGateReceipt = null) {
  return {
    source: 'one_session_merge_api',
    run: {
      id: observed.run?.id ?? null,
      phase: observed.run?.phase ?? null,
    },
    task: {
      id: observed.task?.id ?? null,
      status: observed.task?.status ?? null,
    },
    pr: observed.pr == null ? null : {
      url: observed.pr.url ?? null,
      head_sha: observed.pr.head_sha ?? null,
      state: observed.pr.state ?? null,
      ci: observed.pr.ci ?? null,
      mergeStateStatus: observed.pr.mergeStateStatus ?? null,
    },
    contract: {
      id: observed.contract?.id ?? null,
      identity: observed.contract?.identity ?? null,
    },
    evaluateVerdict: observed.evaluateVerdict ?? null,
    judgeVerdict: observed.judgeVerdict ?? null,
    impact_gate: impactGateReceipt,
  };
}

export async function executeOneSessionMerge({
  pool,
  taskId,
  runId,
  collect,
  impactGate,
  dispatch,
  appendHop = defaultAppendHop,
  nextHop = defaultNextHop,
}) {
  const observed = await collect({ taskId, runId });
  if (
    String(observed?.run?.id ?? '') !== String(runId)
    || String(observed?.task?.id ?? '') !== String(taskId)
  ) {
    throw denied('one_session_merge_authority_mismatch');
  }
  const derivedCounters = deriveCounters(observed.decisionLog ?? [], {
    proposeBranchMaxRn: observed.proposeBranchRn ?? 0,
  });
  const withCounters = {
    ...observed,
    counters: {
      ...derivedCounters,
      ganCostUsd: Number(observed.run?.cost_usd ?? 0),
    },
  };
  const intent = derive(withCounters);
  const gate = mergeGate({
    evaluateVerdict: observed.evaluateVerdict,
    judgeVerdict: observed.judgeVerdict,
    prHeadSha: observed.pr?.head_sha,
    contractIdentity: observed.contract?.identity ?? null,
    reviewRequired: observed.reviewRequired === true,
    reviewApproved: observed.reviewApproved === true,
  });
  if (intent.action !== 'merge_pr' || gate.allow !== true) {
    throw denied(`one_session_merge_gate_denied:${gate.reason}`);
  }

  const impactGateReceipt = await impactGate.beforeMerge({
    task: observed.task,
    run: observed.run,
    pr: observed.pr,
    decisionLog: observed.decisionLog ?? [],
  });
  if (!['pass', 'extend'].includes(impactGateReceipt?.gate)) {
    throw denied(
      `one_session_impact_gate_denied:${impactGateReceipt?.reason ?? 'unknown'}`,
    );
  }

  const intentHop = await nextHop(pool, runId);
  const snapshot = observedSnapshot(observed, impactGateReceipt);
  await appendHop(pool, {
    runId,
    hop: intentHop,
    observed: snapshot,
    derivedPhase: 'merge',
    gateVerdict: 'allow',
    action: 'merge_pr',
    detail: { reason: 'one_session_server_authority' },
  });
  const result = await dispatch('merge_pr', {
    runId,
    taskId,
    hop: intentHop,
    observed,
    impactGateReceipt,
  });
  const resultHop = await nextHop(pool, runId);
  await appendHop(pool, {
    runId,
    hop: resultHop,
    observed: snapshot,
    derivedPhase: 'merge',
    gateVerdict: ['DONE', 'DONE_WITH_CONCERNS'].includes(result?.status)
      ? 'allow'
      : `deny:${String(result?.status ?? 'unknown').toLowerCase()}`,
    action: 'result:dispatch',
    detail: {
      source: 'one_session_merge_api',
      trigger_hop: intentHop,
      status: result?.status ?? null,
      detail: result?.detail ?? null,
    },
  });
  return result;
}
