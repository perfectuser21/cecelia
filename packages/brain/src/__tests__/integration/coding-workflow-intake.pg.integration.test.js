// 真实 CLI → HTTP route → Work Router → PG → GET：事务回滚，仅允许 scratch / CI test。
import express from 'express';
import { describe, it, expect } from 'vitest';
import pool from '../../db.js';
import router from '../../routes/task-tasks.js';

async function seedActiveF1(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('work-routing-active-f1-fixture'))");
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
      "INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing','routing fixture','active F1')",
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



describe('coding workflow 真实建单闭环', () => {
  it('CLI POST 后真实落 coding_mutation/仓库/地图/runner；旧无语义请求400且零落行', async () => {
    const db = process.env.DB_NAME;
    if (db !== 'cecelia_scratch' && !(process.env.CI === 'true' && db === 'cecelia_test')) {
      throw new Error('仅允许 cecelia_scratch 或 CI cecelia_test');
    }
    const client = await pool.connect();
    const originalQuery = pool.query, originalConnect = pool.connect;
    let server;
    try {
      await client.query('BEGIN');
      await seedActiveF1(client);
      // 真 SQL 仍走同一 PG 连接；API 内层事务映射到保存点，使最终 ROLLBACK 包含全部产物。
      const tx = {
        query: (sql, args) => client.query(sql === 'BEGIN' ? 'SAVEPOINT api_intake'
          : sql === 'COMMIT' ? 'RELEASE SAVEPOINT api_intake'
            : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT api_intake' : sql, args),
        release: () => {},
      };
      pool.query = tx.query; pool.connect = async () => tx;
      const postedBodies = [];
      const app = express(); app.use(express.json());
      app.use('/api/brain/tasks', (req, _res, next) => {
        if (req.method === 'POST') postedBodies.push(req.body);
        next();
      }, router);
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      const base = `http://127.0.0.1:${server.address().port}`;
      const title = `cw-intake-pg-${crypto.randomUUID()}`;
      const baseSha = 'a'.repeat(40);
      const response = await fetch(`${base}/api/brain/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, task_type: 'dev', mutation_intent: 'write', change_kind: 'bugfix', repo_hint: 'cecelia', map_scope_hint: ['F1'], branch: 'cp-agent-intake', base_sha: baseSha }) });
      expect(response.status).toBe(201);
      const id = (await response.json()).id;
      const got = await (await fetch(`${base}/api/brain/tasks/${id}`)).json();
      const task = got.task ?? got;
      expect(task.task_type).toBe('codex_dev');
      expect(task.payload).toMatchObject({ repo: 'cecelia', work_kind: 'coding_mutation', change_kind: 'bugfix',
        orchestrator: 'codex-bridge', base_repo: 'perfectuser21/cecelia', map_scope: ['F1'], base_sha: baseSha });
      const receipt = (await client.query(`SELECT work_kind,repo,pipeline,evidence->>'base_sha' AS base_sha FROM work_routing_receipts WHERE task_id=$1`, [id])).rows;
      expect(receipt).toEqual([{ work_kind: 'coding_mutation', repo: 'cecelia', pipeline: 'agent_development', base_sha: baseSha }]);
      const bad = await fetch(`${base}/api/brain/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title + '-missing', task_type: 'coding_workflow', payload: { coding_workflow: true, repo: 'cecelia' } }) });
      expect(bad.status).toBe(410);
      expect((await bad.json()).error).toBe('task_type_retired');
      expect((await client.query('SELECT id FROM tasks WHERE title=$1', [title + '-missing'])).rows).toEqual([]);
    } finally {
      if (server) await new Promise((r) => server.close(r));
      pool.query = originalQuery; pool.connect = originalConnect;
      await client.query('ROLLBACK'); client.release();
    }
  }, 30000);
});
