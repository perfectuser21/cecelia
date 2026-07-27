import { assertNoSecretMaterial } from './commander-contract.js';

const EVENT_REF = /^event:([1-9]\d*)$/;
const ATTEMPT_REF = /^attempt:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createRunEventStore requires a PostgreSQL pool');
  }
}

function normalizeEvent(row) {
  if (!row) return null;
  return {
    ...row,
    cursor: Number(row.cursor),
    source_version: row.source_version === undefined ? undefined : Number(row.source_version),
  };
}

function boundedInteger(value, { fallback, min, max }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function createRunEventStore(pool) {
  requirePool(pool);

  return Object.freeze({
    async append({
      runId,
      eventType,
      sourceType,
      sourceId,
      sourceVersion,
      payload = {},
      occurredAt = null,
    }) {
      if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0) {
        throw new Error('source_version_invalid');
      }
      assertNoSecretMaterial(payload);
      const { rows } = await pool.query(
        `SELECT append_harness_run_event(
           $1,$2,$3,$4,$5,$6::jsonb,COALESCE($7::timestamptz,NOW())
         ) AS cursor`,
        [
          runId,
          eventType,
          sourceType,
          String(sourceId),
          sourceVersion,
          JSON.stringify(payload),
          occurredAt,
        ],
      );
      return { cursor: Number(rows[0].cursor) };
    },

    async list(runId, { afterCursor = 0, limit = 100 } = {}) {
      const after = boundedInteger(afterCursor, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
      const pageSize = boundedInteger(limit, { fallback: 100, min: 1, max: 200 });
      const { rows } = await pool.query(
        `SELECT run_id,cursor,event_type,source_type,source_id,source_version,
                payload,occurred_at,created_at
           FROM harness_run_events
          WHERE run_id=$1
            AND cursor>$2
          ORDER BY cursor ASC
          LIMIT $3`,
        [runId, after, pageSize],
      );
      return rows.map(normalizeEvent);
    },

    async latestCursor(runId) {
      const { rows } = await pool.query(
        'SELECT COALESCE(MAX(cursor),0) AS cursor FROM harness_run_events WHERE run_id=$1',
        [runId],
      );
      return Number(rows[0].cursor);
    },

    async assertEvidenceRefs(runId, evidenceRefs) {
      if (!Array.isArray(evidenceRefs) || evidenceRefs.length > 128) {
        throw new Error('invalid_evidence_ref');
      }
      const eventCursors = new Set();
      const attemptIds = new Set();
      for (const reference of evidenceRefs) {
        const eventMatch = EVENT_REF.exec(reference);
        const attemptMatch = ATTEMPT_REF.exec(reference);
        if (eventMatch) {
          eventCursors.add(Number(eventMatch[1]));
        } else if (attemptMatch) {
          attemptIds.add(attemptMatch[1].toLowerCase());
        } else {
          throw new Error('invalid_evidence_ref');
        }
      }

      if (eventCursors.size > 0) {
        const { rows } = await pool.query(
          `SELECT cursor
             FROM harness_run_events
            WHERE run_id=$1
              AND cursor=ANY($2::bigint[])`,
          [runId, [...eventCursors]],
        );
        const owned = new Set(rows.map((row) => Number(row.cursor)));
        if ([...eventCursors].some((cursor) => !owned.has(cursor))) {
          throw new Error('evidence_not_owned');
        }
      }

      if (attemptIds.size > 0) {
        const { rows } = await pool.query(
          `SELECT id
             FROM harness_attempts
            WHERE run_id=$1
              AND id=ANY($2::uuid[])`,
          [runId, [...attemptIds]],
        );
        const owned = new Set(rows.map((row) => String(row.id).toLowerCase()));
        if ([...attemptIds].some((id) => !owned.has(id))) {
          throw new Error('evidence_not_owned');
        }
      }
      return true;
    },
  });
}
