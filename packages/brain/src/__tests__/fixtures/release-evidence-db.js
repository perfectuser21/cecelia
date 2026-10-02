import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { implementationImpactDatabase, IMPACT_REPO } from './implementation-impact-db.js';
import { readImplementationImpact } from '../../lib/implementation-impact.js';
import { DB_DEFAULTS } from '../../db-config.js';
export const RELEASE_HEAD='b'.repeat(40);
export async function releaseEvidenceDatabase(options={}){
  const releaseHead=options.headRevision||RELEASE_HEAD;
  const fixture=await implementationImpactDatabase(options); const {db,ids}=fixture; let pool;
  try {
    for(const activity of (await db.query('SELECT id,capability_key,activity_key,contract FROM journey_steps')).rows){
      const key=activity.contract.steps[0].key;
      await db.query('INSERT INTO steps(activity_id,step_order,key,activity_key) VALUES($1,1,$2,$3)',[activity.id,`${activity.capability_key}.${activity.activity_key}.${key}`,activity.activity_key]);
    }
    for(const doc of Object.values(fixture.contracts.docs))for(const activity of doc.activities)for(const step of activity.steps||[])delete step.implementation;
    if(options.fullActivityBindings)for(const doc of Object.values(fixture.contracts.docs))for(const activity of doc.activities)if(!activity.ref)activity.implementation_bindings=[{kind:'code',repo:IMPACT_REPO,path:'src/controller.js',revision:releaseHead}];
    await fixture.advance();
    const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
    pool=new pg.Pool({...DB_DEFAULTS,max:6,options:`-c search_path=${schema}`});
    const migration=new URL('../../../migrations/515_release_definition_evidence.sql',import.meta.url);
    if(!existsSync(migration))throw Error('发布证据迁移515必须存在');
    await db.query(readFileSync(migration,'utf8'));
    const workflows=(await db.query('SELECT * FROM workflow_definition_versions WHERE source_commit=$1 ORDER BY workflow_id',[releaseHead])).rows;
    const activities=(await db.query('SELECT * FROM activity_definition_versions WHERE source_commit=$1 ORDER BY activity_id',[releaseHead])).rows;
    const bound=activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code')),binding=bound.payload.implementation_bindings.find(b=>b.kind==='code');
    const enabler=randomUUID(),call=randomUUID();
    await db.query("INSERT INTO enablers(id,key,name,kind,impl_ref) VALUES($1,'test-lock','锁','code',$2)",[enabler,`${IMPACT_REPO}@${releaseHead}:${binding.path}`]);
    await db.query("INSERT INTO enabler_calls(id,caller_type,caller_id,enabler_id) VALUES($1,'activity',$2,$3)",[call,bound.activity_id,enabler]);
    const report=await readImplementationImpact(db,{scope:options.scope||'phones',repo:IMPACT_REPO,base_revision:options.baseRevision||'a'.repeat(40),head_revision:releaseHead,changed_files:['src/shared-lock.js']});
    const receipt={schema_version:1,actor:'implementation_ci_gate',source:report.source,report_sha256:createHash('sha256').update(JSON.stringify(report)).digest('hex'),verdict:'PASS',scope:'regression_tests',business_runtime_status:'not_evaluated',recorded_at:new Date().toISOString(),assertions:report.required_assertions.map(a=>({assertion_ref:a.assertion_ref,source_repo:a.source_repo,source_revision:releaseHead,source_bindings:a.source_bindings,test_sha256:'f'.repeat(64),exit_code:0,error:null,signal:null}))};
    const releaseInput={release_key:'fixture-release',environment:'scratch',target:'fixture-host',actor:'test:release',workflows:workflows.map(w=>({workflow_definition_version_id:w.id,payload_sha256:w.payload_sha256})),components:[{kind:'repo',repo:IMPACT_REPO,revision:releaseHead},{kind:binding.kind,repo:binding.repo,path:binding.path,revision:binding.revision,digest:binding.digest}],ci_evidence:[{report,receipt,evidence_ref:'fixture:ci-report'}]};
    const observationInput={event_key:'observed-1',attempt_key:'deploy-1',environment:'scratch',target:'fixture-host',components:releaseInput.components,collector:'fixture-collector',observed_at:new Date().toISOString(),evidence_ref:'fixture:actual-readback'};
    function runInput(release,observation,workflow=workflows[0]){
      return {release_id:release.id,observation_id:observation.id,workflow_id:workflow.workflow_id,workflow_definition_version_id:workflow.id,snapshot_sha256:workflow.payload_sha256,runtime_snapshot_sha256:createHash('sha256').update(JSON.stringify({workflow,activities,environment:release.environment,target:release.target})).digest('hex'),source_kind:'external',external_origin:'fixture-worker',attempt_key:'run-attempt-1',actor:'test:runner',expected_path:workflow.payload.activities.flatMap(ref=>{const base={reference_id:ref.reference_id,activity_id:ref.activity_id,activity_definition_version_id:ref.activity_version_id,required:true};return [base,...(activities.find(a=>a.id===ref.activity_version_id)?.payload.steps||[]).filter(s=>s.step_id).map(s=>({...base,step_id:s.step_id}))];})};
    }
    return {...fixture,db:pool,workflows,activities,ids,enabler,call,releaseInput,observationInput,runInput,async close(){await pool.end();await fixture.close();}};
  }catch(error){await pool?.end();await fixture.close();throw error;}
}
