/** [BEHAVIOR] 真 PostgreSQL：注册重放、冲突回滚、历史与未来 Run 关联；不用生产库。 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { companyKrSpec as spec, registerCompanyKrWorkflow } from '../../lib/company-kr-registration.js';

let client, schema, db;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database==='cecelia_scratch' || (process.env.CI==='true' && DB_DEFAULTS.database==='cecelia_test'))) throw new Error('登记测试只允许 scratch/test');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  expect((await client.query('SELECT current_database() AS name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `kr_registration_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['journeys','workflows','ops_agents','journey_steps','steps','ops_workflows','tasks','task_runs','schema_version','spans','enablers','enabler_calls','areas']) {
    await client.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  await client.query(`SET search_path TO ${schema},public`);
  await client.query(readFileSync(new URL('../../../migrations/511_shared_activity_refs.sql',import.meta.url),'utf8'));
  await client.query(readFileSync(new URL('../../../migrations/512_definition_versions.sql',import.meta.url),'utf8'));
  db = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
  await client.query(`INSERT INTO journeys(id,name,parent_journey_id,capability_code) VALUES($1,'管家 · G5 算力与基础设施调度',$2,'G5')`, [spec.capability_id, randomUUID()]);
  await client.query(`INSERT INTO ops_agents(id,source,host_alias,name) VALUES(1,'openclaw','mmv',$1)`, [spec.agent]);
  await client.query(`INSERT INTO ops_workflows(id,source,wf_id,name) VALUES(1,'scheduler',$1,$1)`, [spec.runtime]);
});
afterEach(async () => {
  if (client) { await client.query('ROLLBACK'); await client.query('SET search_path TO public'); if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
});
async function seedRun(runId) {
  const task = randomUUID();
  await client.query(`INSERT INTO tasks(id,title,dept,payload) VALUES($1,$3,$2,'{"company_kr_analysis":{"version":1}}')`, [task, spec.agent, `公司KR真实测试 ${runId}`]);
  await client.query(`INSERT INTO task_runs(task_id,run_id,status,started_at,ended_at,result)
    VALUES($1,$2,'success','2026-10-01T00:00:00Z','2026-10-01T00:01:00Z','{"exit_code":0}')`, [task, runId]);
}
describe('KR 注册事务', () => {
  it('首次写入5活动8步骤，重放不重复；前后产生的Run均关联且事实不变', async () => {
    await seedRun('old');
    const before = (await client.query('SELECT status,started_at,ended_at,result FROM task_runs')).rows[0];
    const first = await registerCompanyKrWorkflow(db);
    expect(first.activities).toBe(5); expect(first.steps.inserted).toBe(8); expect(first.runs).toHaveLength(1);
    await seedRun('future');
    const again = await registerCompanyKrWorkflow(db);
    expect(again.workflow_id).toBe(first.workflow_id); expect(again.steps.unchanged).toBe(8); expect(again.runs).toHaveLength(1);
    expect((await client.query('SELECT count(*)::int AS n FROM workflows')).rows[0].n).toBe(1);
    expect((await client.query('SELECT count(*)::int AS n FROM journey_steps')).rows[0].n).toBe(5);
    expect((await client.query('SELECT status,started_at,ended_at,result FROM task_runs WHERE run_id=$1',['old'])).rows[0]).toEqual(before);
    expect((await client.query('SELECT workflow_id FROM task_runs')).rows.every(r=>r.workflow_id===first.workflow_id)).toBe(true);
  });
  it('末尾运行时归属冲突使前面所有新增与G5改名全回滚', async () => {
    await client.query('UPDATE ops_workflows SET workflow_id=$1',[randomUUID()]);
    await expect(registerCompanyKrWorkflow(db)).rejects.toThrow('归属');
    expect((await client.query('SELECT count(*)::int AS n FROM workflows')).rows[0].n).toBe(0);
    expect((await client.query('SELECT count(*)::int AS n FROM journey_steps')).rows[0].n).toBe(0);
    expect((await client.query('SELECT count(*)::int AS n FROM steps')).rows[0].n).toBe(0);
    expect((await client.query('SELECT name FROM journeys')).rows[0].name).toContain('算力');
  });
  it('相同步骤key已有其它工作流时拒绝抢占', async () => {
    const first=await registerCompanyKrWorkflow(db);
    await client.query(`UPDATE journey_steps SET workflow_id=$1 WHERE activity_key='sync'`,[randomUUID()]);
    await expect(registerCompanyKrWorkflow(db)).rejects.toThrow('活动归属冲突');
    expect((await client.query('SELECT id FROM workflows')).rows[0].id).toBe(first.workflow_id);
  });
  it('KR快照固定真实配置commit，错误commit内容不得给缓存spec盖戳',async()=>{
    const result=await registerCompanyKrWorkflow(db);
    const rows=(await client.query('SELECT * FROM workflow_definition_versions WHERE workflow_id=$1',[result.workflow_id])).rows;
    expect(rows).toHaveLength(1);expect(rows[0].source_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0].payload.contract).toEqual(spec);
    const before=(await client.query('SELECT * FROM journey_steps ORDER BY id')).rows;
    await expect(registerCompanyKrWorkflow(db,{revision:'e'.repeat(40),readSource:async()=>JSON.stringify({...spec,name:'冒名版本'})})).rejects.toThrow('配置与固定commit不一致');
    expect((await client.query('SELECT * FROM journey_steps ORDER BY id')).rows).toEqual(before);
  });

});
