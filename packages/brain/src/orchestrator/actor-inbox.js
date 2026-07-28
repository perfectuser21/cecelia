import { ACTOR_KEYS, parseActorMessage } from './commander-contract.js';
import { createRunEventStore } from './run-event-store.js';

const DELIVERY_EVENT_VERSION = Object.freeze({
  accepted: 0,
  delivered: 1,
  acked: 2,
  rejected: 3,
});

function requireActorKey(actorKey) {
  if (!ACTOR_KEYS.includes(actorKey)) throw new Error('actor_key_invalid');
}

function normalizeMessage(row) {
  if (!row) return null;
  return {
    ...row,
    message_cursor: Number(row.message_cursor),
    event_cursor: Number(row.event_cursor),
    token_estimate: Number(row.token_estimate),
  };
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function appendDeliveryEvent(client, message, status, rejectionCode = null) {
  await createRunEventStore(client).append({
    runId: message.run_id,
    eventType: `actor_message.${status}`,
    sourceType: 'actor_message_delivery',
    sourceId: message.message_id,
    sourceVersion: DELIVERY_EVENT_VERSION[status],
    payload: {
      message_id: message.message_id,
      sender_role: message.sender_role,
      recipient_role: message.recipient_role,
      status,
      ...(rejectionCode ? { rejection_code: rejectionCode } : {}),
    },
  });
}

async function lockAddressedDelivery(client, { runId, actorKey, messageId }) {
  const { rows } = await client.query(
    `SELECT m.*,d.status AS delivery_status,d.rejection_code
       FROM harness_actor_messages m
       JOIN harness_actor_deliveries d ON d.message_id=m.message_id
      WHERE m.run_id=$1
        AND m.message_id=$2
        AND m.recipient_role=$3
      FOR UPDATE OF d`,
    [runId, messageId, actorKey],
  );
  if (!rows[0]) throw new Error('actor_message_not_addressed');
  return normalizeMessage(rows[0]);
}

export function createActorInbox(
  pool,
  { estimateTokens = (value) => Math.ceil(JSON.stringify(value).length / 4) } = {},
) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('createActorInbox requires a PostgreSQL pool');
  }
  if (typeof estimateTokens !== 'function') {
    throw new Error('estimateTokens must be a function');
  }

  return Object.freeze({
    async send(input) {
      const message = parseActorMessage(input);
      const tokenEstimate = estimateTokens({
        message_type: message.message_type,
        payload: message.payload,
        evidence_refs: message.evidence_refs,
      });
      if (!Number.isSafeInteger(tokenEstimate) || tokenEstimate < 0) {
        throw new Error('actor_token_estimate_invalid');
      }

      return withTransaction(pool, async (client) => {
        const stateResult = await client.query(
          `SELECT message_count,message_token_count,message_budget,message_token_budget
             FROM harness_commander_state
            WHERE run_id=$1
            FOR UPDATE`,
          [message.run_id],
        );
        const state = stateResult.rows[0];
        if (!state) throw new Error('commander_state_missing');

        const replayResult = await client.query(
          `SELECT m.*,d.status AS delivery_status,d.rejection_code
             FROM harness_actor_messages m
             JOIN harness_actor_deliveries d ON d.message_id=m.message_id
            WHERE m.run_id=$1
              AND m.dedupe_key=$2`,
          [message.run_id, message.dedupe_key],
        );
        if (replayResult.rows[0]) return normalizeMessage(replayResult.rows[0]);

        if (Number(state.message_count) >= Number(state.message_budget)) {
          throw new Error('actor_message_budget_exceeded');
        }
        if (Number(state.message_token_count) + tokenEstimate > Number(state.message_token_budget)) {
          throw new Error('actor_token_budget_exceeded');
        }

        if (message.source_attempt_id) {
          const source = await client.query(
            `SELECT role
               FROM harness_attempts
              WHERE id=$1
                AND run_id=$2`,
            [message.source_attempt_id, message.run_id],
          );
          if (!source.rows[0] || source.rows[0].role !== message.sender_role) {
            throw new Error('actor_source_attempt_not_owned');
          }
        } else if (message.sender_role !== 'commander') {
          throw new Error('actor_source_attempt_required');
        }

        await createRunEventStore(client).assertEvidenceRefs(
          message.run_id,
          message.evidence_refs,
        );

        const inserted = await client.query(
          `INSERT INTO harness_actor_messages (
             message_id,run_id,sender_role,recipient_role,thread_id,correlation_id,
             source_attempt_id,event_cursor,message_type,payload,evidence_refs,
             dedupe_key,token_estimate
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13
           )
           ON CONFLICT (run_id,dedupe_key) DO NOTHING
           RETURNING *`,
          [
            message.message_id,
            message.run_id,
            message.sender_role,
            message.recipient_role,
            message.thread_id,
            message.correlation_id,
            message.source_attempt_id,
            message.event_cursor,
            message.message_type,
            JSON.stringify(message.payload),
            JSON.stringify(message.evidence_refs),
            message.dedupe_key,
            tokenEstimate,
          ],
        );

        let stored = inserted.rows[0];
        if (!stored) {
          const winner = await client.query(
            'SELECT * FROM harness_actor_messages WHERE run_id=$1 AND dedupe_key=$2',
            [message.run_id, message.dedupe_key],
          );
          return normalizeMessage(winner.rows[0]);
        }

        await client.query(
          `INSERT INTO harness_actor_deliveries (message_id,status)
           VALUES ($1,'accepted')`,
          [stored.message_id],
        );
        await client.query(
          `UPDATE harness_commander_state
              SET message_count=message_count+1,
                  message_token_count=message_token_count+$2,
                  updated_at=NOW()
            WHERE run_id=$1`,
          [message.run_id, tokenEstimate],
        );
        stored = normalizeMessage(stored);
        await appendDeliveryEvent(client, stored, 'accepted');
        return { ...stored, delivery_status: 'accepted', rejection_code: null };
      });
    },

    async list({ runId, actorKey, afterCursor = 0, limit = 100 }) {
      requireActorKey(actorKey);
      const after = Number.isSafeInteger(Number(afterCursor)) && Number(afterCursor) >= 0
        ? Number(afterCursor)
        : 0;
      const requestedLimit = Number(limit);
      const pageSize = Number.isSafeInteger(requestedLimit)
        ? Math.min(200, Math.max(1, requestedLimit))
        : 100;
      const { rows } = await pool.query(
        `SELECT m.*,d.status AS delivery_status,d.rejection_code,
                d.delivered_at,d.acked_at,d.rejected_at
           FROM harness_actor_messages m
           JOIN harness_actor_deliveries d ON d.message_id=m.message_id
          WHERE m.run_id=$1
            AND m.recipient_role=$2
            AND m.message_cursor>$3
          ORDER BY m.message_cursor ASC
          LIMIT $4`,
        [runId, actorKey, after, pageSize],
      );
      return rows.map(normalizeMessage);
    },

    async markDelivered({ runId, actorKey, messageId }) {
      requireActorKey(actorKey);
      return withTransaction(pool, async (client) => {
        const message = await lockAddressedDelivery(client, { runId, actorKey, messageId });
        if (message.delivery_status === 'rejected') throw new Error('actor_message_rejected');
        if (message.delivery_status === 'acked') return message;
        const { rows } = await client.query(
          `UPDATE harness_actor_deliveries
              SET status='delivered',
                  delivered_at=COALESCE(delivered_at,NOW()),
                  updated_at=NOW()
            WHERE message_id=$1
            RETURNING *`,
          [messageId],
        );
        await appendDeliveryEvent(client, message, 'delivered');
        return { ...message, ...rows[0], delivery_status: rows[0].status };
      });
    },

    async reject({ runId, actorKey, messageId, rejectionCode }) {
      requireActorKey(actorKey);
      if (typeof rejectionCode !== 'string' || rejectionCode.length < 1 || rejectionCode.length > 256) {
        throw new Error('actor_rejection_code_invalid');
      }
      return withTransaction(pool, async (client) => {
        const message = await lockAddressedDelivery(client, { runId, actorKey, messageId });
        if (message.delivery_status === 'acked') throw new Error('actor_message_already_acked');
        if (message.delivery_status === 'rejected') return message;
        const { rows } = await client.query(
          `UPDATE harness_actor_deliveries
              SET status='rejected',
                  rejection_code=$2,
                  rejected_at=COALESCE(rejected_at,NOW()),
                  updated_at=NOW()
            WHERE message_id=$1
            RETURNING *`,
          [messageId, rejectionCode],
        );
        await appendDeliveryEvent(client, message, 'rejected', rejectionCode);
        return { ...message, ...rows[0], delivery_status: rows[0].status };
      });
    },

    async ack({ runId, actorKey, messageId }) {
      requireActorKey(actorKey);
      return withTransaction(pool, async (client) => {
        const message = await lockAddressedDelivery(client, { runId, actorKey, messageId });
        if (message.delivery_status === 'rejected') throw new Error('actor_message_rejected');
        if (message.delivery_status !== 'acked') {
          await client.query(
            `UPDATE harness_actor_deliveries
                SET status='acked',
                    delivered_at=COALESCE(delivered_at,NOW()),
                    acked_at=COALESCE(acked_at,NOW()),
                    updated_at=NOW()
              WHERE message_id=$1`,
            [messageId],
          );
          await appendDeliveryEvent(client, message, 'acked');
        }
        await client.query(
          `INSERT INTO harness_actor_cursors (
             run_id,actor_key,last_message_cursor,updated_at
           ) VALUES ($1,$2,$3,NOW())
           ON CONFLICT (run_id,actor_key) DO UPDATE
             SET last_message_cursor=GREATEST(
                   harness_actor_cursors.last_message_cursor,
                   EXCLUDED.last_message_cursor
                 ),
                 updated_at=NOW()`,
          [runId, actorKey, message.message_cursor],
        );
        return { ...message, delivery_status: 'acked' };
      });
    },

    async getCursor(runId, actorKey) {
      requireActorKey(actorKey);
      const { rows } = await pool.query(
        `SELECT last_message_cursor
           FROM harness_actor_cursors
          WHERE run_id=$1
            AND actor_key=$2`,
        [runId, actorKey],
      );
      return rows[0] ? Number(rows[0].last_message_cursor) : 0;
    },
  });
}
