import { readMap, readRadius } from '../../lib/map-read-service.js';
import { canonicalAssertionCommandText } from '../../lib/gp-assertion-command.js';
import { assertionDigest } from '../../lib/journey-assertion-receipt.js';
import { persistImpactContract } from '../../impact-contract/contract-store.js';

const RECOVERY_REASONS = new Set(['map_unavailable', 'scanner_unavailable', 'projection_unavailable']);
const SHA_PATTERN = /^[0-9a-f]{40}$/;

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

export function assertMapRecoveryContract(contract, now = Date.now()) {
  if (contract.change_kind !== 'bugfix' || !RECOVERY_REASONS.has(contract.reason_code)) throw new Error('map_recovery_forbidden');
  if (Date.parse(contract.expires_at) <= now) throw new Error('map_recovery_expired');
  if (contract.attempt_id) throw new Error('map_recovery_consumed');
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

export async function ensureMapImpactPreflight(client, { task, receipt }, deps = {}) {
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
