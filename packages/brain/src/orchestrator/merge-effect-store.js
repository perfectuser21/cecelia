import { MergeAuthorizationError } from './merge-authority.js';
import { createHash } from 'node:crypto';

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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function proofDigest(proof) {
  return `sha256:${createHash('sha256').update(stableJson(proof), 'utf8').digest('hex')}`;
}

function sameJson(left, right) {
  return stableJson(parsePayload(left)) === stableJson(parsePayload(right));
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
            intent.authorization_id,
            intent.run_id,
            intent.target,
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
          `SELECT id, version, status, approved_at, contract_content
             FROM initiative_contracts
            WHERE id = $1`,
          [run.contract_id],
        );
        contract = contractResult.rows[0] ?? null;
      }

      const logResult = await client.query(
        `SELECT hop, action, observed, derived_phase, gate_verdict, detail, created_at
           FROM orchestrator_decision_log
          WHERE run_id = $1
          ORDER BY hop`,
        [runId],
      );
      const mergeIntent = [...logResult.rows].reverse().find(
        (row) => row.action === 'merge_pr' && row.gate_verdict === 'allow',
      );
      const receiptBinding = parsePayload(mergeIntent?.observed)?.post_diff_risk?.bindings;
      let productionReceipt = null;
      if (
        typeof receiptBinding?.repository === 'string'
        && typeof receiptBinding?.behavior_fingerprint === 'string'
      ) {
        const receiptResult = await client.query(
          `SELECT id, receipt_status, repository, behavior_fingerprint,
                  capability_fingerprint, path_surface_digest, contract_version,
                  contract_digest, path_class, production_head_sha, artifact_digest,
                  release_run_id, release_effect_receipt_id, issuer, receipt_digest,
                  deployed_at, expires_at, FALSE AS release_authority_valid
             FROM kernel_behavior_production_receipts
            WHERE repository = $1
              AND behavior_fingerprint = $2
              AND receipt_status = 'confirmed'
            ORDER BY deployed_at DESC, id DESC
            LIMIT 1`,
          [receiptBinding.repository, receiptBinding.behavior_fingerprint],
        );
        productionReceipt = receiptResult.rows[0] ?? null;
      }

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
        const digest = proofDigest(risk);
        let riskAssessmentResult = await client.query(
          `INSERT INTO kernel_post_diff_risk_assessments
             (run_id, task_id, assessment_hop, repository, head_sha,
              base_repository, base_ref, base_sha, diff_hash,
              contract_version, contract_digest, behavior_fingerprint,
              capability_fingerprint, path_surface_digest, path_class,
              risk_level, human_review_required, auto_eligible, policy_version,
              proof_expires_at, proof_digest, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb)
           ON CONFLICT (proof_digest)
           DO NOTHING
           RETURNING *`,
          [
            proof.run_id,
            proof.task_id,
            riskBindings.hop,
            riskBindings.repository,
            riskBindings.head_sha,
            riskBindings.base_repository,
            riskBindings.base_ref,
            riskBindings.base_sha,
            riskBindings.diff_hash,
            riskBindings.contract_version,
            riskBindings.contract_digest,
            riskBindings.behavior_fingerprint,
            riskBindings.capability_fingerprint,
            riskBindings.path_surface_digest,
            riskBindings.path_class,
            risk.risk_level,
            risk.human_review_required,
            risk.auto_eligible,
            risk.policy_version,
            risk.expires_at,
            digest,
            JSON.stringify(risk),
          ],
        );
        if (!riskAssessmentResult.rows[0]) {
          riskAssessmentResult = await client.query(
            `SELECT *
               FROM kernel_post_diff_risk_assessments
              WHERE proof_digest = $1`,
            [digest],
          );
        }
        const riskAssessment = riskAssessmentResult.rows[0];
        if (!riskAssessment) deny('post_diff_risk_persist_failed');
        if (
          riskAssessment.run_id !== proof.run_id
          || riskAssessment.task_id !== proof.task_id
          || Number(riskAssessment.assessment_hop) !== riskBindings.hop
          || riskAssessment.repository !== riskBindings.repository
          || riskAssessment.head_sha !== riskBindings.head_sha
          || riskAssessment.base_repository !== riskBindings.base_repository
          || riskAssessment.base_ref !== riskBindings.base_ref
          || riskAssessment.base_sha !== riskBindings.base_sha
          || riskAssessment.diff_hash !== riskBindings.diff_hash
          || Number(riskAssessment.contract_version) !== riskBindings.contract_version
          || riskAssessment.contract_digest !== riskBindings.contract_digest
          || riskAssessment.behavior_fingerprint !== riskBindings.behavior_fingerprint
          || riskAssessment.capability_fingerprint !== riskBindings.capability_fingerprint
          || riskAssessment.path_surface_digest !== riskBindings.path_surface_digest
          || riskAssessment.path_class !== riskBindings.path_class
          || riskAssessment.risk_level !== risk.risk_level
          || riskAssessment.human_review_required !== risk.human_review_required
          || riskAssessment.auto_eligible !== risk.auto_eligible
          || riskAssessment.policy_version !== risk.policy_version
          || Date.parse(riskAssessment.proof_expires_at) !== Date.parse(risk.expires_at)
          || riskAssessment.proof_digest !== digest
          || !sameJson(riskAssessment.evidence, risk)
        ) deny('post_diff_risk_conflict');

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
          `SELECT *
             FROM kernel_merge_authorizations
            WHERE ownership_id = $1
              AND head_sha = $2
              AND policy_version = $3`,
          [ownership.id, proof.head_sha, proof.policy_version],
        );
        const authorization = authorizationResult.rows[0];
        if (!authorization) deny('merge_authorization_persist_failed');
        if (
          authorization.run_id !== proof.run_id
          || authorization.task_id !== proof.task_id
          || authorization.repository !== proof.repository
          || Number(authorization.pr_number) !== proof.pr_number
          || authorization.pr_url !== proof.pr_url
          || authorization.head_ref !== proof.head_ref
          || authorization.head_sha !== proof.head_sha
          || authorization.policy_version !== proof.policy_version
          || authorization.risk_assessment_id !== riskAssessment.id
          || !sameJson(authorization.evidence, proof)
        ) deny('merge_authorization_conflict');

        await client.query(
          `INSERT INTO kernel_merge_effect_intents
             (authorization_id, run_id, target, requested_head_sha)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (authorization_id) DO NOTHING`,
          [authorization.id, proof.run_id, proof.pr_url, proof.head_sha],
        );
        const intent = await selectIntent(client, proof.run_id);
        if (!intent) deny('merge_intent_persist_failed');
        if (
          intent.authorization_id !== authorization.id
          || intent.run_id !== proof.run_id
          || intent.target !== proof.pr_url
          || intent.requested_head_sha !== proof.head_sha
        ) deny('merge_intent_conflict');

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
  proofDigest,
  sameJson,
  sameOwnership,
};
