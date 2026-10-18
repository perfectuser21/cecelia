import {it,expect} from 'vitest';
import {privateFixtureDatabase} from '../fixtures/private-fixture-db.js';
import {createRoutedTask,loadRepositoryFacts} from '../../work-routing-store.js';
import {pickCandidates} from '../../../scripts/coding-workflow/runner/lib/plan.mjs';
import {seedActiveF1,ensureRouteValidationFixtureSchema} from '../fixtures/work-routing-fixture.js';
const ROUTING_EVIDENCE={branch:'cp-skills-routing-fixture',base_sha:'a'.repeat(40)};

it('Skills source_repo aliases persist canonical coding tasks that the runner can claim',async()=>{
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
   const created=await createRoutedTask(client,{source:'api',source_id:'skills-runner-'+crypto.randomUUID(),title:'Skills runner PG fixture '+alias,mutation_intent:'write',declared_change_kind:'bugfix',repo_hint:alias,map_scope_hint:['skill_distribution'],...ROUTING_EVIDENCE},facts,{transaction:'existing'});
   const task=(await client.query('SELECT * FROM tasks WHERE id=$1',[created.task_id])).rows[0];
   expect(task.task_type).toBe('coding_workflow');expect(task.payload.repo).toBe('zenithjoy-skills');
   expect(pickCandidates([task])[0]?.repoKey).toBe('zenithjoy-skills');expect(pickCandidates([task],{enabled:['cecelia']})).toEqual([]);
  }
 }finally{await fixture.close();}
});
