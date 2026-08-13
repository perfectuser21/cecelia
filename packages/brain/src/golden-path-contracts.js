import {
  GoldenPathContractError,
  GP_CONTRACT_SCHEMA_VERSION,
  hashGoldenPathContract,
  validateGoldenPathContract,
} from './golden-path-contract-schema.js';
import {
  createGoldenPathSprintDir,
  GP_HARNESS_BASE_REPO,
  GP_HARNESS_TARGET_ENVIRONMENT,
  GP_HARNESS_TARGET_ENVIRONMENTS,
} from './golden-path-contract-task.js';
import { createRoutedTask } from './work-routing-store.js';
import { CHANGE_KINDS, normalizeRepoHint } from './work-router.js';

export {
  DEFAULT_GP_YIELD_ORDER,
  GoldenPathContractError,
  GP_CONTRACT_KEYS,
  GP_CONTRACT_SCHEMA_VERSION,
  hashGoldenPathContract,
  validateGoldenPathContract,
} from './golden-path-contract-schema.js';

/**
 * 从 GP 行取 harness 胶水参数（migration 393）：列有值就按列走，NULL 回落常量。
 * 枚举校验放在这里而不是只靠 DB 的 CHECK——GP 行可能是 393 之前建的、或被旁路写入，
 * 非法值不拦就会一路带进 payload，等 harness 派发时才炸，那时已经写了 decision 和 task。
 */
function resolveHarnessGlue(goldenPath) {
  const targetEnvironment = goldenPath?.target_environment || GP_HARNESS_TARGET_ENVIRONMENT;
  if (!GP_HARNESS_TARGET_ENVIRONMENTS.includes(targetEnvironment)) {
    throw new GoldenPathContractError(
      'GP_TARGET_ENVIRONMENT_INVALID',
      `Golden Path target_environment "${targetEnvironment}" is not one of ${GP_HARNESS_TARGET_ENVIRONMENTS.join(', ')}`,
      400,
    );
  }
  if (!CHANGE_KINDS.includes(goldenPath?.change_kind)) {
    throw new GoldenPathContractError(
      'GP_CHANGE_KIND_REQUIRED',
      'Golden Path requires one explicit four-form change_kind before Harness launch',
      400,
    );
  }
  if (!Array.isArray(goldenPath?.map_scope)
      || goldenPath.map_scope.length === 0
      || goldenPath.map_scope.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new GoldenPathContractError(
      'GP_MAP_SCOPE_REQUIRED',
      'Golden Path requires a non-empty explicit Map scope before Harness launch',
      400,
    );
  }
  return {
    baseRepo: goldenPath?.base_repo || GP_HARNESS_BASE_REPO,
    targetEnvironment,
    changeKind: goldenPath.change_kind,
    mapScope: [...new Set(goldenPath.map_scope.map((item) => item.trim()))].sort(),
  };
}

async function resolveFreshMapBaseline(db, baseRepo) {
  const repoHint = normalizeRepoHint(baseRepo);
  const { rows } = await db.query(
    `SELECT repositories.repo,
            min(headers.source_revision) AS source_revision
       FROM map_scope_repositories AS repositories
       JOIN fact_snapshot_headers AS headers
         ON headers.repo = repositories.repo
      WHERE repositories.repo = $1
         OR repositories.adapter_config->'aliases' ? $1
      GROUP BY repositories.repo
     HAVING count(DISTINCT headers.kind) = 4
        AND count(DISTINCT headers.source_revision) = 1
        AND bool_and(headers.scanned_at >= now() - interval '15 minutes')`,
    [repoHint],
  );
  const baseline = rows[0];
  if (rows.length !== 1 || !/^[a-f0-9]{40}$/.test(baseline?.source_revision ?? '')) {
    throw new GoldenPathContractError(
      'GP_MAP_BASELINE_UNAVAILABLE',
      'Golden Path requires one fresh, revision-consistent repository Map baseline',
      409,
    );
  }
  return baseline;
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

  // 先解析胶水参数再动笔：非法 target_environment 必须在写 decision / 签合同版本 / 建 task
  // 之前拦掉，否则回滚要跨三张表。幂等分支在上面已经 return，走到这里必然要写。
  const harnessGlue = resolveHarnessGlue(goldenPath);
  const mapBaseline = await resolveFreshMapBaseline(db, harnessGlue.baseRepo);
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

  const sprintDir = createGoldenPathSprintDir(goldenPath.title, goldenPathId);
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
    base_repo: harnessGlue.baseRepo,
    target_environment: harnessGlue.targetEnvironment,
    gp_contract_id: signedVersion.id,
    gp_contract_version: signedVersion.version,
    gp_contract_hash: signedVersion.content_hash,
    change_kind: harnessGlue.changeKind,
    map_scope: harnessGlue.mapScope,
    base_sha: mapBaseline.source_revision,
  };
  const routed = await createRoutedTask(db, {
    source: 'discovery',
    source_id: `golden-path-contract:${signedVersion.id}`,
    title: `[GP harness] ${goldenPath.title}`,
    description: `签字后 harness 实现任务——${goldenPath.one_liner}`,
    requested_task_type: 'harness_initiative',
    declared_change_kind: harnessGlue.changeKind,
    declared_domain: 'coding',
    mutation_intent: 'write',
    repo_hint: mapBaseline.repo,
    map_scope_hint: harnessGlue.mapScope,
    base_sha: mapBaseline.source_revision,
    metadata: taskPayload,
    task: {
      priority: 'P1',
      status: 'queued',
      trigger_source: 'gp_controller',
      domain: 'coding',
      phase: 'dev',
    },
  }, null, { transaction: 'existing' });
  const task = routed.task;

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
