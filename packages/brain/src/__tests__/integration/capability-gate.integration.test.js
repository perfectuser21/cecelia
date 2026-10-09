import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { createRoutedTask } from '../../work-routing-store.js';

// 禁 mock 边补充覆盖（contract-draft ## 禁 mock 边清单）：
//   capability-gate ↔ decisions DB 表 —— 真 PG 断言，禁止 fake db 冒充落库通过。
// 生产接线：createRoutedTask 对 new_capability 注入 adjudicate 后必调 runCapabilityGate，
//   过闸落真 decisions 行、reject 不建 task 不放行（同事务 fail-closed）。
// 该文件由 generator 落地、brain-integration CI 起真 Postgres 跑，非冻结产物。

const { Pool } = pg;
const REPOSITORY_FACTS = [{
  scope_key: 'cecelia',
  repo: 'cecelia',
  aliases: ['perfectuser21/cecelia'],
}];
const ROUTING_EVIDENCE = Object.freeze({
  branch: 'cp-capability-gate-fixture',
  base_sha: 'a'.repeat(40),
});

function databaseUrl() {
  return process.env.DATABASE_URL ?? process.env.DB_URL ?? 'postgresql://localhost/cecelia_test';
}

async function ensureRouteValidationFixtureSchema(client) {
  await client.query(
    'ALTER TABLE work_routing_receipts ADD COLUMN IF NOT EXISTS map_scope_validation_version text',
  );
  await client.query(
    'ALTER TABLE work_routing_receipts ADD COLUMN IF NOT EXISTS direct_contract_seed jsonb',
  );
}

async function seedActiveF1(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('capability-gate-active-f1-fixture'))");
  let manifest = (await client.query(
    "SELECT id,scope_key,digest FROM map_manifest_versions WHERE scope_key='cecelia' AND status='active'",
  )).rows[0];
  if (!manifest) {
    const decisionId = crypto.randomUUID();
    const manifestId = crypto.randomUUID();
    const digest = crypto.randomUUID().replaceAll('-', '').repeat(2);
    const version = (await client.query(
      "SELECT COALESCE(MAX(version),0)+1 AS version FROM map_manifest_versions WHERE scope_key='cecelia'",
    )).rows[0].version;
    await client.query(
      "INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing','capability gate fixture','active F1')",
      [decisionId],
    );
    await client.query(
      `INSERT INTO map_manifest_versions(
         id,scope_key,version,source_decision_id,manifest,digest,status,activated_at
       ) VALUES($1,'cecelia',$2,$3,$4::jsonb,$5,'active',NOW())`,
      [manifestId, version, decisionId, JSON.stringify({
        scope_key: 'cecelia', schema_version: 1, source_decision_id: decisionId,
      }), digest],
    );
    manifest = { id: manifestId, scope_key: 'cecelia', digest };
  }
  let runId = (await client.query(
    "SELECT id FROM map_projection_runs WHERE scope_key='cecelia' AND status='active'",
  )).rows[0]?.id;
  if (!runId) {
    runId = crypto.randomUUID();
    await client.query(
      `INSERT INTO map_projection_runs(
         id,scope_key,manifest_version_id,manifest_digest,fact_revisions,
         projector_version,projection_digest,status,activated_at
       ) VALUES($1,'cecelia',$2,$3,'{}','test-v1',$4,'active',NOW())`,
      [runId, manifest.id, manifest.digest, crypto.randomUUID().replaceAll('-', '').repeat(2)],
    );
  }
  await client.query(
    `INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name)
     SELECT $1,$2,'capability','F1','Factory F1'
      WHERE NOT EXISTS (
        SELECT 1 FROM map_projection_nodes WHERE run_id=$1 AND node_key='F1'
      )`,
    [runId, crypto.randomUUID().replaceAll('-', '').repeat(2)],
  );
}

function passAdjudicate() {
  return async () => ({
    decision: 'pass',
    reason: 'novel capability, scoped, correctly homed',
    postcondition: 'new_capability 上线后，routeWork 对该能力必经三镜头且门禁产物落 decisions',
    nfr: { cost_ceiling: 2.5, latency_ceiling: 8000, success_floor: 0.9 },
  });
}

function rejectAdjudicate() {
  return async () => ({
    decision: 'reject',
    reason: 'capability_duplicate_of_line04',
  });
}

describe('capability-gate × createRoutedTask 真 PG 落库/拦截', () => {
  it('new_capability 过闸：decisions 落真 nfr/step/journey_step 行且建 task', async () => {
    const testPool = new Pool({ connectionString: databaseUrl() });
    const client = await testPool.connect();
    const stepId = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      await ensureRouteValidationFixtureSchema(client);
      await seedActiveF1(client);
      const created = await createRoutedTask(client, {
        source: 'api',
        source_id: `capgate-pass-${crypto.randomUUID()}`,
        title: 'capability gate pass fixture',
        description: 'new capability requiring three-lens gate',
        mutation_intent: 'write',
        declared_change_kind: 'new_capability',
        repo_hint: 'perfectuser21/cecelia',
        map_scope_hint: ['F1'],
        step_id: stepId,
        ...ROUTING_EVIDENCE,
      }, REPOSITORY_FACTS, {
        transaction: 'existing',
        adjudicateCapability: passAdjudicate(),
      });

      expect(created.task_id).toBeTruthy();
      const gateRow = await client.query(
        `SELECT decision, context->'nfr'->>'cost_ceiling' AS cost,
                context->'nfr'->>'latency_ceiling' AS latency,
                context->'nfr'->>'success_floor' AS success
           FROM decisions
          WHERE category='nfr' AND level='step' AND target_type='journey_step'
            AND target_id=$1 AND status='active'`,
        [stepId],
      );
      expect(gateRow.rowCount).toBe(1);
      expect(gateRow.rows[0].decision).toContain('三镜头');
      expect(gateRow.rows[0].cost).toBe('2.5');
      expect(gateRow.rows[0].latency).toBe('8000');
      expect(gateRow.rows[0].success).toBe('0.9');

      const taskRow = await client.query('SELECT id FROM tasks WHERE id=$1', [created.task_id]);
      expect(taskRow.rowCount).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await testPool.end();
    }
  });

  it('new_capability 判 reject：fail-closed 抛错，不建 task 不落 nfr 行', async () => {
    const testPool = new Pool({ connectionString: databaseUrl() });
    const client = await testPool.connect();
    const stepId = crypto.randomUUID();
    const sourceId = `capgate-reject-${crypto.randomUUID()}`;
    try {
      await client.query('BEGIN');
      await ensureRouteValidationFixtureSchema(client);
      await seedActiveF1(client);
      await expect(createRoutedTask(client, {
        source: 'api',
        source_id: sourceId,
        title: 'capability gate reject fixture',
        description: 'duplicate capability must be blocked',
        mutation_intent: 'write',
        declared_change_kind: 'new_capability',
        repo_hint: 'perfectuser21/cecelia',
        map_scope_hint: ['F1'],
        step_id: stepId,
        ...ROUTING_EVIDENCE,
      }, REPOSITORY_FACTS, {
        transaction: 'existing',
        adjudicateCapability: rejectAdjudicate(),
      })).rejects.toMatchObject({ code: 'capability_gate_rejected', reason: 'capability_duplicate_of_line04' });

      const nfrRows = await client.query(
        "SELECT count(*)::int AS c FROM decisions WHERE category='nfr' AND target_id=$1",
        [stepId],
      );
      expect(nfrRows.rows[0].c).toBe(0);
      const taskRows = await client.query(
        `SELECT count(*)::int AS c FROM tasks t
           JOIN work_routing_receipts r ON r.task_id=t.id
          WHERE r.source='api' AND r.source_id=$1`,
        [sourceId],
      );
      expect(taskRows.rows[0].c).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await testPool.end();
    }
  });
});
