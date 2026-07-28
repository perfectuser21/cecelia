#!/usr/bin/env node
import pg from 'pg';
import { readPrivateRollbackWorkerConfig } from '../../packages/brain/src/orchestrator/release-run-worker-secret.js';

const [
  privateConfigFile,
  authorityId,
  releaseRunId,
  mergeSha,
  claimId,
  generation,
] = process.argv.slice(2);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/;

let pool;
try {
  if (
    !UUID_RE.test(authorityId ?? '')
    || !UUID_RE.test(releaseRunId ?? '')
    || !SHA_RE.test(mergeSha ?? '')
    || !Number.isInteger(Number(claimId))
    || Number(generation) !== 1
  ) process.exit(78);
  const config = readPrivateRollbackWorkerConfig(privateConfigFile);
  if (!UUID_RE.test(config.rollback_authorization ?? '')) process.exit(78);
  pool = new pg.Pool({ ...config.database, max: 1 });
  const { rows } = await pool.query(
    `SELECT authority.id
       FROM kernel_release_rollback_execution_authorities authority
       JOIN kernel_release_rollback_execution_claims claim
         ON claim.authority_id = authority.id
       LEFT JOIN kernel_release_rollback_execution_renewals renewal
         ON renewal.claim_id = claim.id
        AND renewal.generation = claim.generation
       LEFT JOIN kernel_release_rollback_execution_settlements settlement
         ON settlement.authority_id = authority.id
      WHERE authority.id = $1
        AND authority.release_run_id = $2
        AND authority.expected_merge_sha = $3
        AND authority.idempotency_key = $4
        AND claim.id = $5
        AND claim.generation = $6
        AND settlement.id IS NULL
      GROUP BY authority.id, claim.id
     HAVING GREATEST(
       claim.lease_expires_at,
       COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
     ) > clock_timestamp()`,
    [
      authorityId,
      releaseRunId,
      mergeSha,
      config.rollback_authorization,
      Number(claimId),
      Number(generation),
    ],
  );
  process.exitCode = rows.length === 1 ? 0 : 78;
} catch {
  process.exitCode = 78;
} finally {
  await pool?.end().catch(() => {});
}
