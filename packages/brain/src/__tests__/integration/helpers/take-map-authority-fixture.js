import { randomUUID } from 'node:crypto';

export async function seedActiveCapability(pool, {
  scopeKey = 'cecelia',
  repo = scopeKey,
  nodeKey = 'F1',
  ensureRepository = false,
} = {}) {
  const decisionId = randomUUID();
  const manifestId = randomUUID();
  const runId = randomUUID();
  const digest = randomUUID().replaceAll('-', '').repeat(2);
  if (ensureRepository) {
    await pool.query(
      `INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config)
       VALUES($1,$2,'legacy-ledger-v1','{}'::jsonb)`,
      [scopeKey, repo],
    );
  }
  await pool.query(
    "INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing',$2,$3)",
    [decisionId, `take map authority:${scopeKey}`, `active ${nodeKey}`],
  );
  await pool.query(
    `INSERT INTO map_manifest_versions(
       id,scope_key,version,source_decision_id,manifest,digest,status,activated_at
     ) VALUES($1,$2,1,$3,$4::jsonb,$5,'active',NOW())`,
    [manifestId, scopeKey, decisionId, JSON.stringify({
      scope_key: scopeKey, schema_version: 1, source_decision_id: decisionId,
    }), digest],
  );
  await pool.query(
    `INSERT INTO map_projection_runs(
       id,scope_key,manifest_version_id,manifest_digest,fact_revisions,
       projector_version,projection_digest,status,activated_at
     ) VALUES($1,$2,$3,$4,'{}','test-v1',$5,'active',NOW())`,
    [runId, scopeKey, manifestId, digest, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await pool.query(
    `INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name)
     VALUES($1,$2,'capability',$3,$4)`,
    [runId, randomUUID().replaceAll('-', '').repeat(2), nodeKey, `Test ${nodeKey}`],
  );
  return { decisionId, manifestId, runId, scopeKey, repo, ensureRepository };
}

export async function cleanupActiveCapability(pool, fixture) {
  if (!fixture) return;
  await pool.query('DELETE FROM map_projection_runs WHERE id=$1', [fixture.runId]);
  await pool.query('DELETE FROM map_manifest_versions WHERE id=$1', [fixture.manifestId]);
  await pool.query('DELETE FROM decisions WHERE id=$1', [fixture.decisionId]);
  if (fixture.ensureRepository) {
    await pool.query('DELETE FROM map_scope_repositories WHERE scope_key=$1', [fixture.scopeKey]);
  }
}

export async function seedActiveF1(pool) {
  return seedActiveCapability(pool);
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

export async function waitForBackendLock(pool, pid, operation, timeoutMs = 2_000) {
  let settled = false;
  operation.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activity = await pool.query(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
      [pid],
    );
    if (activity.rows[0]?.wait_event_type === 'Lock') return true;
    if (settled) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
