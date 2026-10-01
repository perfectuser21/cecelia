import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { seedRoutedKernelTask } from './helpers/routed-kernel-fixture.js';

const admin = new pg.Pool({ ...DB_DEFAULTS, max: 4 });
const schema = `recovery_rebase_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const tables = ['tasks', 'initiative_runs', 'initiative_contracts', 'kernel_controller_sessions',
  'work_routing_receipts', 'planner_recovery_receipts', 'planner_recovery_consumptions',
  'harness_attempts', 'task_events', 'cecelia_events', 'map_manifest_versions', 'map_scope_repositories',
  'fact_snapshot_headers', 'graph_snapshot_versions', 'map_projection_runs', 'map_projection_nodes',
  'map_projection_edges', 'test_registry', 'api_registry', 'db_schema_registry', 'graph_edges',
  'graph_edge_snapshots', 'journey_assertion_receipts', 'harness_impact_contracts'];
const oldBase = 'a'.repeat(40), base = 'b'.repeat(40), head = 'c'.repeat(40);
const pool = {
  async connect() {
    const c = await admin.connect();
    await c.query(`SET search_path TO "${schema}",public`);
    return c;
  },
  async query(sql, params) {
    const c = await this.connect();
    try { return await c.query(sql, params); } finally { c.release(); }
  },
};

beforeAll(async () => {
  const db = (await admin.query('SELECT current_database() AS name')).rows[0].name;
  if (!/_test$|_scratch$/.test(db)) throw new Error('isolated test/scratch database required');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const table of tables) await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  // 真用生产append-only/投影触发器，不能靠fixture放宽接班收据顺序。
  await pool.query(`CREATE TRIGGER work_routing_receipts_immutable BEFORE UPDATE OR DELETE
    ON work_routing_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_work_routing_receipt_mutation()`);
  await pool.query(`CREATE TRIGGER work_routing_task_projection_immutable BEFORE UPDATE
    ON tasks FOR EACH ROW EXECUTE FUNCTION public.reject_work_routing_task_projection_mutation()`);
});
afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

async function fixture() {
  const ids = await seedRoutedKernelTask(pool, { titlePrefix: 'recovery-rebase', mapScope: ['F1'],
    payload: { base_sha: oldBase } });
  const branch = `cp-recovery-rebase-${ids.taskId.slice(0, 8)}`;
  await pool.query(`UPDATE tasks SET status='failed',payload=payload||$2::jsonb WHERE id=$1`,
    [ids.taskId, JSON.stringify({ branch })]);
  const previous = await pool.query(`INSERT INTO initiative_runs
    (initiative_id,current_task_id,phase,orchestrator_version,created_source,record_trust_status,
     failure_reason,completed_at) VALUES ($1,$2,'failed','v2','foreground_handoff','trusted',
     'ownerless_kernel_run_recovered:controller_lease_expired',NOW()) RETURNING *`,
    [ids.initiativeId, ids.taskId]);
  const request = { expected_receipt_id: ids.receiptId, base_sha: base, head_sha: head,
    actor: 'session:pg-recovery', reason: '真实失租恢复回归', sprint_dir: 'sprints' };
  const input = { taskId: ids.taskId, initiativeId: ids.initiativeId, phase: 'planning',
    host: 'integration', deadlineHours: 1, createdSource: 'explicit_recovery',
    predecessorRunId: previous.rows[0].id, recoveryRebase: request };
  const map = { freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: base } } },
    projection_run_id: randomUUID() };
  const deps = { recoveryRebaseDeps: { readMap: async () => map, resolveScopeKey: async () => 'cecelia',
    lockMapProjectionAuthority: async () => ({}), resolveBranchHead: async () => head,
    resolveCommitDiff: async () => ({ isAncestor: true, changedFiles: [] }) },
    ensureMapImpactPreflight: async (_c, { task, receipt }) => {
      expect(receipt.evidence.base_sha).toBe(base); expect(task.payload.base_sha).toBe(base);
      return { contract: { id: randomUUID(), status: 'active' } };
    } };
  return { ids, input, request, map, deps, previous: previous.rows[0] };
}

describe('受控再基恢复真实PG事务', () => {
  it('新收据/owner/run落库；失败前任和旧收据原样保留', async () => {
    const f = await fixture();
    const oldReceipt = (await pool.query('SELECT * FROM work_routing_receipts WHERE id=$1', [f.ids.receiptId])).rows[0];
    const result = await createKernelRun(pool, f.input, f.deps);
    expect(result.created).toBe(true);
    expect(result.run.predecessor_run_id).toBe(f.previous.id);
    expect(result.run.contract_id).toBeNull();
    expect(result.run.evaluate_verdict).toBeNull(); expect(result.run.judge_verdict).toBeNull();
    expect(result.run.controller_session_id).toMatch(/^[a-f0-9-]{36}$/);
    expect((await pool.query('SELECT * FROM initiative_runs WHERE id=$1', [f.previous.id])).rows[0]).toEqual(f.previous);
    expect((await pool.query('SELECT * FROM work_routing_receipts WHERE id=$1', [f.ids.receiptId])).rows[0]).toEqual(oldReceipt);
    const receipts = (await pool.query('SELECT * FROM work_routing_receipts WHERE task_id=$1 ORDER BY anchor_generation', [f.ids.taskId])).rows;
    expect(receipts).toHaveLength(2); expect(receipts[1].supersedes_receipt_id).toBe(f.ids.receiptId);
    expect(receipts[1].evidence.base_sha).toBe(base);
    expect(receipts[1].evidence.recovery_rebase.head_sha).toBe(head);
    const task = (await pool.query('SELECT status,payload FROM tasks WHERE id=$1', [f.ids.taskId])).rows[0];
    expect(task.status).toBe('queued'); expect(task.payload.routing_receipt_id).toBe(receipts[1].id);
    for (const table of ['task_events','cecelia_events']) {
      const events = await pool.query(`SELECT payload FROM ${table} WHERE task_id=$1 AND event_type='kernel_unsealed_recovery_rebased'`, [f.ids.taskId]);
      expect(events.rows).toHaveLength(1); expect(events.rows[0].payload.actor).toBe(f.request.actor);
    }
  });

  it('两请求并发恢复只建一个正式run和一代接班收据', async () => {
    const f = await fixture();
    const results = await Promise.all([createKernelRun(pool, f.input, f.deps), createKernelRun(pool, f.input, f.deps)]);
    expect(results.map(r => r.created).sort()).toEqual([false, true]);
    expect(results[0].run.id).toBe(results[1].run.id);
    expect(results[0].run.controller_session_id).toBe(results[1].run.controller_session_id);
    expect(results[0].run.controller_generation).toBe(results[1].run.controller_generation);
    expect(results[0].run.controller_session_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(results[0].base_sha).toBe(base); expect(results[1].base_sha).toBe(base);
    expect(results[0].routing_receipt_id).toBe(results[1].routing_receipt_id);
    expect((await pool.query('SELECT count(*)::int AS n FROM work_routing_receipts WHERE task_id=$1', [f.ids.taskId])).rows[0].n).toBe(2);
  });

  it('preflight失败实际回滚新增收据、事件、payload及owner', async () => {
    const f = await fixture();
    f.deps.ensureMapImpactPreflight = async () => { throw new Error('map_projection_changed'); };
    await expect(createKernelRun(pool, f.input, f.deps)).rejects.toThrow('map_projection_changed');
    expect((await pool.query('SELECT count(*)::int AS n FROM work_routing_receipts WHERE task_id=$1', [f.ids.taskId])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT payload,status FROM tasks WHERE id=$1', [f.ids.taskId])).rows[0]).toMatchObject({ status: 'failed', payload: { base_sha: oldBase, routing_receipt_id: f.ids.receiptId } });
    expect((await pool.query('SELECT count(*)::int AS n FROM kernel_controller_sessions WHERE task_id=$1', [f.ids.taskId])).rows[0].n).toBe(0);
    for (const table of ['task_events','cecelia_events']) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE task_id=$1`, [f.ids.taskId])).rows[0].n).toBe(0);
  });

  it('已有旧签版合同的failed前任再基必须从planning重签，不能继承旧批准', async () => {
    const f = await fixture(), contractId = randomUUID();
    await pool.query(`INSERT INTO initiative_contracts (id,initiative_id,status,approved_sha)
      VALUES ($1,$2,'approved',$3)`, [contractId, f.ids.initiativeId, oldBase]);
    await pool.query('UPDATE initiative_runs SET contract_id=$2 WHERE id=$1', [f.previous.id, contractId]);
    const old = (await pool.query('SELECT * FROM initiative_runs WHERE id=$1', [f.previous.id])).rows[0];
    const result = await createKernelRun(pool, f.input, f.deps);
    expect(result.run.phase).toBe('planning'); expect(result.run.contract_id).toBeNull();
    expect(result.run.predecessor_run_id).toBe(f.previous.id);
    expect((await pool.query('SELECT * FROM initiative_runs WHERE id=$1', [f.previous.id])).rows[0]).toEqual(old);
    expect((await pool.query('SELECT status,approved_sha FROM initiative_contracts WHERE id=$1', [contractId])).rows[0])
      .toEqual({ status: 'approved', approved_sha: oldBase });
  });

  it('地图已推进或分支实际head不匹配时拒绝且零增', async () => {
    for (const error of ['recovery_rebase_map_changed', 'recovery_rebase_head_changed']) {
      const f = await fixture();
      if (error.includes('map')) f.map.freshness.repos.cecelia.source_revision = head;
      else f.deps.recoveryRebaseDeps.resolveBranchHead = async () => oldBase;
      await expect(createKernelRun(pool, f.input, f.deps)).rejects.toThrow(error);
      expect((await pool.query('SELECT count(*)::int AS n FROM work_routing_receipts WHERE task_id=$1', [f.ids.taskId])).rows[0].n).toBe(1);
    }
  });

  it('通过正规真实地图/radius/preflight重建Impact合同，不注入地图或合同替身', async () => {
    const f = await fixture();
    const scope = 'recovery-real-map';
    const manifestId = randomUUID(), projectionId = randomUUID(), assertionId = randomUUID();
    const digest = value => createHash('sha256').update(value).digest('hex');
    const manifestDigest = digest('manifest'), projectionDigest = digest('projection');
    await pool.query(`INSERT INTO map_manifest_versions
      (id,scope_key,version,source_decision_id,manifest,digest,status,activated_at)
      VALUES ($1,$2,1,$3,$4::jsonb,$5,'active',NOW())`,
      [manifestId, scope, randomUUID(), JSON.stringify({ shared_prerequisites: [] }), manifestDigest]);
    await pool.query(`INSERT INTO map_scope_repositories (scope_key,repo,adapter_key,adapter_config)
      VALUES ($1,'cecelia','recovery-test-v1','{}')`, [scope]);
    await pool.query(`INSERT INTO fact_snapshot_headers (kind,repo,source_revision,scanner_version,scanned_at,row_count)
      SELECT kind,'cecelia',$1,'recovery-test-v1',NOW(),0 FROM unnest(ARRAY['api','db_schema','test','graph']) AS kind`, [base]);
    await pool.query(`INSERT INTO graph_snapshot_versions (repo,source_revision,scanner_version,scanned_at,row_count)
      VALUES ('cecelia',$1,'recovery-test-v1',NOW(),0)`, [base]);
    await pool.query(`INSERT INTO map_projection_runs
      (id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,'recovery-test-v1',$6,'active',NOW())`,
      [projectionId, scope, manifestId, manifestDigest, JSON.stringify({ cecelia: base }), projectionDigest]);
    const cap = digest('cap'), assertion = digest('assertion');
    await pool.query(`INSERT INTO map_projection_nodes (run_id,node_id,node_type,node_key,name,source_refs,attributes)
      VALUES ($1,$2,'capability','F1','开发验收','[]','{}'),
        ($1,$3,'assertion',$4,'恢复永久断言','[]',$5::jsonb)`,
      [projectionId, cap, assertion, assertionId, JSON.stringify({
        assertion_ref: 'src/orchestrator/__tests__/recovery-rebase.test.js', assertion_revision: 1 })]);
    await pool.query(`INSERT INTO map_projection_edges
      (run_id,edge_id,edge_type,edge_key,from_node_id,to_node_id,source_refs,attributes)
      VALUES ($1,$2,'proves','recovery-proof',$3,$4,'[]','{}')`, [projectionId,digest('edge'),assertion,cap]);
    const result = await createKernelRun(pool, f.input, { recoveryRebaseDeps: {
      resolveBranchHead: async () => head, resolveCommitDiff: async () => ({ isAncestor: true, changedFiles: [] }) } });
    const impact = (await pool.query('SELECT * FROM harness_impact_contracts WHERE task_id=$1', [f.ids.taskId])).rows[0];
    expect(impact.status).toBe('active'); expect(impact.base_revision).toBe(base);
    expect(impact.manifest_digest).toBe(manifestDigest); expect(impact.projection_digest).toBe(projectionDigest);
    expect(impact.contract_body.required_assertions).toHaveLength(1);
    expect(result.run.impact_contract_policy).toBe('required');
  });
});
