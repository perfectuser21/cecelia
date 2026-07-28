import { validateCommanderDirective } from './directive-validator.js';

const TERMINAL_ATTEMPT_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);

const ROLE_BY_ACTION = Object.freeze({
  'spawn:planner': 'planner',
  'spawn:proposer': 'proposer',
  'spawn:reviewer': 'reviewer',
  'spawn:generator': 'generator',
  'spawn:generator-fix': 'generator',
  'spawn:evaluator': 'evaluator',
  'spawn:evaluator-evidence-repair': 'evaluator',
  'spawn:judge': 'judge',
});

function rejected(reasonCode) {
  return Object.freeze({
    accepted: false,
    reason_code: reasonCode,
    decision: null,
    effect: null,
  });
}

function accepted(effect, decision, dispatchContext = null) {
  return Object.freeze({
    accepted: true,
    reason_code: null,
    effect,
    decision,
    ...(dispatchContext ? { dispatch_context: dispatchContext } : {}),
  });
}

function retryDecision(defaultDecision, source, reason) {
  const action = source.role === 'generator'
    ? 'spawn:generator-fix'
    : `spawn:${source.role}`;
  return {
    phase: defaultDecision.phase,
    action,
    reason: `commander_retry:${reason}`,
  };
}

export function createCommanderDirectiveExecutor({
  eventStore,
  attemptStore,
  commanderStore,
}) {
  if (!eventStore || typeof eventStore.assertEvidenceRefs !== 'function') {
    throw new Error('createCommanderDirectiveExecutor requires eventStore');
  }
  if (!attemptStore || typeof attemptStore.getById !== 'function') {
    throw new Error('createCommanderDirectiveExecutor requires attemptStore');
  }
  if (
    !commanderStore
    || typeof commanderStore.get !== 'function'
    || typeof commanderStore.updateMemory !== 'function'
  ) {
    throw new Error('createCommanderDirectiveExecutor requires commanderStore');
  }

  async function execute({ directive, defaultDecision, validation }) {
    let evidenceOwned = false;
    try {
      evidenceOwned = await eventStore.assertEvidenceRefs(
        validation.runId,
        directive?.evidence_refs,
      );
    } catch {
      evidenceOwned = false;
    }
    const verdict = validateCommanderDirective(directive, {
      ...validation,
      evidenceOwned: validation.evidenceOwned === false
        ? false
        : evidenceOwned === true,
    });
    if (!verdict.accepted) return rejected(verdict.reason_code);
    const parsed = verdict.directive;

    if (['switch_provider', 'switch_machine'].includes(parsed.action)) {
      return rejected('phase2_route_mutation_deferred');
    }
    if (parsed.action === 'continue_default') {
      return accepted('continue_default', defaultDecision);
    }
    if (parsed.action === 'dispatch_role') {
      const legalRole = ROLE_BY_ACTION[defaultDecision.action] ?? null;
      if (!legalRole || parsed.target_role !== legalRole) {
        return rejected('illegal_role_at_kernel_boundary');
      }
      return accepted('dispatch_role', defaultDecision);
    }
    if (parsed.action === 'retry_attempt') {
      if (
        !Number.isSafeInteger(validation.remainingRetryBudget)
        || validation.remainingRetryBudget <= 0
      ) {
        return rejected('retry_budget_exhausted');
      }
      if (
        !parsed.target_attempt_id
        || !parsed.evidence_refs.includes(`attempt:${parsed.target_attempt_id}`)
      ) {
        return rejected('retry_evidence_required');
      }
      const source = await attemptStore.getById(parsed.target_attempt_id);
      if (!source || source.run_id !== validation.runId) {
        return rejected('retry_attempt_not_owned');
      }
      if (!TERMINAL_ATTEMPT_STATUSES.has(source.status)) {
        return rejected('retry_source_not_terminal');
      }
      if (!ROLE_BY_ACTION[`spawn:${source.role}`] || source.role === 'commander') {
        return rejected('retry_role_not_supported');
      }
      return accepted(
        'retry_attempt',
        retryDecision(defaultDecision, source, parsed.reason),
        {
          retry_of_attempt_id: source.id,
          logical_cycle_id: source.logical_cycle_id,
          restart_reason: 'commander_retry',
        },
      );
    }
    if (parsed.action === 'revise_guidance') {
      if (!parsed.guidance) return rejected('guidance_required');
      const state = await commanderStore.get(validation.runId);
      if (!state) return rejected('commander_state_missing');
      const updated = await commanderStore.updateMemory(validation.runId, {
        expectedCursor: state.event_cursor,
        latestGuidance: { text: parsed.guidance },
        status: 'ready',
      });
      if (!updated) return rejected('commander_cursor_conflict');
      return accepted('revise_guidance', defaultDecision);
    }
    if (parsed.action === 'pause_run') {
      return accepted('pause_run', {
        phase: 'paused',
        action: 'pause_run',
        reason: 'commander_pause_run',
      });
    }
    if (parsed.action === 'request_human') {
      return accepted('request_human', {
        phase: 'review',
        action: 'wait:human_review',
        reason: 'commander_request_human',
      });
    }
    if (parsed.action === 'abort_run') {
      return accepted('abort_run', {
        phase: 'failed',
        action: 'mark_failed',
        reason: 'commander_abort_run',
      });
    }
    return rejected('action_not_allowed');
  }

  return Object.freeze({ execute });
}

export const __test__ = {
  TERMINAL_ATTEMPT_STATUSES,
  ROLE_BY_ACTION,
};
