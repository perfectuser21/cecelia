import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { replaceRepoEdges } from '../../lib/graph-store.js';
import { readMap } from '../../lib/map-read-service.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { ensureMapImpactPreflight } from '../../orchestrator/preflight/map-impact-contract.js';
import { createRoutedTask } from '../../work-routing-store.js';
import { deferred, waitForBackendLock } from './helpers/take-map-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^map_preflight_race_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function insertProjection(pool, {
  id,
  scopeKey,
  manifestId,
  manifestDigest,
  repo,
  baseSha,
  label,
  status,
}) {
  const capabilityId = digest(`${id}:capability`);
  const featureId = digest(`${id}:feature`);
  const assertionId = digest(`${id}:assertion`);
  const stepLinkId = randomUUID();
  await pool.query(
    `INSERT INTO map_projection_runs(
       id,scope_key,manifest_version_id,manifest_digest,fact_revisions,
       projector_version,projection_digest,status,activated_at
     ) VALUES($1,$2,$3,$4,$5::jsonb,'race-test-v1',$6,$7,
       CASE WHEN $7='active' THEN NOW() ELSE NULL END)`,
    [
      id,
      scopeKey,
      manifestId,
      manifestDigest,
      JSON.stringify({ [repo]: baseSha }),
      digest(`${id}:projection`),
      status,
    ],
  );
  await pool.query(
    `INSERT INTO map_projection_nodes(
       run_id,node_id,node_type,node_key,name,source_refs,attributes
     ) VALUES
       ($1,$2,'capability','F1',$5,'[]','{}'),
       ($1,$3,'feature',$6,$7,'[]','{}'),
       ($1,$4,'assertion',$8,$9,'[]',$10::jsonb)`,
    [
      id,
      capabilityId,
      featureId,
      assertionId,
      `Factory ${label}`,
      `feature-${label}`,
      `Feature ${label}`,
      stepLinkId,
      `Assertion ${label}`,
      JSON.stringify({
        assertion_ref: 'src/orchestrator/preflight/map-impact-contract.test.js',
        assertion_revision: 1,
      }),
    ],
  );
  await pool.query(
    `INSERT INTO map_projection_edges(
       run_id,edge_id,edge_type,edge_key,from_node_id,to_node_id,source_refs,attributes
     ) VALUES
       ($1,$2,'implements',$3,$4,$5,'[]','{}'),
       ($1,$6,'proves',$7,$8,$4,'[]','{}')`,
    [
      id,
      digest(`${id}:implements`),
      `implements-${label}`,
      featureId,
      capabilityId,
      digest(`${id}:proves`),
      `proves-${label}`,
      assertionId,
    ],
  );
}

async function seedRaceFixture() {
  const suffix = randomUUID().slice(0, 8);
  const scopeKey = `race-scope-${suffix}`;
  const repo = `race-repo-${suffix}`;
  const baseSha = 'a'.repeat(40);
  const nextSha = 'b'.repeat(40);
  const decisionId = randomUUID();
  const manifestId = randomUUID();
  const manifestDigest = digest(`${scopeKey}:manifest`);
  const oldProjectionId = randomUUID();
  const newProjectionId = randomUUID();
  await testPool.query(
    "INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing',$2,'projection race')",
    [decisionId, scopeKey],
  );
  await testPool.query(
    `INSERT INTO map_manifest_versions(
       id,scope_key,version,source_decision_id,manifest,digest,status,activated_at
     ) VALUES($1,$2,1,$3,$4::jsonb,$5,'active',NOW())`,
    [manifestId, scopeKey, decisionId, JSON.stringify({
      scope_key: scopeKey,
      schema_version: 1,
      source_decision_id: decisionId,
      shared_prerequisites: [],
    }), manifestDigest],
  );
  await testPool.query(
    `INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config)
     VALUES($1,$2,'race-test-v1','{}')`,
    [scopeKey, repo],
  );
  await testPool.query(
    `INSERT INTO fact_snapshot_headers(kind,repo,source_revision,scanner_version,scanned_at,row_count)
     SELECT kind,$1,$2,'race-test-v1',NOW(),0
       FROM unnest(ARRAY['api','db_schema','test','graph']) AS kind`,
    [repo, baseSha],
  );
  await testPool.query(
    `INSERT INTO graph_snapshot_versions(
       repo,source_revision,scanner_version,scanned_at,row_count
     ) VALUES($1,$2,'race-test-v1',NOW(),0)`,
    [repo, baseSha],
  );
  await insertProjection(testPool, {
    id: oldProjectionId,
    scopeKey,
    manifestId,
    manifestDigest,
    repo,
    baseSha,
    label: 'old',
    status: 'active',
  });
  await insertProjection(testPool, {
    id: newProjectionId,
    scopeKey,
    manifestId,
    manifestDigest,
    repo,
    baseSha: nextSha,
    label: 'new',
    status: 'building',
  });
  const initiativeId = randomUUID();
  const routed = await createRoutedTask(testPool, {
    source: 'api',
    source_id: `projection-race:${suffix}`,
    title: `projection race ${suffix}`,
    mutation_intent: 'write',
    declared_change_kind: 'bugfix',
    repo_hint: repo,
    map_scope_hint: ['F1'],
    branch: `cp-projection-race-${suffix}`,
    base_sha: baseSha,
    task: { priority: 'P0', payload: { initiative_id: initiativeId } },
  });
  return {
    baseSha,
    initiativeId,
    manifestId,
    nextSha,
    newProjectionId,
    oldProjectionId,
    repo,
    scopeKey,
    taskId: routed.task_id,
  };
}

beforeAll(async () => {
  databaseName = `map_preflight_race_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 6 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('Map preflight projection authority on PostgreSQL', () => {
  it('holds one projection identity from readMap through contract and run commit', async () => {
    const fixture = await seedRaceFixture();
    const mapRead = deferred();
    const continuePreflight = deferred();
    const createRun = createKernelRun(testPool, {
      taskId: fixture.taskId,
      initiativeId: fixture.initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
    }, {
      ensureMapImpactPreflight: (client, context) => ensureMapImpactPreflight(
        client,
        context,
        {
          readMap: async (...args) => {
            const map = await readMap(...args);
            mapRead.resolve();
            await continuePreflight.promise;
            return map;
          },
        },
      ),
    });
    await mapRead.promise;

    await replaceRepoEdges(testPool, fixture.repo, [{
      src_path: 'src/new-live.js',
      dst_path: 'src/new-core.js',
      edge_type: 'import',
      detail: {},
    }], {
      sourceRevision: fixture.nextSha,
      scannerVersion: 'race-test-v1',
    });

    const activationClient = await testPool.connect();
    const backendPid = (await activationClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const activation = (async () => {
      await activationClient.query('BEGIN');
      await activationClient.query(
        `UPDATE map_projection_runs SET status='superseded'
          WHERE id=$1 AND status='active'`,
        [fixture.oldProjectionId],
      );
      await activationClient.query(
        `UPDATE map_projection_runs SET status='active',activated_at=NOW()
          WHERE id=$1 AND status='building'`,
        [fixture.newProjectionId],
      );
      await activationClient.query('COMMIT');
    })().finally(() => activationClient.release());

    const activationWaited = await waitForBackendLock(testPool, backendPid, activation, 500);
    continuePreflight.resolve();
    const [created] = await Promise.all([createRun, activation]);

    expect.soft(activationWaited).toBe(true);
    expect(created).toMatchObject({ created: true, run: { current_task_id: fixture.taskId } });
    const persisted = await testPool.query(
      `SELECT contract.contract_body, COUNT(run.id)::int AS run_count
         FROM harness_impact_contracts contract
         LEFT JOIN initiative_runs run ON run.current_task_id=contract.task_id
        WHERE contract.task_id=$1 AND contract.status='active'
        GROUP BY contract.id`,
      [fixture.taskId],
    );
    expect.soft(persisted.rows[0].contract_body.affected_capabilities).toEqual([
      { capability_id: 'F1', capability_name: 'Factory old', impact_level: 'direct' },
    ]);
    expect(persisted.rows[0].run_count).toBe(1);
    const liveGraph = await testPool.query(
      `SELECT source_revision FROM fact_snapshot_headers
        WHERE kind='graph' AND repo=$1`,
      [fixture.repo],
    );
    expect(liveGraph.rows[0].source_revision).toBe(fixture.nextSha);
    expect(persisted.rows[0].contract_body.fact_revisions).toEqual({
      [fixture.repo]: fixture.baseSha,
    });
  }, 15_000);

  it('rejects an incomplete exact graph snapshot without contract or run half-state', async () => {
    const fixture = await seedRaceFixture();
    await testPool.query(
      `UPDATE graph_snapshot_versions SET row_count=1
        WHERE repo=$1 AND source_revision=$2`,
      [fixture.repo, fixture.baseSha],
    );

    await expect(createKernelRun(testPool, {
      taskId: fixture.taskId,
      initiativeId: fixture.initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
    })).rejects.toMatchObject({ code: 'MAP_RADIUS_GRAPH_SNAPSHOT_INCOMPLETE' });

    const halfState = await testPool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM harness_impact_contracts WHERE task_id=$1) AS contracts,
         (SELECT COUNT(*)::int FROM initiative_runs WHERE current_task_id=$1) AS runs`,
      [fixture.taskId],
    );
    expect(halfState.rows[0]).toEqual({ contracts: 0, runs: 0 });
  });
});
