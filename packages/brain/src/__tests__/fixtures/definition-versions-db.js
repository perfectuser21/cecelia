import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync,existsSync } from 'node:fs';
import { DB_DEFAULTS } from '../../db-config.js';
export async function versionsDatabase() {
  if (!(DB_DEFAULTS.database==='cecelia_scratch'||process.env.CI==='true'&&DB_DEFAULTS.database==='cecelia_test')) throw Error('仅允许scratch/CI测试库');
  const client=new pg.Client(DB_DEFAULTS);await client.connect();
  if((await client.query('SELECT current_database() AS name')).rows[0].name!==DB_DEFAULTS.database) throw Error('数据库身份不匹配');
  const schema=`versions_${randomUUID().replaceAll('-','')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  for(const table of ['areas','schema_version','journeys','workflows','journey_steps','steps','spans','enablers','enabler_calls','ops_agents','ops_workflows','tasks','task_runs']) await client.query(`CREATE TABLE ${schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
  await client.query(`SET search_path TO ${schema}`);
  const db={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release(){}})};
  return {client,db,async migrate(){
    for(const file of ['511_shared_activity_refs.sql','512_definition_versions.sql']) {
      const path=new URL(`../../../migrations/${file}`,import.meta.url);
      if(!existsSync(path)) throw Error(`版本迁移不存在: ${file}`);
      await client.query(readFileSync(path,'utf8'));
    }
  },async close(){await client.query('ROLLBACK');await client.query('SET search_path TO public');await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}};
}
export async function seedWorkflows(db){
  const valueStream=randomUUID(),keywordCapability=randomUUID(),benchmarkCapability=randomUUID(),keyword=randomUUID(),benchmark=randomUUID();
  await db.query(`INSERT INTO journeys(id,name,parent_journey_id) VALUES($1,'价值流',NULL),($2,'关键词',$1),($3,'对标',$1)`,[valueStream,keywordCapability,benchmarkCapability]);
  await db.query(`INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$3,'douyin_keyword_leadgen','关键词','douyin'),($2,$4,'douyin_benchmark_leadgen','对标','douyin')`,[keyword,benchmark,keywordCapability,benchmarkCapability]);
  return {valueStream,keyword,benchmark};
}
