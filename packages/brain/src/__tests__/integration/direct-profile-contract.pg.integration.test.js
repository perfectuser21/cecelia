import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { computeContractHash } from '../../impact-contract/contract-store.js';
import { createDirectProfileContractMaterializer } from '../../orchestrator/direct-profile-contract.js';
import { parseDirectProfileAssertionRubric } from '../../orchestrator/direct-profile-rubric.js';
import { runMigrations } from '../../migrate.js';

const { Pool } = pg;
const BASE_SHA = 'a'.repeat(40);
const upUrl = new URL('../../../migrations/427_direct_profile_frozen_contract.sql', import.meta.url);
const downUrl = new URL(
  '../../../migrations/rollback/427_direct_profile_frozen_contract.down.sql',
  import.meta.url,
);
let adminPool;
let pool;
let databaseName;
let upSql;
let downSql;

function quoteIdentifier(value) {
  if (!/^direct_contract_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

async function seedDirectAuthority({
  initiativeId = randomUUID(),
  description = 'original mutable description',
  seed = true,
} = {}) {
  const taskId = randomUUID();
  const receiptId = randomUUID();
  const impactId = randomUUID();
  const runId = randomUUID();
  const controllerId = randomUUID();
  const title = `Direct contract ${taskId}`;
  const directSeed = seed === false ? null : {
    contract_version: 'direct-profile-contract-seed/v1',
    title,
    objective: 'Preserve exact server-owned callback authority.',
    execution_profile: 'hotfix-v1',
    ...(seed === true ? {} : seed),
  };
  const routedPayload = {
    work_kind: 'coding_mutation',
    change_kind: 'bugfix',
    default_execution_profile: 'hotfix-v1',
    execution_profile_override: null,
    repo: 'cecelia',
    map_scope: ['F1'],
    impact_contract_required: true,
    orchestrator: 'skill-relay',
    harness_runtime: 'kernel-v1',
  };
  await pool.query(
    `INSERT INTO tasks(id,title,description,status,task_type,payload)
     VALUES($1,$2,$3,'in_progress','harness_initiative',$4::jsonb)`,
    [taskId, title, description, JSON.stringify(routedPayload)],
  );
  await pool.query(
    `INSERT INTO work_routing_receipts(
       id,task_id,source,source_id,work_kind,change_kind,pipeline,
       canonical_task_type,default_execution_profile,execution_profile_override,
       repo,map_scope,impact_contract_required,orchestrator,router_version,
       route_reason,evidence,map_scope_validation_version,direct_contract_seed
     ) VALUES(
       $1,$2,'integration',$3,'coding_mutation','bugfix','harness',
       'harness_initiative','hotfix-v1',NULL,
       'cecelia','["F1"]'::jsonb,true,'kernel-harness-v2','work-router-v1',
       'direct_contract_pg',$4::jsonb,'active-business-node-v1',$5::jsonb
     )`,
    [
      receiptId,
      taskId,
      `direct:${taskId}`,
      JSON.stringify({ branch: `cp-direct-${taskId.slice(0, 8)}`, base_sha: BASE_SHA }),
      directSeed == null ? null : JSON.stringify(directSeed),
    ],
  );
  await pool.query(
    'UPDATE tasks SET payload=payload || $2::jsonb WHERE id=$1',
    [taskId, JSON.stringify({ routing_receipt_id: receiptId })],
  );
  const contractBody = {
    schema_version: 1,
    task_id: taskId,
    change_kind: 'bugfix',
    repo: 'cecelia',
    base_revision: BASE_SHA,
    required_assertions: [{
      assertion_id: 'journey:direct-cas',
      command: 'npm test -- direct-cas',
      covers_capability_ids: ['F1'],
    }],
  };
  const impactHash = computeContractHash(contractBody);
  await pool.query(
    `INSERT INTO harness_impact_contracts(
       id,task_id,status,change_kind,repo,base_revision,
       manifest_digest,projection_digest,contract_hash,contract_body
     ) VALUES($1,$2,'active','bugfix','cecelia',$3,$4,$5,$6,$7::jsonb)`,
    [
      impactId,
      taskId,
      BASE_SHA,
      'b'.repeat(64),
      'c'.repeat(64),
      impactHash,
      JSON.stringify(contractBody),
    ],
  );
  const lease = new Date(Date.now() + 60_000);
  await pool.query(
    `INSERT INTO kernel_controller_sessions(
       id,task_id,generation,source,status,lease_expires_at
     ) VALUES($1,$2,1,'direct-contract-pg','active',$3)`,
    [controllerId, taskId, lease],
  );
  await pool.query(
    `INSERT INTO initiative_runs(
       id,initiative_id,current_task_id,phase,orchestrator_version,created_source,
       record_trust_status,controller_session_id,controller_generation,
       controller_lease_expires_at,impact_contract_policy,
       impact_contract_policy_reason,impact_contract_policy_decision_id
     ) VALUES(
       $1,$2,$3,'generate','v2','kernel_dispatch','trusted',$4,1,$5,
       'required','direct contract fixture','decision-direct-contract-pg'
     )`,
    [runId, initiativeId, taskId, controllerId, lease],
  );
  await pool.query(
    'UPDATE kernel_controller_sessions SET run_id=$2 WHERE id=$1',
    [controllerId, runId],
  );
  return {
    initiativeId,
    taskId,
    receiptId,
    impactId,
    impactHash,
    runId,
    directSeed,
  };
}

beforeAll(async () => {
  databaseName = `direct_contract_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 8 });
  await runMigrations(pool);
  upSql = await readFile(upUrl, 'utf8');
  downSql = await readFile(downUrl, 'utf8');

  // Empty-schema rollback and upgrade are both replayable.
  await pool.query(downSql);
  await pool.query(downSql);
  await pool.query(upSql);
  await pool.query(upSql);
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('direct profile contract PostgreSQL authority', () => {
  it('rejects an oversized UTF-8 direct seed at the database boundary', async () => {
    await expect(seedDirectAuthority({
      seed: { objective: '汉'.repeat(50_000) },
    })).rejects.toMatchObject({
      code: '23514',
      constraint: 'work_routing_receipts_direct_contract_seed_check',
    });
  });

  it('creates contract, four artifacts, seal, provenance, and run binding atomically', async () => {
    const fixture = await seedDirectAuthority();

    const contract = await createDirectProfileContractMaterializer({ pool })(fixture.runId);
    const evidence = await pool.query(
      `SELECT run.contract_id, contract.status, contract.approval_provenance,
              COUNT(artifact.path)::int AS artifact_count,
              seal.artifact_count AS sealed_count,
              seal.source_revision
         FROM initiative_runs run
         JOIN initiative_contracts contract ON contract.id=run.contract_id
         JOIN initiative_contract_artifacts artifact ON artifact.contract_id=contract.id
         JOIN initiative_contract_artifact_seals seal ON seal.contract_id=contract.id
        WHERE run.id=$1
        GROUP BY run.contract_id,contract.status,contract.approval_provenance,
                 seal.artifact_count,seal.source_revision`,
      [fixture.runId],
    );
    expect(evidence.rows[0]).toMatchObject({
      contract_id: contract.id,
      status: 'approved',
      artifact_count: 4,
      sealed_count: 4,
      source_revision: BASE_SHA,
      approval_provenance: {
        kind: 'direct',
        routing_receipt_id: fixture.receiptId,
        impact_contract_id: fixture.impactId,
        impact_contract_hash: fixture.impactHash,
        input_base_sha: BASE_SHA,
      },
    });
    const rubricArtifact = (await pool.query(
      `SELECT path,content FROM initiative_contract_artifacts
        WHERE contract_id=$1 AND path LIKE '%/tests/impact-contract.md'`,
      [contract.id],
    )).rows[0];
    expect(parseDirectProfileAssertionRubric([rubricArtifact])).toEqual({
      matched: true,
      steps: [
        'required_assertion:journey:direct-cas | command:npm test -- direct-cas | capabilities:F1',
      ],
    });
  });

  it('serializes concurrent runs in one initiative and allocates distinct versions', async () => {
    const initiativeId = randomUUID();
    const first = await seedDirectAuthority({ initiativeId });
    const second = await seedDirectAuthority({ initiativeId });
    const materialize = createDirectProfileContractMaterializer({ pool });

    const contracts = await Promise.all([materialize(first.runId), materialize(second.runId)]);
    expect(contracts.map(({ version }) => Number(version)).sort()).toEqual([1, 2]);
    const rows = await pool.query(
      `SELECT version,status FROM initiative_contracts
        WHERE initiative_id=$1 ORDER BY version`,
      [initiativeId],
    );
    expect(rows.rows).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'approved' },
    ]);
  });

  it('ignores a task.description mutation after receipt birth', async () => {
    const fixture = await seedDirectAuthority();
    await pool.query(
      "UPDATE tasks SET description='POISON MUTABLE DESCRIPTION' WHERE id=$1",
      [fixture.taskId],
    );

    const contract = await createDirectProfileContractMaterializer({ pool })(fixture.runId);
    const frozen = await pool.query(
      'SELECT prd_content,contract_content FROM initiative_contracts WHERE id=$1',
      [contract.id],
    );
    expect(JSON.stringify(frozen.rows[0])).not.toContain('POISON');
    expect(frozen.rows[0].prd_content).toContain(fixture.directSeed.objective);
  });

  it('fails closed when an impact supersede wins the row-lock race', async () => {
    const fixture = await seedDirectAuthority();
    const updater = await pool.connect();
    await updater.query('BEGIN');
    await updater.query(
      "UPDATE harness_impact_contracts SET status='superseded' WHERE id=$1",
      [fixture.impactId],
    );
    let impactReadStarted;
    const started = new Promise((resolve) => { impactReadStarted = resolve; });
    const proxiedPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (sql, args) => {
            if (String(sql).includes('FROM harness_impact_contracts')) impactReadStarted();
            return client.query(sql, args);
          },
          release: () => client.release(),
        };
      },
    };
    const pending = createDirectProfileContractMaterializer({ pool: proxiedPool })(fixture.runId);
    await started;
    await updater.query('COMMIT');
    updater.release();

    await expect(pending).rejects.toThrow('DIRECT_PROFILE_CONTRACT_INVALID:impact_missing');
    expect((await pool.query(
      'SELECT contract_id FROM initiative_runs WHERE id=$1',
      [fixture.runId],
    )).rows[0].contract_id).toBeNull();
  });

  it('does not deadlock with task-first finalization and rechecks terminal state', async () => {
    const fixture = await seedDirectAuthority();
    const finalizer = await pool.connect();
    await finalizer.query('BEGIN');
    await finalizer.query('SET LOCAL statement_timeout=5000');
    await finalizer.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [fixture.taskId]);
    let taskReadStarted;
    const started = new Promise((resolve) => { taskReadStarted = resolve; });
    const proxiedPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (sql, args) => {
            if (String(sql).includes('FROM tasks AS task')) taskReadStarted();
            return client.query(sql, args);
          },
          release: () => client.release(),
        };
      },
    };
    const pending = createDirectProfileContractMaterializer({ pool: proxiedPool })(fixture.runId);
    await started;
    await finalizer.query("UPDATE initiative_runs SET phase='failed' WHERE id=$1", [fixture.runId]);
    await finalizer.query("UPDATE tasks SET status='failed' WHERE id=$1", [fixture.taskId]);
    await finalizer.query('COMMIT');
    finalizer.release();

    await expect(pending).rejects.toThrow('DIRECT_PROFILE_CONTRACT_INVALID:run_not_active');
  });

  it('preserves a legacy NULL seed through NOT VALID and fails closed at consumption', async () => {
    await pool.query(
      'ALTER TABLE work_routing_receipts DROP CONSTRAINT work_routing_receipts_direct_contract_seed_check',
    );
    const legacy = await seedDirectAuthority({ seed: false });
    await pool.query(upSql);

    await expect(createDirectProfileContractMaterializer({ pool })(legacy.runId))
      .rejects.toThrow('DIRECT_PROFILE_CONTRACT_INVALID:seed_missing');
  });

  it('refuses rollback once direct authority rows exist', async () => {
    await expect(pool.query(downSql)).rejects.toMatchObject({
      message: expect.stringContaining('direct_profile_contract_authority_exists'),
    });
    await pool.query('ROLLBACK');
    expect((await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_version WHERE version='427'",
    )).rows[0].count).toBe(1);
  });
});
