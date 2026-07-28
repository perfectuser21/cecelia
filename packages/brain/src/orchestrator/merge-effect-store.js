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
       JOIN kernel_merge_authorizations merge_auth
         ON merge_auth.id = intent.authorization_id
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
        `SELECT id, current_task_id, pr_url, contract_id
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
      const parsedTask = { ...task, payload: parsePayload(task.payload) };

      let contract = null;
      if (run.contract_id) {
        const contractResult = await client.query(
          `SELECT id, version, status, contract_content
             FROM initiative_contracts
            WHERE id = $1`,
          [run.contract_id],
        );
        contract = contractResult.rows[0] ?? null;
      }

      let productionReceipt = null;
      const behaviorVersion = parsedTask.payload.behavior_version;
      if (typeof behaviorVersion === 'string' && behaviorVersion.length > 0) {
        const receiptResult = await client.query(
          `SELECT id, receipt_status, behavior_version, contract_version,
                  contract_digest, path_class, production_head_sha,
                  deployed_at, expires_at
             FROM kernel_behavior_production_receipts
            WHERE behavior_version = $1
              AND receipt_status = 'confirmed'
            ORDER BY deployed_at DESC, id DESC
            LIMIT 1`,
          [behaviorVersion],
        );
        productionReceipt = receiptResult.rows[0] ?? null;
      }

      const logResult = await client.query(
        `SELECT hop, action, observed, derived_phase, gate_verdict, detail, created_at
           FROM orchestrator_decision_log
          WHERE run_id = $1
          ORDER BY hop`,
        [runId],
      );

      return {
        run,
        task: parsedTask,
        contract,
        productionReceipt,
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

        const risk = proof.post_diff_risk;
        const riskBindings = risk?.bindings ?? {};
        let riskAssessmentResult = await client.query(
          `INSERT INTO kernel_post_diff_risk_assessments
             (run_id, task_id, assessment_hop, head_sha, diff_hash,
              contract_version, contract_digest, behavior_version, path_class,
              risk_level, human_review_required, auto_eligible, policy_version,
              proof_expires_at, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
           ON CONFLICT (run_id, head_sha, diff_hash, contract_digest, policy_version)
           DO NOTHING
           RETURNING id`,
          [
            proof.run_id,
            proof.task_id,
            riskBindings.hop,
            riskBindings.head_sha,
            riskBindings.diff_hash,
            riskBindings.contract_version,
            riskBindings.contract_digest,
            riskBindings.behavior_version,
            riskBindings.path_class,
            risk.risk_level,
            risk.human_review_required,
            risk.auto_eligible,
            risk.policy_version,
            risk.expires_at,
            JSON.stringify(risk),
          ],
        );
        if (!riskAssessmentResult.rows[0]) {
          riskAssessmentResult = await client.query(
            `SELECT id
               FROM kernel_post_diff_risk_assessments
              WHERE run_id = $1
                AND head_sha = $2
                AND diff_hash = $3
                AND contract_digest = $4
                AND policy_version = $5`,
            [
              proof.run_id,
              riskBindings.head_sha,
              riskBindings.diff_hash,
              riskBindings.contract_digest,
              risk.policy_version,
            ],
          );
        }
        const riskAssessment = riskAssessmentResult.rows[0];
        if (!riskAssessment) deny('post_diff_risk_persist_failed');

        await client.query(
          `INSERT INTO kernel_merge_authorizations
             (ownership_id, run_id, task_id, repository, pr_number, pr_url,
              head_ref, head_sha, policy_version, risk_assessment_id, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
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
            riskAssessment.id,
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
