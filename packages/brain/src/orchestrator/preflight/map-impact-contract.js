const RECOVERY_REASONS = new Set(['map_unavailable', 'scanner_unavailable', 'projection_unavailable']);

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
