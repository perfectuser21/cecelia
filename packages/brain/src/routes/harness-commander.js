import { Router } from 'express';
import { z } from 'zod';

import pool from '../db.js';
import { ACTOR_KEYS } from '../orchestrator/commander-contract.js';
import { createActorInbox } from '../orchestrator/actor-inbox.js';
import { createRunEventStore } from '../orchestrator/run-event-store.js';

const uuidSchema = z.uuid();
const PRIVATE_RESPONSE_KEY = /^(?:provider_session_id|task_bundle|result|callback_secret_hash|error_message|credentials?|prompt|raw_prompt)$/i;

function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_RESPONSE_KEY.test(key))
      .map(([key, nested]) => [key, publicValue(nested)]),
  );
}

function parseRunId(value) {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parsePage(query) {
  const afterText = query.after === undefined ? '0' : String(query.after);
  const limitText = query.limit === undefined ? '100' : String(query.limit);
  if (!/^\d+$/.test(afterText) || !/^\d+$/.test(limitText)) return null;
  const after = Number(afterText);
  const limit = Number(limitText);
  if (!Number.isSafeInteger(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    return null;
  }
  return { after, limit };
}

function commanderResponse(row) {
  return {
    run_id: row.run_id,
    commander_id: row.commander_id,
    commander_mode: row.commander_mode,
    provider: row.provider,
    account_id: row.account_id,
    model: row.model,
    event_cursor: Number(row.event_cursor),
    strategy_summary: publicValue(row.strategy_summary),
    active_risks: publicValue(row.active_risks),
    latest_guidance: publicValue(row.latest_guidance),
    status: row.status,
    message_count: Number(row.message_count),
    message_token_count: Number(row.message_token_count),
    updated_at: row.updated_at,
  };
}

function publicEvent(event) {
  return {
    run_id: event.run_id,
    cursor: event.cursor,
    event_type: event.event_type,
    source_type: event.source_type,
    source_id: event.source_id,
    source_version: event.source_version,
    payload: publicValue(event.payload),
    occurred_at: event.occurred_at,
    created_at: event.created_at,
  };
}

function publicMessage(message) {
  return {
    message_cursor: message.message_cursor,
    message_id: message.message_id,
    run_id: message.run_id,
    sender_role: message.sender_role,
    recipient_role: message.recipient_role,
    thread_id: message.thread_id,
    correlation_id: message.correlation_id,
    source_attempt_id: message.source_attempt_id,
    event_cursor: message.event_cursor,
    message_type: message.message_type,
    payload: publicValue(message.payload),
    evidence_refs: publicValue(message.evidence_refs),
    dedupe_key: message.dedupe_key,
    delivery_status: message.delivery_status,
    rejection_code: message.rejection_code,
    created_at: message.created_at,
    delivered_at: message.delivered_at,
    acked_at: message.acked_at,
    rejected_at: message.rejected_at,
  };
}

export function createHarnessCommanderRouter({ pool: databasePool }) {
  if (!databasePool || typeof databasePool.query !== 'function') {
    throw new Error('createHarnessCommanderRouter requires a PostgreSQL pool');
  }
  const router = Router();

  router.get('/runs/:runId/commander', async (req, res) => {
    const runId = parseRunId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'run_id_invalid' });
    try {
      const { rows } = await databasePool.query(
        `SELECT s.run_id,s.commander_id,r.commander_mode,s.provider,s.account_id,s.model,
                s.event_cursor,s.strategy_summary,s.active_risks,s.latest_guidance,
                s.status,s.message_count,s.message_token_count,s.updated_at
           FROM initiative_runs r
           JOIN harness_commander_state s ON s.run_id=r.id
          WHERE r.id=$1`,
        [runId],
      );
      if (!rows[0]) return res.status(404).json({ error: 'commander_state_not_found' });
      return res.json(commanderResponse(rows[0]));
    } catch {
      return res.status(500).json({ error: 'commander_state_query_failed' });
    }
  });

  router.get('/runs/:runId/events', async (req, res) => {
    const runId = parseRunId(req.params.runId);
    const page = parsePage(req.query);
    if (!runId || !page) return res.status(400).json({ error: 'commander_query_invalid' });
    try {
      const events = await createRunEventStore(databasePool).list(runId, {
        afterCursor: page.after,
        limit: page.limit,
      });
      return res.json({ events: events.map(publicEvent) });
    } catch {
      return res.status(500).json({ error: 'commander_events_query_failed' });
    }
  });

  router.get('/runs/:runId/actors/:actorKey/inbox', async (req, res) => {
    const runId = parseRunId(req.params.runId);
    const page = parsePage(req.query);
    const actorKey = req.params.actorKey;
    if (!runId || !page || !ACTOR_KEYS.includes(actorKey)) {
      return res.status(400).json({ error: 'actor_inbox_query_invalid' });
    }
    try {
      const messages = await createActorInbox(databasePool).list({
        runId,
        actorKey,
        afterCursor: page.after,
        limit: page.limit,
      });
      return res.json({ messages: messages.map(publicMessage) });
    } catch {
      return res.status(500).json({ error: 'actor_inbox_query_failed' });
    }
  });

  return router;
}

const harnessCommanderRouter = createHarnessCommanderRouter({ pool });

export default harnessCommanderRouter;
