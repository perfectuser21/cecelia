import { MergeAuthorizationError } from './merge-authority.js';

function deny(code) {
  throw new MergeAuthorizationError(code);
}

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function sameOwnership(row, proof) {
  return row
    && row.run_id === proof.run_id
    && row.task_id === proof.task_id
    && row.repository === proof.repository
    && Number(row.pr_number) === proof.pr_number
    && row.pr_url === proof.pr_url
    && row.head_ref === proof.head_ref;
}

async function selectIntent(client, runId) {
  const { rows } = await client.query(
    `SELECT intent.id AS intent_id,
            intent.requested_head_sha,
            receipt.id AS confirmed_receipt
       FROM kernel_merge_effect_intents intent
       JOIN kernel_merge_authorizations authorization
         ON authorization.id = intent.authorization_id
       LEFT JOIN LATERAL (
         SELECT id
           FROM kernel_merge_effect_receipts
          WHERE intent_id = intent.id
            AND receipt_status = 'confirmed'
          ORDER BY observed_at DESC
          LIMIT 1
       ) receipt ON TRUE
      WHERE intent.run_id = $1
      ORDER BY intent.created_at DESC
      LIMIT 1`,
    [runId],
  );
  return rows[0] ?? null;
}

export function createPostgresMergeEffectStore(pool) {
  return Object.freeze({
    async withRunLock(runId, callback) {
      const client = await pool.connect();
      let locked = false;
      try {
        await client.query(
          'SELECT pg_advisory_lock(hashtextextended($1::text, 0))',
          [runId],
        );
        locked = true;
        return await callback(client);
      } finally {
        try {
          if (locked) {
            await client.query(
              'SELECT pg_advisory_unlock(hashtextextended($1::text, 0)) AS unlocked',
              [runId],
            );
          }
        } finally {
          client.release();
        }
      }
    },

    async loadEvidence(client, { runId, taskId }) {
      const runResult = await client.query(
        `SELECT id, current_task_id, pr_url
           FROM initiative_runs
          WHERE id = $1
            AND orchestrator_version = 'v2'`,
        [runId],
      );
      const run = runResult.rows[0];
      if (!run) deny('run_authority_invalid');

      const taskResult = await client.query(
        'SELECT id, payload FROM tasks WHERE id = $1',
        [taskId],
      );
      const task = taskResult.rows[0];
      if (!task) deny('task_authority_invalid');

      const logResult = await client.query(
        `SELECT hop, action, observed, derived_phase, gate_verdict, detail, created_at
           FROM orchestrator_decision_log
          WHERE run_id = $1
          ORDER BY hop`,
        [runId],
      );

      return {
        run,
        task: { ...task, payload: parsePayload(task.payload) },
        decisionLog: logResult.rows,
      };
    },

    async findIntent(client, { runId }) {
      return selectIntent(client, runId);
    },

    async createAuthorizationIntent(client, { proof, currentPr }) {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO kernel_pr_ownership
             (run_id, task_id, repository, pr_number, pr_url, head_ref)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (run_id) DO NOTHING`,
          [
            proof.run_id,
            proof.task_id,
            proof.repository,
            proof.pr_number,
            proof.pr_url,
            proof.head_ref,
          ],
        );
        const ownershipResult = await client.query(
          'SELECT * FROM kernel_pr_ownership WHERE run_id = $1',
          [proof.run_id],
        );
        const ownership = ownershipResult.rows[0];
        if (!sameOwnership(ownership, proof)) deny('pr_ownership_conflict');

        await client.query(
          `INSERT INTO kernel_pr_head_observations
             (ownership_id, run_id, head_sha, head_ref, pr_state, ci_status, merged, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            ownership.id,
            proof.run_id,
            currentPr.head_sha,
            currentPr.head_ref,
            currentPr.state,
            currentPr.ci,
            currentPr.merged,
            JSON.stringify(currentPr),
          ],
        );

        await client.query(
          `INSERT INTO kernel_merge_authorizations
             (ownership_id, run_id, task_id, repository, pr_number, pr_url,
              head_ref, head_sha, policy_version, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
           ON CONFLICT (ownership_id, head_sha, policy_version) DO NOTHING`,
          [
            ownership.id,
            proof.run_id,
            proof.task_id,
            proof.repository,
            proof.pr_number,
            proof.pr_url,
            proof.head_ref,
            proof.head_sha,
            proof.policy_version,
            JSON.stringify(proof),
          ],
        );
        const authorizationResult = await client.query(
          `SELECT id FROM kernel_merge_authorizations
            WHERE ownership_id = $1
              AND head_sha = $2
              AND policy_version = $3`,
          [ownership.id, proof.head_sha, proof.policy_version],
        );
        const authorization = authorizationResult.rows[0];
        if (!authorization) deny('merge_authorization_persist_failed');

        await client.query(
          `INSERT INTO kernel_merge_effect_intents
             (authorization_id, run_id, target, requested_head_sha)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (authorization_id) DO NOTHING`,
          [authorization.id, proof.run_id, proof.pr_url, proof.head_sha],
        );
        const intent = await selectIntent(client, proof.run_id);
        if (!intent) deny('merge_intent_persist_failed');

        await client.query('COMMIT');
        return intent;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },

    async appendReceipt(client, receipt) {
      const params = [
        receipt.intent_id,
        receipt.receipt_status,
        receipt.observed_head_sha,
        receipt.merged,
        JSON.stringify(receipt.evidence ?? {}),
      ];
      if (receipt.receipt_status === 'confirmed') {
        await client.query(
          `INSERT INTO kernel_merge_effect_receipts
             (intent_id, receipt_status, observed_head_sha, merged, evidence)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (intent_id) WHERE receipt_status = 'confirmed' DO NOTHING`,
          params,
        );
      } else {
        await client.query(
          `INSERT INTO kernel_merge_effect_receipts
             (intent_id, receipt_status, observed_head_sha, merged, evidence)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          params,
        );
      }
      return receipt;
    },
  });
}

export const __test__ = {
  parsePayload,
  sameOwnership,
};
