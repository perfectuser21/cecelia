import { createHash } from 'node:crypto';

import { z } from 'zod';


export const GP_CONTRACT_SCHEMA_VERSION = 1;

export const GP_CONTRACT_KEYS = Object.freeze([
  'fr_summary',
  'lifelines_and_nfr',
  'yield_order',
  'external_commitment_changes',
  'release_and_blast_radius',
  'success_and_close',
  'budget_guard',
]);

export const DEFAULT_GP_YIELD_ORDER = Object.freeze([
  '安全/资金正确性',
  '数据一致性',
  '功能完整',
  '性能',
  '体验顺滑',
]);

const nonEmptyText = z.string().trim().min(1);
const nonEmptyTextList = z.array(nonEmptyText).min(1);

const frSummarySchema = z.object({
  statements: nonEmptyTextList,
}).strict();

const lifelinesAndNfrSchema = z.object({
  items: z.array(z.object({
    statement: nonEmptyText,
    class: z.enum(['lifeline', 'best_effort']),
    verification: nonEmptyText,
    rationale: nonEmptyText,
  }).strict()),
}).strict();

const yieldOrderSchema = z.object({
  order: nonEmptyTextList,
  override_reason: z.string().trim().min(1).nullable(),
}).strict().superRefine((value, context) => {
  const usesDefault = (
    value.order.length === DEFAULT_GP_YIELD_ORDER.length
    && value.order.every((item, index) => item === DEFAULT_GP_YIELD_ORDER[index])
  );
  if (!usesDefault && value.override_reason === null) {
    context.addIssue({
      code: 'custom',
      path: ['override_reason'],
      message: 'non_default_yield_order_requires_override_reason',
    });
  }
});

const externalCommitmentsSchema = z.object({
  changes: z.array(nonEmptyText),
  none: z.boolean(),
}).strict().superRefine((value, context) => {
  const consistent = (
    (value.none && value.changes.length === 0)
    || (!value.none && value.changes.length > 0)
  );
  if (!consistent) {
    context.addIssue({
      code: 'custom',
      path: ['changes'],
      message: 'external_commitment_none_must_match_changes',
    });
  }
});

const releaseAndBlastRadiusSchema = z.object({
  stages: nonEmptyTextList,
  blast_radius: nonEmptyText,
  rollback_triggers: nonEmptyTextList,
}).strict();

const successAndCloseSchema = z.object({
  metrics: nonEmptyTextList,
  observation_window: nonEmptyText,
  close_conditions: nonEmptyTextList,
  shutdown_conditions: nonEmptyTextList,
}).strict();

const budgetGuardSchema = z.object({
  total_cost_cap_usd: z.number().finite().positive(),
  atom_cost_cap_usd: z.number().finite().positive(),
  atom_runtime_sec: z.number().int().positive(),
  atom_parallelism: z.number().int().positive(),
}).strict();

const GoldenPathContractSchema = z.object({
  fr_summary: frSummarySchema,
  lifelines_and_nfr: lifelinesAndNfrSchema,
  yield_order: yieldOrderSchema,
  external_commitment_changes: externalCommitmentsSchema,
  release_and_blast_radius: releaseAndBlastRadiusSchema,
  success_and_close: successAndCloseSchema,
  budget_guard: budgetGuardSchema,
}).strict();

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function validateGoldenPathContract(value) {
  return GoldenPathContractSchema.parse(value);
}

export function hashGoldenPathContract(value) {
  const parsed = validateGoldenPathContract(value);
  return createHash('sha256')
    .update(JSON.stringify(sortJson(parsed)))
    .digest('hex');
}

export class GoldenPathContractError extends Error {
  constructor(code, message, status = 409, details = undefined) {
    super(message);
    this.name = 'GoldenPathContractError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function parseContractOrThrow(contract) {
  try {
    return validateGoldenPathContract(contract);
  } catch (cause) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_INVALID',
      'Golden Path contract failed schema validation',
      400,
      cause?.issues,
    );
  }
}

export async function createGoldenPathContractVersion(db, {
  goldenPathId,
  contract,
}) {
  const parsed = parseContractOrThrow(contract);
  const contentHash = hashGoldenPathContract(parsed);

  const { rows: goldenPaths } = await db.query(
    `SELECT id, title, journey_id
       FROM golden_paths
      WHERE id = $1
      FOR UPDATE`,
    [goldenPathId],
  );
  if (goldenPaths.length === 0) {
    throw new GoldenPathContractError(
      'GP_NOT_FOUND',
      'Golden Path not found',
      404,
    );
  }
  const goldenPath = goldenPaths[0];
  if (!goldenPath.journey_id) {
    throw new GoldenPathContractError(
      'GP_LEDGER_ANCHOR_REQUIRED',
      'Golden Path must reference a Journey before contract submission',
    );
  }

  const { rows: contractRows } = await db.query(
    `SELECT *
       FROM golden_path_contract_versions
      WHERE golden_path_id = $1
      ORDER BY version DESC
      LIMIT 1`,
    [goldenPathId],
  );
  const latest = contractRows[0] || null;
  if (latest?.content_hash === contentHash) {
    return {
      contract_version: latest,
      pending_action_id: latest.signing_action_id,
      idempotent: true,
    };
  }

  const { rows: activeTasks } = await db.query(
    `SELECT id, status, payload
       FROM tasks
      WHERE task_type = 'harness_initiative'
        AND payload->>'golden_path_id' = $1
        AND status IN ('queued', 'blocked', 'dispatched', 'in_progress')
      FOR UPDATE`,
    [goldenPathId],
  );
  const runningTasks = activeTasks.filter(
    (task) => task.status === 'dispatched' || task.status === 'in_progress',
  );
  if (runningTasks.length > 0) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_IN_FLIGHT',
      'Drain or cancel the running Harness task before replacing its contract',
      409,
      { task_ids: runningTasks.map((task) => task.id) },
    );
  }

  const cancellableTaskIds = activeTasks
    .filter((task) => task.status === 'queued' || task.status === 'blocked')
    .map((task) => task.id);
  if (cancellableTaskIds.length > 0) {
    await db.query(
      `UPDATE tasks
          SET status = 'cancelled',
              error_message = 'Golden Path contract superseded before execution',
              completed_at = now(),
              updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND status IN ('queued', 'blocked')
      RETURNING id, status`,
      [cancellableTaskIds],
    );
  }

  await db.query(
    `UPDATE golden_path_contract_versions
        SET status = CASE
          WHEN status = 'signed' THEN 'invalidated'
          ELSE 'superseded'
        END,
            invalidated_at = CASE
              WHEN status = 'signed' THEN now()
              ELSE invalidated_at
            END
      WHERE golden_path_id = $1
        AND status IN ('signed', 'pending_signature')
    RETURNING *`,
    [goldenPathId],
  );

  const nextVersion = (latest?.version || 0) + 1;
  const { rows: insertedVersions } = await db.query(
    `INSERT INTO golden_path_contract_versions (
       golden_path_id,
       schema_version,
       version,
       contract_json,
       content_hash,
       status
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, 'pending_signature')
     RETURNING *`,
    [
      goldenPathId,
      GP_CONTRACT_SCHEMA_VERSION,
      nextVersion,
      JSON.stringify(parsed),
      contentHash,
    ],
  );
  const inserted = insertedVersions[0];

  const actionParams = {
    golden_path_id: goldenPathId,
    contract_id: inserted.id,
    version: inserted.version,
    content_hash: inserted.content_hash,
  };
  const actionContext = {
    title: `签署 GP 合同 v${inserted.version}: ${goldenPath.title || goldenPathId}`,
    golden_path_id: goldenPathId,
    schema_version: GP_CONTRACT_SCHEMA_VERSION,
  };
  const actionSignature = `gp-contract:${goldenPathId}:v${inserted.version}:sign`;
  const { rows: actions } = await db.query(
    `INSERT INTO pending_actions (
       action_type,
       params,
       context,
       category,
       priority,
       source,
       signature,
       expires_at
     )
     VALUES (
       'sign_golden_path_contract',
       $1::jsonb,
       $2::jsonb,
       'approval',
       'urgent',
       'golden_path_controller',
       $3,
       NULL
     )
     RETURNING id`,
    [
      JSON.stringify(actionParams),
      JSON.stringify(actionContext),
      actionSignature,
    ],
  );
  const actionId = actions[0].id;

  const { rows: finalizedVersions } = await db.query(
    `UPDATE golden_path_contract_versions
        SET signing_action_id = $1
      WHERE id = $2
      RETURNING *`,
    [actionId, inserted.id],
  );

  return {
    contract_version: finalizedVersions[0],
    pending_action_id: actionId,
    idempotent: false,
  };
}
