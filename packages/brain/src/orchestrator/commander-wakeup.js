const MATERIAL_EVENT_REASONS = Object.freeze({
  'run.created': 'run_created',
  'run.phase_changed': 'phase_changed',
  'run.paused': 'run_terminal',
  'run.failed': 'run_terminal',
  'run.completed': 'run_terminal',
  'attempt.completed': 'attempt_terminal',
  'attempt.failed': 'attempt_terminal',
  'attempt.expired': 'attempt_terminal',
  'actor.message': 'actor_message',
});

const COMMANDER_CONTROL_EVENTS = new Set([
  'commander.directive_proposed',
  'commander.directive_accepted',
  'commander.directive_rejected',
  'commander.failover_started',
  'commander.failover_completed',
]);

const COMMANDER_ATTEMPT_LIFECYCLE = new Set([
  'attempt.starting',
  'attempt.running',
  'attempt.heartbeat',
  'attempt.completed',
  'attempt.failed',
  'attempt.expired',
]);

const PRE_TERMINAL_ACTIONS = new Set([
  'mark_failed',
  'report',
  'exit',
]);

function requireCursor(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field}_invalid`);
  }
}

function orderedRunEvents({ runId, afterCursor, events }) {
  requireCursor(afterCursor, 'event_cursor');
  if (!Array.isArray(events)) throw new Error('events_invalid');
  return events
    .filter((candidate) => (
      candidate?.run_id === runId
      && Number.isSafeInteger(candidate.cursor)
      && candidate.cursor > afterCursor
    ))
    .sort((left, right) => (
      left.cursor - right.cursor
      || String(left.event_type).localeCompare(String(right.event_type))
      || String(left.source_id).localeCompare(String(right.source_id))
    ));
}

function isCommanderLifecycle(event) {
  return event?.source_type === 'harness_attempt'
    && event?.payload?.role === 'commander'
    && COMMANDER_ATTEMPT_LIFECYCLE.has(event.event_type);
}

function materialReason(event) {
  if (COMMANDER_CONTROL_EVENTS.has(event.event_type)) return null;
  if (isCommanderLifecycle(event)) return null;
  return MATERIAL_EVENT_REASONS[event.event_type] ?? null;
}

export function classifyCommanderWakeup({
  runId,
  stateCursor,
  events,
  defaultDecision,
}) {
  const ordered = orderedRunEvents({
    runId,
    afterCursor: stateCursor,
    events,
  });
  const material = [];
  const reasons = [];

  for (const candidate of ordered) {
    const reason = materialReason(candidate);
    if (!reason) continue;
    material.push(candidate);
    if (!reasons.includes(reason)) reasons.push(reason);
  }

  const action = defaultDecision?.action;
  if (action === 'merge_pr' && !reasons.includes('kernel_pre_merge')) {
    reasons.push('kernel_pre_merge');
  } else if (
    PRE_TERMINAL_ACTIONS.has(action)
    && !reasons.includes('kernel_pre_terminal')
  ) {
    reasons.push('kernel_pre_terminal');
  }

  return {
    wake: reasons.length > 0,
    reasons,
    events: material,
  };
}

export function materialEventsAfter({
  runId,
  bundleCursor,
  events,
  commanderAttemptId,
}) {
  return orderedRunEvents({
    runId,
    afterCursor: bundleCursor,
    events,
  }).filter((candidate) => {
    const ownLifecycle = candidate.source_type === 'harness_attempt'
      && candidate.source_id === commanderAttemptId
      && COMMANDER_ATTEMPT_LIFECYCLE.has(candidate.event_type);
    if (ownLifecycle) return false;
    if (COMMANDER_CONTROL_EVENTS.has(candidate.event_type)) return false;
    return MATERIAL_EVENT_REASONS[candidate.event_type] != null;
  });
}

export const __test__ = {
  MATERIAL_EVENT_REASONS,
  COMMANDER_CONTROL_EVENTS,
  COMMANDER_ATTEMPT_LIFECYCLE,
};
