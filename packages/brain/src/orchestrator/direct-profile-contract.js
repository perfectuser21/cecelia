import { createHash } from 'node:crypto';

import { computeContractHash } from '../impact-contract/contract-store.js';
import { materializeApprovedContract as persistApprovedContract } from './contract-store.js';
import { compareContractArtifactPaths } from './contract-artifacts.js';

export const DIRECT_PROFILE_CONTRACT_POLICY_VERSION = 'direct-profile-contract-policy/v1';
const DIRECT_SEED_VERSION = 'direct-profile-contract-seed/v1';
const DIRECT_PROFILES = new Set(['hotfix-v1', 'parameter-only-v1']);
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function invalid(reason) {
  const error = new Error(`DIRECT_PROFILE_CONTRACT_INVALID:${reason}`);
  error.code = 'DIRECT_PROFILE_CONTRACT_INVALID';
  return error;
}

function asObject(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizedSeed(receipt, executionProfile) {
  const seed = asObject(receipt.direct_contract_seed);
  if (
    seed?.contract_version !== DIRECT_SEED_VERSION
    || seed.execution_profile !== executionProfile
    || typeof seed.title !== 'string'
    || seed.title.trim() !== seed.title
    || seed.title.length === 0
    || typeof seed.objective !== 'string'
    || seed.objective.trim() !== seed.objective
    || seed.objective.length === 0
  ) throw invalid('seed_missing');
  return seed;
}

function artifact(path, content, sourceRevision) {
  return Object.freeze({
    path,
    content,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    byte_length: Buffer.byteLength(content, 'utf8'),
    source_revision: sourceRevision,
  });
}

function canonicalBody(value) {
  if (Array.isArray(value)) return value.map(canonicalBody);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalBody(value[key])]),
    );
  }
  return value;
}

function buildArtifacts({ receipt, seed, impact, baseSha, executionProfile }) {
  const root = `direct-contracts/${receipt.id}`;
  const assertions = impact.contract_body.required_assertions;
  const provenance = {
    kind: 'direct',
    policy_version: DIRECT_PROFILE_CONTRACT_POLICY_VERSION,
    routing_receipt_id: receipt.id,
    impact_contract_id: impact.id,
    impact_contract_hash: impact.contract_hash,
    input_base_sha: baseSha,
  };
  const prdContent = [
    `# ${seed.title}`,
    '',
    '## Objective',
    seed.objective,
    '',
    '## Frozen authority',
    `- execution_profile: ${executionProfile}`,
    `- routing_receipt_id: ${receipt.id}`,
    `- impact_contract_id: ${impact.id}`,
    `- input_base_sha: ${baseSha}`,
  ].join('\n');
  const draftContent = [
    '# Direct profile contract',
    '',
    `Policy: ${DIRECT_PROFILE_CONTRACT_POLICY_VERSION}`,
    `Objective: ${seed.objective}`,
    '',
    '## Active impact contract',
    '```json',
    JSON.stringify(canonicalBody(impact.contract_body), null, 2),
    '```',
  ].join('\n');
  const dodContent = [
    '# Definition of Done',
    '',
    ...assertions.flatMap((assertion) => [
      `## ${assertion.assertion_id}`,
      `- command: ${assertion.command}`,
      `- covers: ${(assertion.covers_capability_ids ?? []).join(', ')}`,
      '',
    ]),
  ].join('\n').trimEnd();
  const testContent = [
    '# Frozen impact assertions',
    '',
    '```json',
    JSON.stringify(canonicalBody({
      impact_contract_id: impact.id,
      impact_contract_hash: impact.contract_hash,
      required_assertions: assertions,
    }), null, 2),
    '```',
  ].join('\n');
  const artifacts = [
    artifact(`${root}/contract-dod.md`, dodContent, baseSha),
    artifact(`${root}/contract-draft.md`, draftContent, baseSha),
    artifact(`${root}/sprint-prd.md`, prdContent, baseSha),
    artifact(`${root}/tests/impact-contract.md`, testContent, baseSha),
  ].sort((left, right) => compareContractArtifactPaths(left.path, right.path));
  return {
    artifacts,
    prdContent,
    contractContent: `${draftContent}\n\n${dodContent}`,
    approvalProvenance: provenance,
  };
}

function validateAuthority(runId, run, receipt, impact) {
  if (!run || run.id !== runId || !run.current_task_id) throw invalid('run_identity_missing');
  if (['done', 'failed'].includes(run.phase) || receipt?.task_status !== 'in_progress') {
    throw invalid('run_not_active');
  }
  if (!receipt) throw invalid('receipt_missing');
  if (receipt.task_id !== run.current_task_id) throw invalid('receipt_task_mismatch');
  const executionProfile = receipt.execution_profile_override
    ?? receipt.default_execution_profile;
  if (receipt.work_kind !== 'coding_mutation' || !DIRECT_PROFILES.has(executionProfile)) {
    throw invalid('profile_not_direct');
  }
  const seed = normalizedSeed(receipt, executionProfile);
  const evidence = asObject(receipt.evidence);
  const baseSha = evidence?.base_sha;
  if (!GIT_SHA_PATTERN.test(baseSha ?? '') || typeof evidence?.branch !== 'string') {
    throw invalid('routing_identity_invalid');
  }
  if (!impact) throw invalid('impact_missing');
  const contractBody = asObject(impact.contract_body);
  if (
    impact.task_id !== run.current_task_id
    || impact.status !== 'active'
    || impact.base_revision !== baseSha
    || contractBody?.task_id !== run.current_task_id
    || contractBody.change_kind !== receipt.change_kind
    || contractBody.repo !== receipt.repo
    || contractBody.base_revision !== baseSha
    || !Array.isArray(contractBody.required_assertions)
    || contractBody.required_assertions.length === 0
  ) throw invalid(impact?.base_revision !== baseSha ? 'impact_revision_mismatch' : 'impact_identity_mismatch');
  if (
    !DIGEST_PATTERN.test(impact.contract_hash ?? '')
    || computeContractHash(contractBody) !== impact.contract_hash
  ) throw invalid('impact_hash_mismatch');
  return { executionProfile, seed, baseSha, contractBody };
}

export function createDirectProfileContractMaterializer({
  pool,
  materializeApprovedContract = persistApprovedContract,
  now = () => new Date(),
} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('direct profile contract materializer requires a PostgreSQL pool');
  }
  return async function materializeDirectProfileContract(runId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const candidate = (await client.query(
        `SELECT run.id, run.initiative_id, run.current_task_id
           FROM initiative_runs AS run
          WHERE run.id = $1::uuid`,
        [runId],
      )).rows[0] ?? null;
      if (candidate) {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`contract-initiative:${candidate.initiative_id}`],
        );
      }
      const task = candidate ? (await client.query(
        `SELECT task.status
           FROM tasks AS task
          WHERE task.id = $1::uuid
          FOR UPDATE OF task`,
        [candidate.current_task_id],
      )).rows[0] ?? null : null;
      const run = candidate && task ? (await client.query(
        `SELECT run.id, run.initiative_id, run.current_task_id,
                run.contract_id, run.phase
           FROM initiative_runs AS run
          WHERE run.id = $1::uuid
            AND run.initiative_id = $2::uuid
            AND run.current_task_id = $3::uuid
          FOR UPDATE OF run`,
        [runId, candidate.initiative_id, candidate.current_task_id],
      )).rows[0] ?? null : null;
      const receiptRow = run ? (await client.query(
        `SELECT receipt.*
           FROM work_routing_receipts AS receipt
           JOIN tasks AS task
             ON task.id = receipt.task_id
            AND receipt.id = (task.payload->>'routing_receipt_id')::uuid
          WHERE task.id = $1::uuid
          FOR SHARE OF receipt`,
        [run.current_task_id],
      )).rows[0] ?? null : null;
      const receipt = receiptRow ? { ...receiptRow, task_status: task.status } : null;
      const impact = run ? (await client.query(
        `SELECT id, task_id, status, change_kind, repo, base_revision,
                contract_hash, contract_body
           FROM harness_impact_contracts
          WHERE task_id = $1::uuid AND status = 'active'
          FOR SHARE`,
        [run.current_task_id],
      )).rows[0] ?? null : null;
      const authority = validateAuthority(runId, run, receipt, impact);
      const frozen = buildArtifacts({
        receipt,
        seed: authority.seed,
        impact: { ...impact, contract_body: authority.contractBody },
        baseSha: authority.baseSha,
        executionProfile: authority.executionProfile,
      });
      const result = await materializeApprovedContract(client, {
        runId,
        version: 1,
        branch: receipt.evidence.branch,
        prdContent: frozen.prdContent,
        contractContent: frozen.contractContent,
        artifacts: frozen.artifacts,
        approvalProvenance: frozen.approvalProvenance,
        approvedAt: now(),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* keep root cause */ }
      throw error;
    } finally {
      client.release();
    }
  };
}

export async function materializeDirectProfileContract(pool, runId) {
  return createDirectProfileContractMaterializer({ pool })(runId);
}
