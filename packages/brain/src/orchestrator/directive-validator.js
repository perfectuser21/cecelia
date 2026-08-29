import {
  COMMANDER_ACTIONS,
  parseCommanderDirective,
} from './commander-contract.js';

const ACTIVE_PHASES = new Set([
  'A_planning',
  'A_contract',
  'B_task_loop',
  'C_final_e2e',
  'planning',
  'gan',
  'generate',
  'evaluate',
  'paused',
  // 分权翻转（r80 案卷，决策 08-29）：人审挂起期与判死前会诊是 Commander 最该
  // 说话的时刻，此前被 invalid_phase 一律拒绝 → 它只能旁观机械层僵死。
  // merge/publish 仍不在列（公章不给）。
  'review',
  'failed',
]);

function rejected(reasonCode) {
  return Object.freeze({
    accepted: false,
    reason_code: reasonCode,
    directive: null,
  });
}

export function validateCommanderDirective(directive, {
  runId,
  eventCursor,
  phase,
  allowedActions,
  nextHop,
  maxHops = Number.MAX_SAFE_INTEGER,
  duplicateHop,
  spentUsd,
  maxUsd,
  deadlineAt,
  now,
  strictMachine,
  capabilityAllowed,
  evidenceOwned,
}) {
  if (directive?.run_id !== runId) return rejected('run_id_mismatch');
  if (directive?.event_cursor !== eventCursor) return rejected('stale_event_cursor');

  if (
    !COMMANDER_ACTIONS.includes(directive?.action)
    || !Array.isArray(allowedActions)
    || !allowedActions.includes(directive.action)
  ) {
    return rejected('action_not_allowed');
  }
  if (!ACTIVE_PHASES.has(phase)) return rejected('invalid_phase');

  let parsed;
  try {
    parsed = parseCommanderDirective(directive);
  } catch {
    return rejected('action_not_allowed');
  }

  if (duplicateHop) return rejected('duplicate_hop');
  if (
    !Number.isSafeInteger(nextHop)
    || !Number.isSafeInteger(maxHops)
    || nextHop < 1
    || nextHop > maxHops
  ) {
    return rejected('hop_budget_exceeded');
  }

  if (
    typeof spentUsd !== 'number'
    || typeof maxUsd !== 'number'
    || spentUsd < 0
    || maxUsd < 0
    || spentUsd >= maxUsd
  ) {
    return rejected('cost_budget_exceeded');
  }
  const nowMs = new Date(now).getTime();
  const deadlineMs = new Date(deadlineAt).getTime();
  const pastDeadline = !Number.isFinite(nowMs) || !Number.isFinite(deadlineMs) || nowMs >= deadlineMs;
  // 分权翻转：钟过了 Commander 有续命权——过期只拒 continue_default（逼它明确决定：
  // 改派/重试/升人/终局），不再一律封口。cost 预算仍是硬约束（钱是公章）。
  if (pastDeadline && parsed.action === 'continue_default') {
    return rejected('deadline_exceeded');
  }

  if (
    strictMachine
    && parsed.route?.machine
    && parsed.route.machine !== strictMachine
  ) {
    return rejected('strict_affinity_violation');
  }
  if (capabilityAllowed !== true) return rejected('capability_not_allowed');
  if (evidenceOwned !== true) return rejected('evidence_not_owned');

  return Object.freeze({
    accepted: true,
    reason_code: null,
    directive: parsed,
  });
}
