import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {pilotPlanHash} from '../../../packages/brain/src/lib/pilot-release-verification.js';
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
export function foundationFixture(t,options={}){
 const root=mkdtempSync(join(tmpdir(),'pilot-foundation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const put=(cwd,p,b)=>{mkdirSync(dirname(join(cwd,p)),{recursive:true});writeFileSync(join(cwd,p),b);};
 const init=cwd=>{mkdirSync(cwd,{recursive:true});git(cwd,'init','-q','-b','cp-fixture');git(cwd,'config','core.hooksPath','/dev/null');};
 const commit=cwd=>{git(cwd,'add','.');git(cwd,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git(cwd,'rev-parse','HEAD');};
 const repo='perfectuser21/zenithjoy-workspace',cache=join(root,'.skills-source'),skill='services/phone-adb-controller/skills/demo/SKILL.md',source='business-skills/demo/SKILL.md',content='fixed central skill\n',host='services/phone-adb-controller/host.mjs',profilePath='services/phone-adb-controller/profiles/demo.json';
 init(root);init(cache);put(cache,source,content);put(cache,'distribution/catalog.json',JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path:skill,source,sha256:hash(content)}]}}}));const central=commit(cache);
 const lock={version:1,repository:'perfectuser21/zenithjoy-skills',revision:central,profile:'zenithjoy',loader_sha256:'a'.repeat(64)};
 put(root,'.gitignore','.skills-source/\nservices/phone-adb-controller/skills/\noutput*/\n');put(root,'.skills-source.json',JSON.stringify(lock));put(root,host,'export const host = "A";\n');
 const profile={contract:{activities:[{key:'run'}]},profile:{files:{[host]:hash('export const host = "A";\n'),[skill]:hash(content)},skill_runtime:{activities:{run:{skill}}},leadgen:{method_repository:lock.repository,method_revision:central}}};
 options.profile?.(profile);const profileBytes=JSON.stringify(profile);put(root,profilePath,profileBytes);const A=commit(root);
 const profileRef={repo,path:profilePath,revision:A,digest:'sha256:'+hash(profileBytes)};
 const rawHost=[{kind:'code',...profileRef,purpose:'foundation_host'},...Object.entries(profile.profile.files).map(([path,digest])=>({kind:path===skill?'skill':'code',repo,revision:A,path,digest:'sha256:'+digest,purpose:'foundation_host'}))];
 const rawSkill={kind:'skill',repo,path:skill,revision:'contract'};
 const activityContract={key:'run',implementation_bindings:[...rawHost,rawSkill]};
 const contract={runtime:{kind:'commander-foundation-v1',profile_ref:profileRef},activities:[activityContract]};
 if(options.lock)put(root,'.skills-source.json',JSON.stringify(options.lock(structuredClone(lock))));put(root,'contract.json',JSON.stringify(contract));put(root,'scripts/smoke/pilot.sh','#!/bin/bash\nset -e\nprintf verified > output-regression\n');put(root,host,'export const host = "B must not replace A";\n');const B=commit(root);
 git(root,'remote','add','origin',`https://github.com/${repo}.git`);git(root,'update-ref','refs/remotes/origin/main',B);
 const normalized=(b,index)=>({...b,raw:b,revision:b.revision==='contract'?B:b.revision,scope:'activity',field:'implementation_bindings',index,status:'verified',content_sha256:b.digest?.slice(7)||hash(content),digest:b.digest||'sha256:'+hash(content),validation_scope:'reference_only',...(b.kind==='skill'?{resolved_source:{repo:lock.repository,path:source,revision:central}}:{})});
 const row=(n,payload,identity)=>({id:id(n),...identity,source_repo:repo,source_path:'contract.json',source_commit:B,payload,payload_sha256:pilotPlanHash({source:{repo,path:'contract.json',commit:B},payload})});
 const activity=row(2,{activity_id:id(3),definition_key:'demo.run',contract:activityContract,steps:[{step_id:id(4),locator:{activity_id:id(3),step_key:'verify'}}],implementation_bindings:[...rawHost,rawSkill].map(normalized)},{activity_id:id(3)});
 const workflow=row(1,{workflow_id:id(5),key:'demo',capability_id:id(6),contract,activities:[{slot_key:'run',source_ref:null,sequence_no:1,reference_id:id(7),activity_id:id(3),activity_version_id:id(2)}]},{workflow_id:id(5)});
 const body={schema_version:1,scope:'zenithjoy',repo,revision:B,status:'verified',gaps:[],definitions:{workflows:[workflow],activities:[activity]},assertions:[null,id(4)].map((step,i)=>({id:id(10+i),journey_id:id(6),step_id:id(3),step_id_ref:step,cell_kind:'scenario',cell_key:`regression:${id(6)}:${step||'activity'}`,assertion_ref:'scripts/smoke/pilot.sh',assertion_revision:1}))};
 const seal=body=>{for(const r of [...body.definitions.workflows,...body.definitions.activities])r.payload_sha256=pilotPlanHash({source:{repo:r.source_repo,path:r.source_path,commit:r.source_commit},payload:r.payload});delete body.snapshot_sha256;return {...body,snapshot_sha256:pilotPlanHash(body)};};
 return {root,cache,repo,skill,source,content,host,profilePath,profile,profileRef,lock,A,B,central,git,put,commit,seal,snapshot:seal(body)};
}
// 仅替身SQL边界；真实snapshot构建、发布计划和服务端证据校验函数都照常执行。
export function snapshotDatabase(f){
 const s=f.snapshot,workflows=s.definitions.workflows.map(w=>({id:w.workflow_id,status:'active',source_repo:f.repo,current_definition_version_id:w.id}));
 const manifest={id:id(30),digest:'a'.repeat(64),manifest:{capabilities:[{key:'demo',brain_binding:{entity_type:'capability',entity_id:id(6),source_repo:f.repo,source_revision:f.B}}]}};
 return {async query(sql){let rows;
  if(sql==='SELECT current_database() name')rows=[{name:'cecelia'}];
  else if(sql.includes('FROM map_scope_repositories'))rows=[{scope_key:s.scope,repo:f.repo}];
  else if(sql.includes('FROM workflow_definition_versions'))rows=s.definitions.workflows;
  else if(sql.includes('FROM activity_definition_versions'))rows=s.definitions.activities;
  else if(sql.includes('FROM workflows'))rows=workflows;
  else if(sql.includes('FROM workflow_activity_refs'))rows=s.definitions.workflows.flatMap(w=>w.payload.activities);
  else if(sql.includes('FROM activities'))rows=s.definitions.activities.map(a=>({id:a.activity_id}));
  else if(sql.includes('FROM steps'))rows=s.definitions.activities.flatMap(a=>a.payload.steps);
  else if(sql.includes('FROM map_manifest_versions'))rows=[manifest];
  else if(sql.startsWith('WITH RECURSIVE chain'))rows=[{id:id(6),parent_journey_id:id(8)}];
  else if(sql.includes('FROM areas'))rows=[];
  else if(sql.includes('FROM activity_cells'))rows=s.assertions;
  else throw Error('UNEXPECTED_OFFLINE_QUERY:'+sql);
  return {rows:structuredClone(rows)};
 }};
}
