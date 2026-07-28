import { randomUUID } from 'node:crypto';

import { buildCommanderBundle } from './commander-bundle.js';
import {
  classifyCommanderWakeup,
  materialEventsAfter,
} from './commander-wakeup.js';

const ACTIVE_ATTEMPT_STATUSES = new Set(['queued', 'starting', 'running']);

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
    await appendDecision({
      runId: input.run.id,
      hop: await nextHop(input.run.id),
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

    const target = input.runProfile?.commander?.primary;
    if (!target) throw new Error('commander_primary_target_missing');
    const attemptId = randomUUID();
    const bundle = buildCommanderBundle({
      runId: input.run.id,
      commanderAttemptId: attemptId,
      state: currentState,
      runProfile: input.runProfile,
      objective: input.objective,
      observed: input.observed,
      historySummary: commanderHistory(currentState, input.historySummary),
      newEvents: wakeup.events,
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
        bundle,
        wakeup_reasons: wakeup.reasons,
        logical_cycle_id: `commander-wakeup:${bundle.event_cursor}`,
        requested_at: now().toISOString(),
      },
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

    const directive = latestAttempt.result?.decision ?? null;
    if (latestAttempt.status !== 'completed' || !directive) {
      return {
        kind: 'wait',
        reason: 'commander_attempt_terminal_without_directive',
        attempt_id: latestAttempt.id,
      };
    }

    const staleEvents = materialEventsAfter({
      runId,
      bundleCursor,
      events: newEvents,
      commanderAttemptId: latestAttempt.id,
    });
    const nextCursor = maxCursor(newEvents, currentState.event_cursor);
    if (staleEvents.length > 0) {
      await appendCommanderDecision(input, {
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
      return replacement;
    }

    await appendCommanderDecision(input, {
      action: 'commander.directive_accepted',
      gateVerdict: 'allow',
      attemptId: latestAttempt.id,
      directive,
    });
    await commanderStore.updateMemory(runId, {
      expectedCursor: currentState.event_cursor,
      provider: latestAttempt.provider,
      accountId: latestAttempt.account_id,
      providerSessionId: latestAttempt.provider_session_id,
      latestGuidance: directive.guidance
        ? { text: directive.guidance }
        : undefined,
      status: 'ready',
    });
    const advanced = await commanderStore.advanceCursor(runId, {
      expectedCursor: currentState.event_cursor,
      nextCursor,
    });
    if (!advanced) {
      return { kind: 'wait', reason: 'commander_cursor_conflict' };
    }
    return { kind: 'control', decision: directive };
  }

  return Object.freeze({ reconcile });
}
