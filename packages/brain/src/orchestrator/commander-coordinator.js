import { randomUUID } from 'node:crypto';

import { buildCommanderBundle } from './commander-bundle.js';
import {
  classifyCommanderWakeup,
  materialEventsAfter,
} from './commander-wakeup.js';

const ACTIVE_ATTEMPT_STATUSES = new Set(['queued', 'starting', 'running']);
const INFRASTRUCTURE_FAILURE_CLASSES = new Set([
  'infrastructure_blocked',
  'runner_failure',
]);
const COMMANDER_FAILOVER_CODES = new Set([
  'auth_failed',
  'http_429',
  'rate_limit',
  'http_500',
  'http_502',
  'http_503',
  'http_504',
  'provider_unavailable',
  'provider_transient_retry_exhausted',
  'session_unrecoverable',
  'launch_failed',
]);

function maxCursor(events, fallback) {
  return events.reduce(
    (current, candidate) => Math.max(current, Number(candidate.cursor) || 0),
    fallback,
  );
}

function commanderHistory(state, historySummary) {
  return {
    ...historySummary,
    strategy_summary: state.strategy_summary ?? {},
    latest_guidance: state.latest_guidance ?? null,
  };
}

function targetKey(target) {
  return [
    target?.provider ?? '',
    target?.account ?? target?.account_id ?? '',
    target?.machine ?? target?.requested_machine_id ?? '',
  ].join('\u0000');
}

function declaredTargets(input) {
  const commander = input.runProfile?.commander;
  if (!commander?.primary) throw new Error('commander_primary_target_missing');
  return [commander.primary, ...(commander.fallbacks ?? [])];
}

function humanReviewDecision(input, reason) {
  return {
    kind: 'continue',
    decision: {
      phase: input.defaultDecision.phase,
      action: 'wait:human_review',
      reason,
    },
  };
}

function isFailoverEligible(attempt) {
  return ['failed', 'cancelled'].includes(attempt?.status)
    && INFRASTRUCTURE_FAILURE_CLASSES.has(attempt?.failure_class)
    && COMMANDER_FAILOVER_CODES.has(attempt?.error_code);
}

function requireDependency(value, name, method) {
  if (!value || typeof value[method] !== 'function') {
    throw new Error(`createCommanderCoordinator requires ${name}.${method}`);
  }
}

export function createCommanderCoordinator({
  commanderStore,
  eventStore,
  actorInbox,
  attemptStore,
  appendDecision,
  nextHop,
  now,
}) {
  requireDependency(commanderStore, 'commanderStore', 'ensureRun');
  requireDependency(commanderStore, 'commanderStore', 'get');
  requireDependency(commanderStore, 'commanderStore', 'updateMemory');
  requireDependency(commanderStore, 'commanderStore', 'advanceCursor');
  requireDependency(eventStore, 'eventStore', 'list');
  requireDependency(actorInbox, 'actorInbox', 'list');
  requireDependency(attemptStore, 'attemptStore', 'getLatestCommanderAttempt');
  requireDependency(
    attemptStore,
    'attemptStore',
    'listCommanderFailoverLineage',
  );
  if (typeof appendDecision !== 'function') {
    throw new Error('createCommanderCoordinator requires appendDecision');
  }
  if (typeof nextHop !== 'function') {
    throw new Error('createCommanderCoordinator requires nextHop');
  }
  if (typeof now !== 'function') {
    throw new Error('createCommanderCoordinator requires now');
  }

  async function appendCommanderDecision(input, {
    action,
    gateVerdict,
    attemptId,
    reasonCode = null,
    directive = null,
  }) {
    const hop = await nextHop(input.run.id);
    await appendDecision({
      runId: input.run.id,
      hop,
      observed: {
        commander_attempt_id: attemptId,
        event_cursor: directive?.event_cursor ?? null,
      },
      derivedPhase: input.defaultDecision.phase,
      gateVerdict,
      action,
      detail: {
        attempt_id: attemptId,
        ...(reasonCode ? { reason_code: reasonCode } : {}),
        ...(directive ? { directive } : {}),
      },
    });
    return hop;
  }

  async function actorMessages(runId) {
    const afterCursor = typeof actorInbox.getCursor === 'function'
      ? await actorInbox.getCursor(runId, 'commander')
      : 0;
    return actorInbox.list({
      runId,
      actorKey: 'commander',
      afterCursor,
      limit: 200,
    });
  }

  async function createDispatch(input, currentState, {
    events,
    reasons,
    targets,
    logicalCycleId = null,
    retryOfAttemptId = null,
    restartReason = null,
  }) {
    const [target] = targets;
    if (!target) throw new Error('commander_dispatch_target_missing');
    const attemptId = randomUUID();
    const bundle = buildCommanderBundle({
      runId: input.run.id,
      commanderAttemptId: attemptId,
      state: currentState,
      runProfile: input.runProfile,
      objective: input.objective,
      observed: input.observed,
      historySummary: commanderHistory(currentState, input.historySummary),
      newEvents: events,
      actorMessages: await actorMessages(input.run.id),
      activeRisks: currentState.active_risks ?? [],
      budgets: input.budgets,
      allowedActions: input.allowedActions,
    });

    return {
      kind: 'dispatch',
      action: 'spawn:commander',
      context: {
        target,
        candidate_targets: targets,
        bundle,
        wakeup_reasons: reasons,
        logical_cycle_id: logicalCycleId
          ?? `commander-wakeup:${bundle.event_cursor}`,
        ...(retryOfAttemptId
          ? { retry_of_attempt_id: retryOfAttemptId }
          : {}),
        ...(restartReason ? { restart_reason: restartReason } : {}),
        requested_at: now().toISOString(),
      },
    };
  }

  async function dispatchFor(input, currentState, newEvents) {
    const wakeup = classifyCommanderWakeup({
      runId: input.run.id,
      stateCursor: currentState.event_cursor,
      events: newEvents,
      defaultDecision: input.defaultDecision,
    });
    if (!wakeup.wake) {
      return { kind: 'continue', decision: input.defaultDecision };
    }
    return createDispatch(input, currentState, {
      events: wakeup.events,
      reasons: wakeup.reasons,
      targets: declaredTargets(input),
    });
  }

  async function stopForHuman(input, currentState, newEvents, reason) {
    const stopped = await commanderStore.updateMemory(input.run.id, {
      expectedCursor: currentState.event_cursor,
      status: 'failed',
    });
    if (!stopped) return { kind: 'wait', reason: 'commander_cursor_conflict' };
    const nextCursor = maxCursor(newEvents, currentState.event_cursor);
    const advanced = await commanderStore.advanceCursor(input.run.id, {
      expectedCursor: currentState.event_cursor,
      nextCursor,
    });
    if (!advanced) return { kind: 'wait', reason: 'commander_cursor_conflict' };
    return humanReviewDecision(input, reason);
  }

  async function failoverFrom(input, currentState, latestAttempt, newEvents) {
    if (currentState.status === 'failed') {
      return humanReviewDecision(input, 'commander_failover_exhausted');
    }
    if (!isFailoverEligible(latestAttempt)) {
      const reason = latestAttempt.failure_class === 'semantic_refusal'
        ? 'commander_semantic_refusal'
        : 'commander_failure_not_failover_eligible';
      return stopForHuman(input, currentState, newEvents, reason);
    }

    const logicalCycleId = latestAttempt.logical_cycle_id;
    if (!logicalCycleId) {
      return stopForHuman(
        input,
        currentState,
        newEvents,
        'commander_failover_lineage_missing',
      );
    }
    const lineage = await attemptStore.listCommanderFailoverLineage(
      input.run.id,
      logicalCycleId,
    );
    const attemptedTargets = new Set(lineage.map(targetKey));
    const targets = declaredTargets(input);
    const currentIndex = targets.findIndex(
      (target) => targetKey(target) === targetKey(latestAttempt),
    );
    const candidates = targets
      .slice(currentIndex < 0 ? targets.length : currentIndex + 1)
      .filter((target) => !attemptedTargets.has(targetKey(target)));

    if (candidates.length === 0) {
      const authoritativeHop = await appendCommanderDecision(input, {
        action: 'commander.failover_completed',
        gateVerdict: 'deny:all_execution_targets_exhausted',
        attemptId: latestAttempt.id,
        reasonCode: 'all_execution_targets_exhausted',
      });
      const stopped = await stopForHuman(
        input,
        currentState,
        newEvents,
        'commander_failover_exhausted',
      );
      return {
        ...stopped,
        authoritative_hop: authoritativeHop,
      };
    }

    const authoritativeHop = await appendCommanderDecision(input, {
      action: 'commander.failover_started',
      gateVerdict: 'allow',
      attemptId: latestAttempt.id,
      reasonCode: latestAttempt.error_code,
    });
    const dispatch = await createDispatch(input, currentState, {
      events: newEvents,
      reasons: [`commander_failover:${latestAttempt.error_code}`],
      targets: candidates,
      logicalCycleId,
      retryOfAttemptId: latestAttempt.id,
      restartReason: `commander_failover:${latestAttempt.error_code}`,
    });
    return {
      ...dispatch,
      authoritative_hop: authoritativeHop,
    };
  }

  async function reconcile(input) {
    if (input.commanderMode !== 'hybrid') return { kind: 'bypass' };
    const runId = input.run?.id;
    if (!runId) throw new Error('commander_run_id_missing');

    await commanderStore.ensureRun({ runId });
    const currentState = await commanderStore.get(runId);
    if (!currentState || currentState.run_id !== runId) {
      throw new Error('commander_state_missing');
    }

    const latestAttempt = await attemptStore.getLatestCommanderAttempt(runId);
    if (latestAttempt && ACTIVE_ATTEMPT_STATUSES.has(latestAttempt.status)) {
      return {
        kind: 'wait',
        reason: 'commander_attempt_inflight',
        attempt_id: latestAttempt.id,
      };
    }

    const newEvents = await eventStore.list(runId, {
      afterCursor: currentState.event_cursor,
      limit: 200,
    });
    if (!latestAttempt) {
      return dispatchFor(input, currentState, newEvents);
    }
    const directive = latestAttempt.result?.decision ?? null;
    if (latestAttempt.status !== 'completed' || !directive) {
      return failoverFrom(input, currentState, latestAttempt, newEvents);
    }

    const bundleCursor = Number(
      latestAttempt.task_bundle?.inputs?.commander_bundle?.event_cursor,
    );
    if (
      !Number.isSafeInteger(bundleCursor)
      || bundleCursor < 0
      || currentState.event_cursor > bundleCursor
    ) {
      return dispatchFor(input, currentState, newEvents);
    }

    const staleEvents = materialEventsAfter({
      runId,
      bundleCursor,
      events: newEvents,
      commanderAttemptId: latestAttempt.id,
    });
    const nextCursor = maxCursor(newEvents, currentState.event_cursor);
    if (staleEvents.length > 0) {
      const authoritativeHop = await appendCommanderDecision(input, {
        action: 'commander.directive_rejected',
        gateVerdict: 'deny:stale_event_cursor',
        attemptId: latestAttempt.id,
        reasonCode: 'stale_event_cursor',
        directive,
      });
      const replacement = await dispatchFor(input, currentState, staleEvents);
      const advanced = await commanderStore.advanceCursor(runId, {
        expectedCursor: currentState.event_cursor,
        nextCursor,
      });
      if (!advanced) {
        return { kind: 'wait', reason: 'commander_cursor_conflict' };
      }
      return {
        ...replacement,
        authoritative_hop: authoritativeHop,
      };
    }

    let authoritativeHop = null;
    if (
      latestAttempt.attempt_kind === 'retry'
      || latestAttempt.retry_of_attempt_id
    ) {
      authoritativeHop = await appendCommanderDecision(input, {
        action: 'commander.failover_completed',
        gateVerdict: 'allow',
        attemptId: latestAttempt.id,
      });
    }
    await commanderStore.updateMemory(runId, {
      expectedCursor: currentState.event_cursor,
      provider: latestAttempt.provider,
      accountId: latestAttempt.account_id,
      providerSessionId: latestAttempt.provider_session_id,
      status: 'ready',
    });
    const advanced = await commanderStore.advanceCursor(runId, {
      expectedCursor: currentState.event_cursor,
      nextCursor,
    });
    if (!advanced) {
      return { kind: 'wait', reason: 'commander_cursor_conflict' };
    }
    return {
      kind: 'control',
      decision: directive,
      attempt_id: latestAttempt.id,
      event_cursor: bundleCursor,
      ...(authoritativeHop == null
        ? {}
        : { authoritative_hop: authoritativeHop }),
    };
  }

  return Object.freeze({ reconcile });
}
