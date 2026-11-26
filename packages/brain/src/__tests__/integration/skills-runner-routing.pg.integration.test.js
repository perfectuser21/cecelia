import {it,expect} from 'vitest';
import {privateFixtureDatabase} from '../fixtures/private-fixture-db.js';
import {createRoutedTask,loadRepositoryFacts} from '../../work-routing-store.js';
import {seedActiveF1,ensureRouteValidationFixtureSchema} from '../fixtures/work-routing-fixture.js';
const ROUTING_EVIDENCE={branch:'cp-skills-routing-fixture',base_sha:'a'.repeat(40)};

it('Skills源码别名可登记有头开发，未配置的Agent仓库明确拒绝',async()=>{
 const fixture=await privateFixtureDatabase('skillsrouting',async db=>{
  for(const table of ['tasks','initiative_runs','cecelia_events','work_routing_receipts','map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','decisions'])
   await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
 });
 const client=fixture.client;
 try{
  await client.query('BEGIN');await ensureRouteValidationFixtureSchema(client);
  await client.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('skills-runner-test','zenithjoy-skills','skills-v1',$1) ON CONFLICT(repo) DO UPDATE SET scope_key=EXCLUDED.scope_key,adapter_config=EXCLUDED.adapter_config",[JSON.stringify({source_repo:'perfectuser21/zenithjoy-skills'})]);
  await seedActiveF1(client,'skills-runner-test','skill_distribution');
  const facts=await loadRepositoryFacts(client);
  for(const alias of ['zenithjoy-skills','perfectuser21/zenithjoy-skills','https://github.com/perfectuser21/zenithjoy-skills.git']){
   const created=await createRoutedTask(client,{source:'api',source_id:'skills-runner-'+crypto.randomUUID(),title:'Skills headed PG fixture '+alias,metadata:{headed_manual:'true'},mutation_intent:'write',declared_change_kind:'bugfix',repo_hint:alias,map_scope_hint:['skill_distribution'],...ROUTING_EVIDENCE},facts,{transaction:'existing'});
   const task=(await client.query('SELECT * FROM tasks WHERE id=$1',[created.task_id])).rows[0];
   expect(task.task_type).toBe('dev');expect(task.payload.repo).toBe('zenithjoy-skills');
   expect(task.payload.headed_manual).toBe('true');expect(task.payload).not.toHaveProperty('coding_workflow');
  }
 }finally{await fixture.close();}
});
