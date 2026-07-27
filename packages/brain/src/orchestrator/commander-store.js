import { assertNoSecretMaterial } from './commander-contract.js';

const COMMANDER_STATUSES = new Set([
  'idle',
  'ready',
  'running',
  'paused',
  'failed',
  'completed',
]);

function requirePool(pool, caller) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error(`${caller} requires a PostgreSQL pool`);
  }
}

function requireCursor(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field}_invalid`);
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    ...row,
    event_cursor: Number(row.event_cursor),
    message_count: Number(row.message_count),
    message_token_count: Number(row.message_token_count),
    message_budget: Number(row.message_budget),
    message_token_budget: Number(row.message_token_budget),
  };
}

export function createCommanderStore(pool) {
  requirePool(pool, 'createCommanderStore');

  return Object.freeze({
    async ensureRun({
      runId,
      messageBudget = 256,
      messageTokenBudget = 100_000,
    }) {
      if (!Number.isSafeInteger(messageBudget) || messageBudget <= 0) {
        throw new Error('message_budget_invalid');
      }
      if (!Number.isSafeInteger(messageTokenBudget) || messageTokenBudget <= 0) {
        throw new Error('message_token_budget_invalid');
      }
      const { rows } = await pool.query(
        `WITH inserted AS (
           INSERT INTO harness_commander_state (
             run_id, message_budget, message_token_budget
           ) VALUES ($1,$2,$3)
           ON CONFLICT (run_id) DO NOTHING
           RETURNING *
         )
         SELECT * FROM inserted
         UNION ALL
         SELECT * FROM harness_commander_state WHERE run_id=$1
         LIMIT 1`,
        [runId, messageBudget, messageTokenBudget],
      );
      return normalizeRow(rows[0]);
    },

    async get(runId) {
      const { rows } = await pool.query(
        'SELECT * FROM harness_commander_state WHERE run_id=$1',
        [runId],
      );
      return normalizeRow(rows[0]);
    },

    async updateMemory(runId, {
      expectedCursor,
      provider,
      accountId,
      model,
      providerSessionId,
      strategySummary,
      activeRisks,
      latestGuidance,
      status,
    }) {
      requireCursor(expectedCursor, 'expected_cursor');
      if (status !== undefined && !COMMANDER_STATUSES.has(status)) {
        throw new Error('commander_status_invalid');
      }
      for (const value of [strategySummary, activeRisks, latestGuidance]) {
        if (value !== undefined) assertNoSecretMaterial(value);
      }
      const { rows } = await pool.query(
        `UPDATE harness_commander_state
            SET provider=COALESCE($3,provider),
                account_id=COALESCE($4,account_id),
                model=COALESCE($5,model),
                provider_session_id=COALESCE($6,provider_session_id),
                strategy_summary=COALESCE($7::jsonb,strategy_summary),
                active_risks=COALESCE($8::jsonb,active_risks),
                latest_guidance=COALESCE($9::jsonb,latest_guidance),
                status=COALESCE($10,status),
                updated_at=NOW()
          WHERE run_id=$1
            AND event_cursor=$2
          RETURNING *`,
        [
          runId,
          expectedCursor,
          provider ?? null,
          accountId ?? null,
          model ?? null,
          providerSessionId ?? null,
          strategySummary === undefined ? null : JSON.stringify(strategySummary),
          activeRisks === undefined ? null : JSON.stringify(activeRisks),
          latestGuidance === undefined ? null : JSON.stringify(latestGuidance),
          status ?? null,
        ],
      );
      return normalizeRow(rows[0]);
    },

    async advanceCursor(runId, { expectedCursor, nextCursor }) {
      requireCursor(expectedCursor, 'expected_cursor');
      requireCursor(nextCursor, 'next_cursor');
      if (nextCursor < expectedCursor) {
        throw new Error('commander_cursor_regression');
      }
      const { rows } = await pool.query(
        `UPDATE harness_commander_state
            SET event_cursor=$3,
                updated_at=NOW()
          WHERE run_id=$1
            AND event_cursor=$2
            AND $3 >= $2
          RETURNING *`,
        [runId, expectedCursor, nextCursor],
      );
      return normalizeRow(rows[0]);
    },
  });
}
