import { readMap, readRadius } from '../../lib/map-read-service.js';
import { canonicalAssertionCommandText } from '../../lib/gp-assertion-command.js';
import { assertionDigest } from '../../lib/journey-assertion-receipt.js';
import { persistImpactContract } from '../../impact-contract/contract-store.js';

const RECOVERY_REASONS = new Set(['map_unavailable', 'scanner_unavailable', 'projection_unavailable']);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAP_RECOVERY_PATH_PREFIXES = Object.freeze([
  'packages/brain/src/lib/map-',
  'packages/brain/src/lib/fact-snapshot-',
  'packages/brain/src/scanners/',
  'packages/brain/scripts/scan-',
  'packages/brain/scripts/run-all-scans.sh',
  'scripts/scan-graph.mjs',
  'scripts/run-all-scans.sh',
]);

export function assertMapImpactContract({ repo, base_sha, map, impact_contract }) {
  if (!map) throw new Error('map_missing');
  if (map.repo !== repo) throw new Error('repo_mismatch');
  if (map.freshness !== 'fresh') throw new Error('map_stale');
  if (!map.scanner_valid) throw new Error('scanner_invalid');
  if (map.source_revision !== base_sha) throw new Error('map_revision_mismatch');
  if (!impact_contract || impact_contract.status !== 'active') throw new Error('impact_contract_missing');
  if (impact_contract.source_revision !== base_sha) throw new Error('impact_contract_revision_mismatch');
  return { impact_contract_policy: 'required', base_sha, repo };
}

export function assertMapRecoveryContract(contract, context = {}, now = Date.now()) {
  if (typeof context === 'number') {
    now = context;
    context = {};
  }
  if (contract.change_kind !== 'bugfix' || !RECOVERY_REASONS.has(contract.reason_code)) {
    throw new Error('map_recovery_forbidden');
  }
  if (Date.parse(contract.expires_at) <= now) throw new Error('map_recovery_expired');
  if (contract.attempt_id || contract.consumed_attempt_id) throw new Error('map_recovery_consumed');
  for (const field of ['receipt_id', 'task_id', 'repo', 'branch', 'base_sha', 'reason_code']) {
    if (context[field] != null && contract[field] !== context[field]) {
      throw new Error('map_recovery_identity_mismatch');
    }
  }
  const authority = contract.authorization_evidence;
  if (
    !authority
    || typeof authority.authorized_by !== 'string'
    || authority.authorized_by.length === 0
    || authority.observed_reason_code !== contract.reason_code
  ) {
    throw new Error('map_recovery_authority_invalid');
  }
  return true;
}

export function assertMapRecoveryPaths(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    throw new Error('map_recovery_diff_missing');
  }
  const invalid = changedFiles.find((file) => (
    typeof file !== 'string'
    || !MAP_RECOVERY_PATH_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix))
  ));
  if (invalid) throw new Error('map_recovery_diff_forbidden');
  return true;
}

async function resolveScopeKey(client, repo) {
  const result = await client.query(
    `SELECT scope_key
       FROM map_scope_repositories
      WHERE repo=$1
      ORDER BY scope_key`,
    [repo],
  );
  if (result.rows.length !== 1) throw new Error('map_scope_unknown');
  return result.rows[0].scope_key;
}

function recoveryReasonCode(error) {
  if (RECOVERY_REASONS.has(error?.code)) return error.code;
  if (['map_stale', 'map_revision_mismatch', 'map_radius_stale'].includes(error?.message)) {
    return 'scanner_unavailable';
  }
  if (['map_digest_invalid', 'impact_capability_missing', 'impact_assertion_missing'].includes(error?.message)) {
    return 'projection_unavailable';
  }
  return null;
}

async function ensureMapRecoveryPreflight(client, { task, receipt, reasonCode }, deps) {
  const payload = task?.payload ?? {};
  if (payload.map_recovery !== true || receipt.change_kind !== 'bugfix') {
    throw Object.assign(new Error(reasonCode), { code: reasonCode });
  }
  assertMapRecoveryPaths(payload.changed_files);
  const branch = receipt.evidence?.branch;
  const baseSha = receipt.evidence?.base_sha;
  if (!receipt.id || !branch || !SHA_PATTERN.test(baseSha ?? '')) {
    throw new Error('map_recovery_identity_missing');
  }
  const existing = await client.query(
    `SELECT recovery.*, receipt.change_kind,
            consumption.attempt_id AS consumed_attempt_id
       FROM map_recovery_contracts recovery
       JOIN work_routing_receipts receipt
         ON receipt.id = recovery.receipt_id
        AND receipt.task_id = recovery.task_id
       LEFT JOIN map_recovery_consumptions consumption
         ON consumption.contract_id = recovery.id
      WHERE recovery.receipt_id=$1`,
    [receipt.id],
  );
  let recoveryContract = existing.rows[0] ?? null;
  if (!recoveryContract) {
    const inserted = await client.query(
      `INSERT INTO map_recovery_contracts (
         receipt_id, task_id, repo, branch, base_sha, reason_code,
         expires_at, authorization_evidence
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb
       ) RETURNING *`,
      [
        receipt.id,
        task.id,
        receipt.repo,
        branch,
        baseSha,
        reasonCode,
        new Date((deps.now ?? new Date()).getTime() + 15 * 60 * 1000).toISOString(),
        JSON.stringify({
          authorized_by: 'brain-map-preflight',
          observed_reason_code: reasonCode,
          changed_files: payload.changed_files,
        }),
      ],
    );
    recoveryContract = {
      ...inserted.rows[0],
      change_kind: receipt.change_kind,
      consumed_attempt_id: null,
    };
  }
  assertMapRecoveryContract(recoveryContract, {
    receipt_id: receipt.id,
    task_id: task.id,
    repo: receipt.repo,
    branch,
    base_sha: baseSha,
    reason_code: reasonCode,
  }, (deps.now ?? new Date()).getTime());
  const lastKnownGood = await client.query(
    `SELECT id, manifest_digest, projection_digest, contract_body
       FROM harness_impact_contracts
      WHERE repo=$1
        AND status='active'
        AND manifest_digest IS NOT NULL
        AND projection_digest IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [receipt.repo],
  );
  const lkg = lastKnownGood.rows[0];
  if (!lkg) throw new Error('map_recovery_lkg_missing');
  const priorBody = typeof lkg.contract_body === 'string'
    ? JSON.parse(lkg.contract_body)
    : lkg.contract_body;
  const now = deps.now ?? new Date();
  const contractBody = {
    schema_version: 1,
    task_id: task.id,
    change_kind: 'bugfix',
    repo: receipt.repo,
    base_revision: baseSha,
    manifest_digest: lkg.manifest_digest,
    projection_digest: lkg.projection_digest,
    fact_revisions: priorBody.fact_revisions ?? {},
    freshness_evidence: {
      status: 'unknown', reason_code: reasonCode,
      checked_at: now.toISOString(), mapper_revision: baseSha,
    },
    affected_capabilities: priorBody.affected_capabilities,
    required_assertions: priorBody.required_assertions,
    inapplicable_items: priorBody.inapplicable_items ?? [],
    metadata: {
      map_recovery_contract_id: recoveryContract.id,
      lkg_impact_contract_id: lkg.id,
    },
  };
  const persisted = await deps.persistContract(client, {
    task_id: task.id,
    change_kind: 'bugfix',
    repo: receipt.repo,
    base_revision: baseSha,
    manifest_digest: lkg.manifest_digest,
    projection_digest: lkg.projection_digest,
    contract_body: contractBody,
  });
  return { ...persisted, recovery_contract: recoveryContract };
}

async function ensureNormalMapImpactPreflight(client, { task, receipt }, deps = {}) {
  if (!task?.id || !receipt || receipt.work_kind === 'coding_review') {
    throw new Error('routing_receipt_missing');
  }
  const baseSha = receipt.evidence?.base_sha;
  if (!receipt.repo || !SHA_PATTERN.test(baseSha ?? '')) throw new Error('map_context_missing');
  if (!Array.isArray(receipt.map_scope) || receipt.map_scope.length === 0) {
    throw new Error('map_scope_missing');
  }
  const scopeKey = deps.resolveScopeKey
    ? await deps.resolveScopeKey(client, receipt.repo)
    : await resolveScopeKey(client, receipt.repo);
  const loadMap = deps.readMap ?? readMap;
  const loadRadius = deps.readRadius ?? readRadius;
  const persistContract = deps.persistContract ?? persistImpactContract;
  const now = deps.now ?? new Date();
  const map = await loadMap(client, { scopeKey, now });
  const repoFreshness = map?.freshness?.repos?.[receipt.repo];
  if (map?.freshness?.status !== 'fresh' || repoFreshness?.status !== 'fresh') {
    throw new Error('map_stale');
  }
  if (repoFreshness.source_revision !== baseSha) throw new Error('map_revision_mismatch');
  if (!/^[0-9a-f]{64}$/.test(map.manifest_digest ?? '')
      || !/^[0-9a-f]{64}$/.test(map.projection_digest ?? '')) {
    throw new Error('map_digest_invalid');
  }
  const radius = await loadRadius(client, {
    scopeKey,
    repo: receipt.repo,
    startNodeKeys: receipt.map_scope,
    changedFiles: [],
    now,
  });
  const radiusRepoFreshness = radius?.freshness?.repos?.[receipt.repo];
  if (radius?.freshness?.status !== 'fresh'
      || radiusRepoFreshness?.status !== 'fresh'
      || radiusRepoFreshness.source_revision !== baseSha) {
    throw new Error('map_radius_stale');
  }
  const capabilities = (radius.affected_business_nodes ?? [])
    .filter((node) => node.node_type === 'capability')
    .map((node) => ({
      capability_id: node.node_key,
      capability_name: node.name,
      impact_level: 'direct',
    }));
  if (capabilities.length === 0) throw new Error('impact_capability_missing');
  const capabilityIds = capabilities.map(({ capability_id: id }) => id);
  const assertions = (radius.must_run_assertions ?? []).map((assertion) => {
    const assertionRef = assertion.assertion_ref;
    const linkId = assertion.journey_step_link_id ?? assertion.node_key;
    const revision = Number(assertion.assertion_revision);
    if (!/^[0-9a-f-]{36}$/i.test(linkId ?? '') || !Number.isInteger(revision) || revision < 1) {
      throw new Error('impact_assertion_binding_invalid');
    }
    const digest = assertionDigest(assertionRef);
    return {
      assertion_id: assertionRef,
      command: canonicalAssertionCommandText(assertionRef),
      covers_capability_ids: capabilityIds,
      journey_step_link_id: linkId,
      assertion_revision: revision,
      assertion_digest: digest,
      source_bindings: [{
        journey_step_link_id: linkId,
        assertion_revision: revision,
        assertion_digest: digest,
      }],
    };
  });
  if (assertions.length === 0) throw new Error('impact_assertion_missing');
  const contractBody = {
    schema_version: 1,
    task_id: task.id,
    change_kind: receipt.change_kind,
    repo: receipt.repo,
    base_revision: baseSha,
    manifest_digest: map.manifest_digest,
    projection_digest: map.projection_digest,
    fact_revisions: map.fact_revisions ?? {},
    freshness_evidence: {
      status: 'fresh',
      reason_code: repoFreshness.reason_code,
      checked_at: now.toISOString(),
      mapper_revision: baseSha,
    },
    affected_capabilities: capabilities,
    required_assertions: assertions,
    inapplicable_items: [],
    metadata: { scope_key: scopeKey, map_scope: receipt.map_scope },
  };
  if (task.payload?.map_recovery === true) {
    throw new Error('map_recovery_not_required');
  }
  const persisted = await persistContract(client, {
    task_id: task.id,
    change_kind: receipt.change_kind,
    repo: receipt.repo,
    base_revision: baseSha,
    manifest_digest: map.manifest_digest,
    projection_digest: map.projection_digest,
    contract_body: contractBody,
  });
  return { ...persisted, map, radius, scope_key: scopeKey };
}

export async function ensureMapImpactPreflight(client, context, deps = {}) {
  const resolvedDeps = {
    ...deps,
    persistContract: deps.persistContract ?? persistImpactContract,
  };
  try {
    return await ensureNormalMapImpactPreflight(client, context, resolvedDeps);
  } catch (error) {
    const reasonCode = recoveryReasonCode(error);
    if (!reasonCode || context.task?.payload?.map_recovery !== true) throw error;
    return ensureMapRecoveryPreflight(client, {
      ...context,
      reasonCode,
    }, resolvedDeps);
  }
}
