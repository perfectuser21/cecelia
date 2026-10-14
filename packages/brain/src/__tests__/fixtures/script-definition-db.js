/** 真Git、正式freeze-v1、完整CI回归与可信部署观测；仅私有scratch schema。 */
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {versionsDatabase} from './definition-versions-db.js';
import {migrationTable,migrationSql,withLegacyNames} from './minimum-definition-schema.js';
import {minimumMapSchema} from './minimum-map-schema.js';
import {submitAuthoring} from '../../workflow-authoring/store.js';
import {validateDefinition,validateReferences,registerWorkflow,registrationDigest} from '../../workflow-authoring/registration.js';
import {scanRepo} from '../../../../../scripts/scan/scan-graph.mjs';
import {runPilotReleaseVerification} from '../../../../../scripts/ci/pilot-release-verification.mjs';
import {registerImplementationRepository,exportImplementationSnapshot,refreshImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import {submitMapManifest,activateMapManifest} from '../../lib/map-manifest-store.js';
import {registerCapabilityRegression} from '../../lib/capability-regressions.js';
import {createRelease,recordReleaseObservation} from '../../lib/release-index.js';
export async function scriptDefinitionDatabase(){
  const f=await versionsDatabase(),db=f.db,root=mkdtempSync(join(tmpdir(),'script-definition-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(path,content)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),content);};
  try{
    await f.migrate();await minimumMapSchema(db);
    await db.query(migrationTable('283_skill_registry_and_journey_step_links.sql','skill_registry'));
    await withLegacyNames(db,()=>db.query(migrationSql('515_release_definition_evidence.sql')));
    await db.query(migrationSql('537_assertion_source_repo.sql'));
    await db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS claimed_by text, ADD COLUMN IF NOT EXISTS result jsonb,
      ADD COLUMN IF NOT EXISTS task_type text, ADD COLUMN IF NOT EXISTS executor_kind text;
      CREATE TABLE task_events(task_id uuid,event_type text,payload jsonb,created_at timestamptz)`);
    const cap=randomUUID(),parent=randomUUID(),skill=randomUUID(),author=randomUUID(),repo='perfectuser21/zenithjoy-workspace';
    await db.query("INSERT INTO value_streams(id,name) VALUES($1,'执行观察')",[parent]);
    await db.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'脚本绑定',$2,'active')",[cap,parent]);
    await db.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'workflow-commander','/skills/workflow-commander/SKILL.md','active')",[skill]);
    const command='/usr/bin/python3 '+join(root,'scripts/probe.py');
    const definition={key:'script_binding_fixture',name:'真实脚本固定定义',capability_id:cap,channel:'internal',form:'openclaw_skill',version:'1.0.0',
      source:{repo,ref:'contracts/script.json',revision:'a'.repeat(40)},
      runtime:{skill_id:skill,entrypoint:'workflow-commander',script:{host:'mmv',cwd:null,env:{},commands:[command]}},
      input_schema:{type:'object'},resources:{},recovery:{max_attempts:2,total_timeout_seconds:600},verification:{assertions:['回读文件']},outputs:{report:{type:'object'}},
      activities:[{key:'probe',name:'读回',executor_kind:'code',acceptance:['输出可读'],
        implementation:{kind:'code',ref:'scripts/probe.py',version:'1.0.0',repo,path:'scripts/probe.py',revision:'contract'},
        resources:{},steps:[{key:'read',name:'读回',reads:['输入'],writes:['报告'],dod:{mode:'checkpoint',readback:{type:'json',path:'report.json'}}}]}]};
    const {source,...document}=definition;write(source.ref,JSON.stringify(document));write('scripts/probe.py','print("actual-script-output")\n');
    write('scripts/smoke/probe.sh','#!/bin/bash\nset -euo pipefail\npython3 scripts/probe.py | python3 -c \'import sys; assert sys.stdin.read().strip() == "actual-script-output"\'\n');
    git('init','-b','main');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-m','test: 完整脚本固定来源');
    git('remote','add','origin',`https://github.com/${repo}.git`);source.revision=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',source.revision);
    const state={schema_version:1,revision:5,stage:'register',request:{operation:'create',goal:'脚本固定身份',actor:'test:script',registration_protocol:'definition-freeze-v1'},
      outputs:{intake:{capability_id:cap},compose:{definition,definition_sha256:registrationDigest(definition)},verify:{validation:{verdict:'PASS'}}},receipts:[]};
    await db.query("INSERT INTO tasks(id,title,status,claimed_by,payload,result) VALUES($1,'冻结脚本','in_progress','test','{\"workflow_authoring\":true}',$2)",[author,{workflow_authoring:state}]);
    const registered=await submitAuthoring(db,author,{stage:'register',revision:5,submission_id:'freeze-script',output:{}},{validateDefinition,validateReferences,registerWorkflow,
      freezeOptions:{readFile:async s=>readFileSync(join(root,s.path),'utf8')}});
    const scope='script-binding-fixture';await registerImplementationRepository(db,{scope_key:scope,repo:'script-binding-workspace',adapter_key:'legacy-ledger-v1',adapter_config:{source_repo:repo,definition_protocol:'definition-freeze-v1',workflow_keys:[definition.key]}});
    const scanned=await scanRepo({name:'script-binding-workspace',root},db);if(scanned.error)throw Error(scanned.error);
    const decision=randomUUID();await db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','map','真实隔离范围','active')",[decision]);
    const binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:repo,source_revision:source.revision});
    const draft=await submitMapManifest(db,{schema_version:1,scope_key:scope,source_decision_id:decision,
      value_streams:[{key:'execution',name:'执行',perceiver:'负责人',order:1,brain_binding:binding('value_stream',parent)}],
      capabilities:[{key:'script',name:'脚本',order:1,value_stream_key:'execution',brain_binding:binding('capability',cap)}],boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:'独立脚本'}});
    await activateMapManifest(db,draft.manifest_version.id);const query={scope,repo,revision:source.revision};let snapshot=await exportImplementationSnapshot(db,query);
    const activity=snapshot.definitions.activities[0];for(const step of [null,activity.payload.steps[0].step_id])await registerCapabilityRegression(db,{capability_id:cap,activity_id:activity.activity_id,step_id:step,assertion_ref:'scripts/smoke/probe.sh'});
    snapshot=await refreshImplementationSnapshot(db,query,{fetchFn:async()=>({ok:true,text:async()=>source.revision}),resolveToken:async()=> 'fixture',authoringSourceOptions:{readFile:async s=>readFileSync(join(root,s.path),'utf8')}});
    const {report,receipt}=await runPilotReleaseVerification({repoRoot:root,snapshot,outputDir:join(root,'evidence'),event:'workflow_dispatch',ref:'refs/heads/main'});
    const a=activity.payload.implementation_bindings[0],w=snapshot.definitions.workflows[0],target='mmv:'+root;
    const release=(await createRelease(db,{release_key:'script-fixture',environment:'scratch',target,actor:'test:script',workflows:[{workflow_definition_version_id:w.id,payload_sha256:w.payload_sha256}],
      components:[{kind:'repo',repo,revision:source.revision},{kind:a.kind,repo:a.repo,path:a.path,revision:a.revision,digest:a.digest}],ci_evidence:[{report,receipt,evidence_ref:'scratch:actual-script-regression'}]})).release;
    const observation=(await recordReleaseObservation(db,release.id,{event_key:'install-1',attempt_key:'install-1',environment:'scratch',target,components:release.payload.components,collector:'fixture-collector',observed_at:new Date().toISOString(),evidence_ref:'scratch:readback-fixed-git-files'},{trustedCollector:'fixture-collector'})).observation;
    return {...f,db,definition,command,release,observation,workflow:w,activities:snapshot.definitions.activities,
      registered,async close(){await f.close();rmSync(root,{recursive:true,force:true});}};
  }catch(error){await f.close();rmSync(root,{recursive:true,force:true});throw error;}
}
