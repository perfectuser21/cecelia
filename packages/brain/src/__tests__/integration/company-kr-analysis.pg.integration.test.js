import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { requestCompanyKrAnalysis, configureCompanyAnalysis, consumeCompanyAnalysis, companyAnalysisSnapshot } from '../../lib/company-kr-analysis.js';
import { companyMetric, COMPANY_KR_DATABASE, companyFormalRevision } from '../../lib/company-kr-metrics.js';

describe('公司KR分析真实任务账', () => {
  it('真实路由登记并去重；可信建议落库且正式数值不变；改值后旧建议拒收', async () => {
    const pool = new pg.Pool({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'cecelia_test', user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD });
    const client = await pool.connect();
    const krId = randomUUID(), pageId = randomUUID(); let serial = 0;
    const query = (sql, args) => {
      if (sql.startsWith('SELECT *,updated_at::text AS observation_version FROM key_results')) sql = sql.replace('ORDER BY id', `AND id='${krId}' ORDER BY id`);
      if (sql.startsWith('SELECT * FROM tasks WHERE payload')) sql = sql.replace('ORDER BY', `AND payload->'company_kr_analysis'->'items'->0->>'id'='${krId}' ORDER BY`);
      return client.query(sql, args);
    };
    const scoped = { query, connect: async () => {
      const savepoint = `analysis_${++serial}`;
      return { query: (sql, args) => query(sql === 'BEGIN' ? `SAVEPOINT ${savepoint}` : sql === 'COMMIT' ? `RELEASE SAVEPOINT ${savepoint}` : sql === 'ROLLBACK' ? `ROLLBACK TO SAVEPOINT ${savepoint}` : sql, args), release() {} };
    } };
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO key_results(id,title,status,current_value,target_value,unit,metadata,custom_props) VALUES($1,'公司KR分析PG回归','active',0,10,'条',$2::jsonb,$3::jsonb)",
        [krId, JSON.stringify({ metric_mode: 'company_formula_v1', company_status: 'Open', company_metric: companyMetric(0, 0, 10) }), JSON.stringify({ company_notion: { database_id: COMPANY_KR_DATABASE, page_id: pageId, goal_id: randomUUID(), area_ids: [] } })]);
      await configureCompanyAnalysis(scoped, { enabled: true, hour: 8 });
      const now = new Date('2026-10-01T01:00:00Z');
      const started = await requestCompanyKrAnalysis(scoped, { now, manual: true });
      expect(started.success).toBe(true);
      let task = (await client.query('SELECT * FROM tasks WHERE id=$1', [started.task_id])).rows[0];
      expect(task.task_type).toBe('qiumi_task');
      expect(task.payload.qiumi_source.body).toContain('执行Agent：company-kr-analyst');
      expect(task.payload.company_kr_analysis.items[0].id).toBe(krId);
      expect(await requestCompanyKrAnalysis(scoped, { now, manual: true })).toMatchObject({ skipped: true, task_id: task.id, reason: 'in_progress' });
      await client.query("UPDATE tasks SET status='in_progress',executor_kind='openclaw-agent' WHERE id=$1", [task.id]);
      task = (await client.query('SELECT * FROM tasks WHERE id=$1', [task.id])).rows[0];
      const before = (await client.query('SELECT * FROM key_results WHERE id=$1', [krId])).rows[0];
      const input = task.payload.company_kr_analysis;
      const text = JSON.stringify({ snapshot_id: input.snapshot_id, items: [{ id: krId, suggested_current: null, suggested_target: null, reason: '暂无独立线索证据，先采集来源与去重记录。', evidence: input.items[0].evidence }] });
      expect(await consumeCompanyAnalysis(scoped, task, { text }, { now })).toMatchObject({ saved: [krId], stale: [] });
      const after = (await client.query('SELECT * FROM key_results WHERE id=$1', [krId])).rows[0];
      expect(after.current_value).toBe(before.current_value);
      expect(after.target_value).toBe(before.target_value);
      expect(companyFormalRevision(after)).toBe(companyFormalRevision(before));
      expect(after.metadata.company_advice.task_id).toBe(task.id);
      expect((await client.query('SELECT result FROM tasks WHERE id=$1', [task.id])).rows[0].result.company_kr_advice).toHaveLength(1);
      await consumeCompanyAnalysis(scoped, task, { text }, { now });
      expect((await client.query('SELECT result FROM tasks WHERE id=$1', [task.id])).rows[0].result.company_kr_advice).toHaveLength(1);
      await client.query("UPDATE key_results SET metadata=jsonb_set(metadata,'{company_metric,target}','20'::jsonb),target_value=20 WHERE id=$1", [krId]);
      const latest = await companyAnalysisSnapshot(scoped, now);
      expect(latest.formal_hash).not.toBe(input.formal_hash);
      // 新运行持旧快照不能将建议冒充对应新目标；旧运行幂等回执仅返回历史。
      const staleId = randomUUID();
      await client.query("INSERT INTO tasks(id,title,status,task_type,executor_kind,payload) VALUES($1,'过期建议回归','in_progress','qiumi_task','openclaw-agent',$2::jsonb)", [staleId, JSON.stringify(task.payload)]);
      const stale = await consumeCompanyAnalysis(scoped, { ...task, id: staleId }, { text }, { now });
      expect(stale.saved).toEqual([]); expect(stale.stale.map(i => i.id)).toEqual([krId]);
      await client.query("UPDATE tasks SET status='completed_no_pr',created_at=clock_timestamp()-interval '3 seconds' WHERE id=ANY($1::uuid[])", [[task.id, staleId]]);
      const changed = await requestCompanyKrAnalysis(scoped, { now });
      expect(changed.success).toBe(true);
      await client.query("UPDATE tasks SET status='completed_no_pr',created_at=clock_timestamp()-interval '1 second' WHERE id=$1", [changed.task_id]);
      await client.query("UPDATE key_results SET metadata=jsonb_set(metadata,'{company_metric,target}','\"10\"'::jsonb),target_value=10 WHERE id=$1", [krId]);
      const restored = await requestCompanyKrAnalysis(scoped, { now });
      expect(restored.success).toBe(true);
      expect(restored.task_id).not.toBe(task.id);
      expect((await client.query('SELECT status FROM tasks WHERE id=$1', [restored.task_id])).rows[0].status).toBe('queued');
      expect(await requestCompanyKrAnalysis(scoped, { now })).toMatchObject({ skipped: true, task_id: restored.task_id, reason: 'in_progress' });
      await client.query("UPDATE key_results SET status='archived' WHERE id=$1", [krId]);
      expect((await companyAnalysisSnapshot(scoped, now)).items).toEqual([]);
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
  });
});
