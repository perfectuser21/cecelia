import {
  assertNoSecretMaterial,
  parseCommanderBundle,
} from './commander-contract.js';

function requireCursor(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

function actorMessageContract(message) {
  return {
    schema: 'harness-actor-message/v1',
    message_id: message.message_id,
    run_id: message.run_id,
    sender_role: message.sender_role,
    recipient_role: message.recipient_role,
    thread_id: message.thread_id,
    correlation_id: message.correlation_id,
    source_attempt_id: message.source_attempt_id ?? null,
    event_cursor: Number(message.event_cursor),
    message_type: message.message_type,
    payload: message.payload,
    evidence_refs: message.evidence_refs,
    dedupe_key: message.dedupe_key,
  };
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
  eventCursor = null,
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
  // 第 46 批（r80 案卷）：调用方可显式指定 bundle 游标（stale 替换派发传状态将推进到的
  // nextCursor）。material 事件的最大游标 < 全部事件的最大游标时，bundle 若只按事件算
  // 会天生落后状态游标，下一轮被当 stale 静默丢弃——确定性活锁发生器。只许向前不许倒拨。
  if (eventCursor != null) {
    requireCursor(eventCursor, 'commander_bundle_cursor_invalid');
    if (eventCursor < latestCursor) throw new Error('commander_bundle_cursor_behind_events');
    latestCursor = eventCursor;
  }
  const contractMessages = actorMessages.map(actorMessageContract);

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
    actor_messages: contractMessages,
    active_risks: activeRisks,
    budgets,
    allowed_actions: allowedActions,
    output_schema: 'commander-directive/v1',
  };
  assertNoSecretMaterial(bundle);
  return parseCommanderBundle(bundle);
}
