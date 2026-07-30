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

const GP_HARNESS_BASE_REPO = 'https://github.com/perfectuser21/cecelia.git';
const GP_HARNESS_TARGET_ENVIRONMENT = 'local_api';

function shortId(id) {
  return String(id).replace(/-/g, '').slice(0, 8);
}

function stampMMDDHHNN(now) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function slugifyGoldenPath(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '') || 'gp';
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

async function lockGoldenPathAndLatestContract(db, goldenPathId) {
  const { rows: goldenPaths } = await db.query(
    `SELECT *
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

  const { rows: versions } = await db.query(
    `SELECT *
       FROM golden_path_contract_versions
      WHERE golden_path_id = $1
      ORDER BY version DESC
      LIMIT 1
      FOR UPDATE`,
    [goldenPathId],
  );
  return {
    goldenPath: goldenPaths[0],
    latest: versions[0] || null,
  };
}

async function findHarnessTaskForContract(db, contractId) {
  const { rows } = await db.query(
    `SELECT *
       FROM tasks
      WHERE task_type = 'harness_initiative'
        AND payload->>'gp_contract_id' = $1
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [contractId],
  );
  return rows[0] || null;
}

export async function signAndLaunchGoldenPathContract(db, {
  goldenPathId,
  contractId,
  version,
  contentHash,
  reviewer,
}) {
  const { goldenPath, latest } = await lockGoldenPathAndLatestContract(
    db,
    goldenPathId,
  );
  if (
    !latest
    || latest.id !== contractId
    || latest.version !== Number(version)
    || latest.content_hash !== contentHash
  ) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_STALE',
      'Only the latest Golden Path contract version can be signed',
      409,
      { latest_version: latest?.version ?? null },
    );
  }

  const existingTask = await findHarnessTaskForContract(db, latest.id);
  if (latest.status === 'signed') {
    if (!existingTask) {
      throw new GoldenPathContractError(
        'GP_CONTRACT_TASK_MISSING',
        'Signed Golden Path contract has no bound Harness task',
      );
    }
    return {
      contract_version: latest,
      task: existingTask,
      idempotent: true,
    };
  }
  if (latest.status !== 'pending_signature') {
    throw new GoldenPathContractError(
      'GP_CONTRACT_STALE',
      'Golden Path contract version is no longer signable',
    );
  }
  if (existingTask) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_TASK_CONFLICT',
      'Unsigned Golden Path contract already has a Harness task',
    );
  }
  if (goldenPath.status !== 'converged') {
    throw new GoldenPathContractError(
      'GP_NOT_CONVERGED',
      'Golden Path must be converged before Owner signature',
    );
  }
  if (!String(reviewer || '').trim()) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_REVIEWER_REQUIRED',
      'Owner identity is required to sign a Golden Path contract',
      400,
    );
  }

  const decisionTopic = `gp:${goldenPathId}:contract:v${latest.version}`;
  const decisionReason = (
    `gp:${goldenPathId} 合同 v${latest.version} 由 ${reviewer} 按具体内容哈希 `
    + `${latest.content_hash} 签署。`
  );
  const decisionContext = {
    policy_key: 'gp.contract.signature',
    golden_path_id: goldenPathId,
    gp_contract_id: latest.id,
    gp_contract_version: latest.version,
    gp_contract_hash: latest.content_hash,
  };
  const { rows: decisions } = await db.query(
    `INSERT INTO decisions (
       category,
       topic,
       decision,
       reason,
       status,
       review_after,
       context
     )
     VALUES (
       'judgment',
       $1,
       'approved',
       $2,
       'active',
       now() + interval '14 days',
       $3::jsonb
     )
     RETURNING id`,
    [
      decisionTopic,
      decisionReason,
      JSON.stringify(decisionContext),
    ],
  );
  const judgmentId = decisions[0].id;

  const { rows: signedVersions } = await db.query(
    `UPDATE golden_path_contract_versions
        SET status = 'signed',
            signature_decision_id = $1,
            signed_by = $2,
            signed_at = now()
      WHERE id = $4
        AND content_hash = $3
        AND status = 'pending_signature'
      RETURNING *`,
    [judgmentId, reviewer, latest.content_hash, latest.id],
  );
  if (signedVersions.length === 0) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_STALE',
      'Golden Path contract changed before signature commit',
    );
  }
  const signedVersion = signedVersions[0];

  const sprintDir = (
    `sprints/${stampMMDDHHNN(new Date())}-`
    + `${slugifyGoldenPath(goldenPath.title)}-${shortId(goldenPathId)}`
  );
  const taskPayload = {
    golden_path_id: goldenPathId,
    title: goldenPath.title,
    one_liner: goldenPath.one_liner,
    proposal_doc: goldenPath.proposal_doc || null,
    judgment_decision_id: judgmentId,
    phase: 'implement',
    orchestrator: 'skill-relay',
    sprint_dir: sprintDir,
    thin_prd: goldenPath.one_liner,
    prep_prd_body: goldenPath.proposal_doc || null,
    journey_id: goldenPath.journey_id,
    base_repo: GP_HARNESS_BASE_REPO,
    target_environment: GP_HARNESS_TARGET_ENVIRONMENT,
    gp_contract_id: signedVersion.id,
    gp_contract_version: signedVersion.version,
    gp_contract_hash: signedVersion.content_hash,
  };
  const { rows: tasks } = await db.query(
    `INSERT INTO tasks (
       title,
       description,
       task_type,
       status,
       priority,
       payload
     )
     VALUES ($1, $2, 'harness_initiative', 'queued', 'P1', $3::jsonb)
     RETURNING *`,
    [
      `[GP harness] ${goldenPath.title}`,
      `签字后 harness 实现任务——${goldenPath.one_liner}`,
      JSON.stringify(taskPayload),
    ],
  );
  const task = tasks[0];

  const { rows: approvedPaths } = await db.query(
    `UPDATE golden_paths
        SET status = 'approved',
            judgment_refs = ARRAY[$1::uuid],
            approved_at = now(),
            review_after = now() + interval '14 days',
            proposal_doc = COALESCE($2, proposal_doc),
            updated_at = now()
      WHERE id = $3
        AND status = 'converged'
      RETURNING *`,
    [judgmentId, goldenPath.proposal_doc || null, goldenPathId],
  );
  if (approvedPaths.length === 0) {
    throw new GoldenPathContractError(
      'GP_CONCURRENT_MODIFICATION',
      'Golden Path status changed before signature commit',
    );
  }

  return {
    contract_version: signedVersion,
    task,
    golden_path: approvedPaths[0],
    judgment_decision_id: judgmentId,
    idempotent: false,
  };
}

export async function launchLatestSignedGoldenPath(db, {
  goldenPathId,
  expectedVersion,
}) {
  const { latest } = await lockGoldenPathAndLatestContract(db, goldenPathId);
  if (
    expectedVersion !== undefined
    && latest?.version !== Number(expectedVersion)
  ) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_STALE',
      'Requested Golden Path contract version is not latest',
      409,
      { latest_version: latest?.version ?? null },
    );
  }
  if (!latest || latest.status !== 'signed') {
    throw new GoldenPathContractError(
      'GP_CONTRACT_SIGNATURE_REQUIRED',
      'Latest Golden Path contract requires Owner signature',
    );
  }
  const task = await findHarnessTaskForContract(db, latest.id);
  if (!task) {
    throw new GoldenPathContractError(
      'GP_CONTRACT_TASK_MISSING',
      'Signed Golden Path contract has no bound Harness task',
    );
  }
  return {
    contract_version: latest,
    task,
    idempotent: true,
  };
}
