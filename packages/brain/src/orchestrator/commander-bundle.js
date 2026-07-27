import {
  assertNoSecretMaterial,
  parseCommanderBundle,
} from './commander-contract.js';

function requireCursor(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

export function buildCommanderBundle({
  runId,
  commanderAttemptId,
  state,
  runProfile,
  objective,
  observed,
  historySummary,
  newEvents,
  actorMessages,
  activeRisks,
  budgets,
  allowedActions,
}) {
  if (!state || state.run_id !== runId) {
    throw new Error('commander_bundle_run_mismatch');
  }
  requireCursor(state.event_cursor, 'commander_bundle_cursor_invalid');
  if (!Array.isArray(newEvents) || !Array.isArray(actorMessages)) {
    throw new Error('commander_bundle_collection_invalid');
  }

  let latestCursor = state.event_cursor;
  for (const event of newEvents) {
    if (event?.run_id !== runId) throw new Error('commander_bundle_run_mismatch');
    requireCursor(event.cursor, 'commander_bundle_cursor_invalid');
    if (event.cursor <= state.event_cursor) throw new Error('commander_bundle_stale_event');
    if (event.cursor <= latestCursor) throw new Error('commander_bundle_non_monotonic_events');
    latestCursor = event.cursor;
  }
  for (const message of actorMessages) {
    if (message?.run_id !== runId) throw new Error('commander_bundle_run_mismatch');
    requireCursor(message.event_cursor, 'commander_bundle_cursor_invalid');
    if (message.event_cursor > latestCursor) {
      throw new Error('commander_bundle_message_ahead_of_events');
    }
  }

  const bundle = {
    schema: 'commander-bundle/v1',
    run_id: runId,
    commander_attempt_id: commanderAttemptId,
    event_cursor: latestCursor,
    run_profile: runProfile,
    objective,
    observed,
    history_summary: historySummary,
    new_events: newEvents,
    actor_messages: actorMessages,
    active_risks: activeRisks,
    budgets,
    allowed_actions: allowedActions,
    output_schema: 'commander-directive/v1',
  };
  assertNoSecretMaterial(bundle);
  return parseCommanderBundle(bundle);
}
