import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import * as fixedGit from '../../workflow-authoring/fixed-git-source.js';
import { randomUUID,createHash } from 'node:crypto';
import {pilotPlanHash,pilotPlanBody} from '../../lib/pilot-release-verification.js';
import { versionsDatabase } from '../fixtures/definition-versions-db.js';
import { migrationTable,migrationSql,withLegacyNames } from '../fixtures/minimum-definition-schema.js';
import { minimumMapSchema } from '../fixtures/minimum-map-schema.js';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import request from 'supertest';
import { createWorkflowAuthoringRouter } from '../../routes/workflow-authoring.js';
import { scanRepo } from '../../../../../scripts/scan/scan-graph.mjs';
import { runPilotReleaseVerification } from '../../../../../scripts/ci/pilot-release-verification.mjs';
import { registerImplementationRepository,exportImplementationSnapshot,refreshImplementationSnapshot } from '../../lib/implementation-ci-snapshot.js';
import { submitMapManifest,activateMapManifest } from '../../lib/map-manifest-store.js';
import { registerCapabilityRegression } from '../../lib/capability-regressions.js';
import { createRelease } from '../../lib/release-index.js';
import { submitAuthoring } from '../../workflow-authoring/store.js';
import { validateDefinition,validateReferences,registerWorkflow,registrationDigest } from '../../workflow-authoring/registration.js';

let fixture,db,definition,taskId,state,inTransaction;
beforeEach(async()=>{
  fixture=await versionsDatabase();await fixture.migrate();db=fixture.db;
  await db.query(migrationTable('283_skill_registry_and_journey_step_links.sql','skill_registry'));
  await db.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id text,ADD COLUMN IF NOT EXISTS claimed_by text, ADD COLUMN IF NOT EXISTS result jsonb');
  const cap=randomUUID(),skill=randomUUID();
  await db.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'监控告警',$2,'active')",[cap,randomUUID()]);
  await db.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'workflow-commander','/skills/workflow-commander/SKILL.md','active')",[skill]);
  definition={key:'workflow_report',name:'输入及部署核对报告',capability_id:cap,channel:'internal',form:'openclaw_skill',version:'1.0.0',
    source:{repo:'perfectuser21/zenithjoy-workspace',ref:'commander/contracts/report.json',revision:'a'.repeat(40)},
    runtime:{skill_id:skill,entrypoint:'workflow-commander'},input_schema:{type:'object',properties:{text:{type:'string'},items:{type:'array'}},required:['text']},
    resources:{},recovery:{max_attempts:2,total_timeout_seconds:600},verification:{assertions:['真实文件读回']},
    outputs:{report:{type:'object',description:'中文\n换行 $(touch /tmp/never-run); `false`',items:[]}},
    activities:[{key:'collect',name:'读取真实状态',executor_kind:'code',acceptance:['JSON可回读'],
      implementation:{kind:'code',ref:'commander/report.js',version:'1.0.0',repo:'perfectuser21/zenithjoy-workspace',path:'commander/report.js',revision:'contract'},
      resources:{},steps:[{key:'read',name:'读回',reads:['输入'],writes:['报告'],dod:{mode:'checkpoint',readback:{type:'json',path:'report.json'}}}]}]};
  taskId=randomUUID();
  state={schema_version:1,revision:5,stage:'register',request:{operation:'create',goal:'报告',actor:'集成测试',registration_protocol:'definition-freeze-v1'},
    outputs:{intake:{capability_id:cap},compose:{definition,definition_sha256:registrationDigest(definition)},verify:{validation:{verdict:'PASS'}}},receipts:[]};
  await db.query("INSERT INTO tasks(id,title,status,claimed_by,payload,result) VALUES($1,'冻结登记验收','in_progress','test','{\"workflow_authoring\":true}',$2)",[taskId,JSON.stringify({workflow_authoring:state})]);
  const query=db.query;inTransaction=false;db.query=async(sql,args)=>{if(sql==='BEGIN')inTransaction=true;try{return await query(sql,args);}finally{if(['COMMIT','ROLLBACK'].includes(sql))inTransaction=false;}};
  db.connect=async()=>({query:db.query,release(){}});
});
afterEach(async()=>{if(fixture)await fixture.close();});
async function submit({mismatch=false}={}){
  const {source,...document}=definition;
  return submitAuthoring(db,taskId,{stage:'register',revision:5,submission_id:'register-freeze',output:{}},{
    validateDefinition,validateReferences,registerWorkflow,freezeOptions:{readFile:async s=>{
      expect(inTransaction).toBe(false);
      if(s.path===source.ref)return JSON.stringify(mismatch?{...document,resources:{device:'wrong'}}:document);
      return 'export const report = input => ({text: input.text, items: []});\n';
    }},
  });
}
it('内部能力无product-map标识，register在一事务保存完整快照、输入输出合同及实现/步骤身份',async()=>{
  const first=await submit(),receipt=first.receipt.output;
  expect(receipt.current_definition_version_id).toBeTruthy();expect(receipt.registration_protocol).toBe('definition-freeze-v1');
  const version=(await db.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[receipt.current_definition_version_id])).rows[0];
  expect(version.payload.contract).toEqual(definition);expect(version.source_commit).toBe(definition.source.revision);
  const activity=(await db.query('SELECT * FROM activity_definition_versions WHERE id=$1',[version.payload.activities[0].activity_version_id])).rows[0];
  expect(activity.payload.implementation_bindings[0]).toMatchObject({status:'verified',revision:definition.source.revision});
  expect(activity.payload.steps[0].step_id).toBeTruthy();expect(activity.payload.steps[0].contract).toEqual(definition.activities[0].steps[0]);
  expect((await db.query('SELECT capability_code FROM capabilities WHERE id=$1',[definition.capability_id])).rows[0].capability_code).toBeNull();
  const again=await submit();expect(again.replayed).toBe(true);expect(again.receipt.output).toEqual(receipt);
  expect((await db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(1);
  const saved=(await db.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.workflow_authoring;
  expect(saved.stage).toBe('completed');expect(saved.outputs.register.current_definition_version_id).toBe(version.id);
});
it('验证了其他合同文件不能冒充本请求，零版本与零workflow写入',async()=>{
  await expect(submit({mismatch:true})).rejects.toMatchObject({code:'definition_source_invalid'});
  expect((await db.query('SELECT count(*)::int n FROM workflows')).rows[0].n).toBe(0);
});
it.each([false,true])('已迁移 Skill 固定中央来源冻结；摘要错误=%s 时零新版本',async corrupt=>{
  const path='.claude/skills/demo/SKILL.md',central='perfectuser21/zenithjoy-skills',revision='b'.repeat(40);
  const content='---\nname: demo\nversion: 1\n---\ncentral\n';
  const skillId=(await db.query("SELECT id FROM skill_registry WHERE name='workflow-commander' LIMIT 1")).rows[0].id;
  definition.activities[0].implementation={kind:'skill',skill_id:skillId,repo:'perfectuser21/zenithjoy-workspace',ref:path,path,revision:'contract',name:'demo',version:'1'};
  state.outputs.compose={definition,definition_sha256:registrationDigest(definition)};
  await db.query('UPDATE tasks SET result=$2 WHERE id=$1',[taskId,JSON.stringify({workflow_authoring:state})]);
  const lock=JSON.stringify({version:1,repository:central,revision,profile:'zenithjoy',loader_sha256:'a'.repeat(64)});
  const digest=corrupt?'0'.repeat(64):createHash('sha256').update(content).digest('hex');
  const catalog=JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path,source:'business-skills/zenithjoy/demo/SKILL.md',sha256:digest}]}}});
  const {source,...document}=definition;
  const attempt=submitAuthoring(db,taskId,{stage:'register',revision:5,submission_id:'central-register',output:{}},{
    validateDefinition,validateReferences,registerWorkflow,freezeOptions:{readFile:async s=>{
      expect(inTransaction).toBe(false);
      if(s.path===source.ref)return JSON.stringify(document);
      if(s.path==='.skills-source.json')return lock;
      if(s.path==='distribution/catalog.json')return catalog;
      if(s.repo===central)return content;
      throw Error('deleted business skill must never be read');
    }},
  });
  if(corrupt){await expect(attempt).rejects.toThrow(/摘要/);expect((await db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);return;}
  const result=await attempt;
  expect(result.receipt.output.current_definition_version_id).toBeTruthy();
  // 工作流版本引用活动版本，来源证明中必须同时保留声明和解析身份。
  const binding=(await db.query('SELECT payload FROM activity_definition_versions LIMIT 1')).rows[0].payload.implementation_bindings[0];
  expect(binding).toMatchObject({repo:'perfectuser21/zenithjoy-workspace',path,resolved_source:{repo:central,revision,path:'business-skills/zenithjoy/demo/SKILL.md'}});
});
it('正式HTTP register返回冻结版本；相同提交幂等返回，后续不再重复读Git',async()=>{
  let reads=0;const {source,...document}=definition;
  const app=express();app.use(express.json());app.use('/authoring',createWorkflowAuthoringRouter({db,freezeOptions:{readFile:async s=>{
    expect(inTransaction).toBe(false);reads++;return s.path===source.ref?JSON.stringify(document):'export const report=true;';
  }}}));
  const body={stage:'register',revision:5,submission_id:'http-register',output:{}};
  const response=await request(app).post(`/authoring/runs/${taskId}/submit`).send(body);
  expect(response.status,response.body).toBe(200);expect(response.body.receipt.output.current_definition_version_id).toBeTruthy();
  const prior=reads,replayed=await request(app).post(`/authoring/runs/${taskId}/submit`).send(body);
  expect(replayed.body.replayed).toBe(true);expect(reads).toBe(prior);
});
it('网络核验期间定义变化，旧证明不能提交新合同',async()=>{
  const {source,...document}=definition;let changed=false;
  await expect(submitAuthoring(db,taskId,{stage:'register',revision:5,submission_id:'race-register',output:{}},{
    validateReferences,registerWorkflow,freezeOptions:{readFile:async s=>{
      if(!changed){changed=true;const next=structuredClone(state);next.outputs.compose.definition.recovery.max_attempts=8;
        next.outputs.compose.definition_sha256=registrationDigest(next.outputs.compose.definition);
        await db.query('UPDATE tasks SET result=$2 WHERE id=$1',[taskId,JSON.stringify({workflow_authoring:next})]);}
      return s.path===source.ref?JSON.stringify(document):'export const report=true;';
    }},
  })).rejects.toMatchObject({code:'definition_freeze_proof_invalid'});
  expect((await db.query('SELECT count(*)::int n FROM workflows')).rows[0].n).toBe(0);
});
it('快照保存失败，workflow/活动/步骤/回执全部回滚',async()=>{
  await db.query("CREATE FUNCTION reject_authoring_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'snapshot rejected'; END $$; CREATE TRIGGER reject_authoring_snapshot BEFORE INSERT ON workflow_definition_versions FOR EACH ROW EXECUTE FUNCTION reject_authoring_snapshot()");
  await expect(submit()).rejects.toThrow('snapshot rejected');
  for(const table of ['workflows','activities','workflow_activity_refs','steps','activity_definition_versions','workflow_definition_versions'])expect((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(0);
  expect((await db.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.workflow_authoring.stage).toBe('register');
});

it.each([false,true])('真实Git扫描→正式地图→authoring回归→release门禁，跨版本复用=%s',async reuseOld=>{
  const directory=mkdtempSync(join(tmpdir(),'authoring-release-')),repoRoot=join(directory,'repo');mkdirSync(repoRoot);
  const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(path,content)=>{mkdirSync(dirname(join(repoRoot,path)),{recursive:true});writeFileSync(join(repoRoot,path),content);};
  try{
    await minimumMapSchema(db);
    await withLegacyNames(db,()=>db.query(migrationSql('515_release_definition_evidence.sql')));
    await db.query(migrationSql('537_assertion_source_repo.sql'));
    git('init','-b','main');
    const oldBytes='export const report = input => ({text: input.text, items: []});\n';
    if(reuseOld){
      write('commander/report.js',oldBytes);git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-m','test: 实际旧实现');
      definition.activities[0].implementation.revision=git('rev-parse','HEAD');
    }
    const {source,...document}=definition;
    write(source.ref,JSON.stringify(document));write('commander/report.js',reuseOld?'export const changed = "HEAD不能代替旧实现";\n':oldBytes);
    write('scripts/smoke/report.sh','#!/bin/bash\nset -euo pipefail\ntest -f commander/report.js\ntest -f commander/contracts/report.json\n');
    git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-m','test: 固定报告合同');
    git('remote','add','origin',`https://github.com/${source.repo}.git`);
    source.revision=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',source.revision);
    state.outputs.compose.definition_sha256=registrationDigest(definition);
    await db.query('UPDATE tasks SET result=$2 WHERE id=$1',[taskId,JSON.stringify({workflow_authoring:state})]);
    const result=await submit();
    const config={source_repo:source.repo,definition_protocol:'definition-freeze-v1',workflow_keys:[definition.key]};
    const registration={scope_key:'commander-generic',repo:'commander-generic-workspace',adapter_key:'legacy-ledger-v1',adapter_config:config};
    await registerImplementationRepository(db,registration);
    expect((await registerImplementationRepository(db,registration)).created).toBe(false);
    expect((await scanRepo({name:'commander-generic-workspace',root:repoRoot},db)).error).toBeUndefined();
    const parent=(await db.query('SELECT parent_journey_id id FROM capabilities WHERE id=$1',[definition.capability_id])).rows[0].id;
    await db.query("INSERT INTO value_streams(id,name) VALUES($1,'运行管理')",[parent]);
    const decision=randomUUID();await db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','map','测试范围登记','active')",[decision]);
    const binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:source.repo,source_revision:source.revision});
    const draft=await submitMapManifest(db,{schema_version:1,scope_key:'commander-generic',source_decision_id:decision,
      value_streams:[{key:'runtime',name:'运行管理',perceiver:'负责人',order:1,brain_binding:binding('value_stream',parent)}],
      capabilities:[{key:'monitor',name:'监控告警',order:1,value_stream_key:'runtime',brain_binding:binding('capability',definition.capability_id)}],
      boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:'独立报告'}});
    await activateMapManifest(db,draft.manifest_version.id);
    const query={scope:'commander-generic',repo:source.repo,revision:source.revision};
    let snapshot=await exportImplementationSnapshot(db,query);expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
    const activity=snapshot.definitions.activities[0];
    for(const stepId of [null,activity.payload.steps[0].step_id])await registerCapabilityRegression(db,{capability_id:definition.capability_id,activity_id:activity.activity_id,step_id:stepId,assertion_ref:'scripts/smoke/report.sh'});
    const readFixed=s=>Promise.resolve(execFileSync('git',['show',`${s.revision}:${s.path}`],{cwd:repoRoot,encoding:'utf8'}));
    snapshot=await refreshImplementationSnapshot(db,query,{fetchFn:async()=>({ok:true,text:async()=>source.revision}),resolveToken:async()=> 'fixture',authoringSourceOptions:{readFile:readFixed}});
    const {report,receipt}=await runPilotReleaseVerification({repoRoot,snapshot,outputDir:join(directory,'evidence'),event:'workflow_dispatch',ref:'refs/heads/main',authoringSourceOptions:{readFile:readFixed}});
    expect(receipt.verdict).toBe('PASS');expect(report.expected_usages).toHaveLength(2);
    const b=activity.payload.implementation_bindings[0],w=snapshot.definitions.workflows[0];
    const sourceReader=vi.spyOn(fixedGit,'readFixedGitFile').mockImplementation(readFixed);
    const input={release_key:'authoring-report',environment:'scratch',target:'fixture',actor:'test:authoring',
      workflows:[{workflow_definition_version_id:result.receipt.output.current_definition_version_id,payload_sha256:w.payload_sha256}],
      components:[{kind:'repo',repo:source.repo,revision:source.revision},...(reuseOld?[{kind:'repo',repo:b.repo,revision:b.revision}]:[]),{kind:b.kind,repo:b.repo,path:b.path,revision:b.revision,digest:b.digest}],
      ci_evidence:[{report,receipt,evidence_ref:'scratch:真实回归执行'}]};
    let release;try{
      release=await createRelease(db,input);
      if(reuseOld){
        for(const kind of ['source-set','snapshot','wrong-fixed-bytes']){
          const changed=structuredClone(input),e=changed.ci_evidence[0];changed.release_key=`tampered-${kind}`;
          if(kind==='source-set')e.report.implementation_source_set[0].revision=source.revision;
          if(kind==='snapshot')e.report.snapshot_sha256='0'.repeat(64);
          if(kind==='wrong-fixed-bytes')sourceReader.mockImplementation(s=>s.path==='commander/report.js'?Promise.resolve(readFileSync(join(repoRoot,s.path),'utf8')):readFixed(s));
          e.report.assertion_plan_sha256=pilotPlanHash(pilotPlanBody(e.report));
          e.receipt.assertion_plan_sha256=e.report.assertion_plan_sha256;e.receipt.snapshot_sha256=e.report.snapshot_sha256;
          e.receipt.report_sha256=createHash('sha256').update(JSON.stringify(e.report)).digest('hex');
          const rejected=await createRelease(db,changed);expect(rejected.release.payload.verification.ci_status,kind).toBe('unknown');
        }
      }else{
        const legacy=structuredClone(input),e=legacy.ci_evidence[0];legacy.release_key='legacy-same-head-authoring';
        delete e.report.implementation_source_set;
        e.report.assertion_plan_sha256=pilotPlanHash(pilotPlanBody(e.report));
        e.receipt.assertion_plan_sha256=e.report.assertion_plan_sha256;
        e.receipt.report_sha256=createHash('sha256').update(JSON.stringify(e.report)).digest('hex');
        expect((await createRelease(db,legacy)).release.payload.verification.ci_status).toBe('verified');
      }
    }finally{sourceReader.mockRestore();}
    expect(release.release.payload.verification.ci_status).toBe('verified');
    expect(release.release.payload.verification.status).toBe('verified');
    const missing=await exportImplementationSnapshot(db,{...query,revision:'b'.repeat(40)});
    expect(missing.status).toBe('unknown');expect(missing.gaps).toContainEqual(expect.objectContaining({code:'authoring_definition_missing'}));
  }finally{rmSync(directory,{recursive:true,force:true});}
});
