import {it,expect} from 'vitest';
import {assertAuthoringReleaseProof,prepareAuthoringReleaseProof} from './release-proof.js';
import {definitionDigest} from './contracts.js';

it.each([true,{}, {snapshot_sha256:'a'.repeat(64)}, {verified:true,implementation_source_set:[]}])('序列化声明不能冒充真实固定Git来源证明：%j',proof=>{
 const snapshot={snapshot_sha256:'a'.repeat(64)};
 expect(()=>assertAuthoringReleaseProof(snapshot,proof)).toThrow('authoring发布来源证明不匹配');
});
it('自洽摘要也不能让未正式登记的普通快照取得跨版本豁免',async()=>{
 const body={status:'verified',gaps:[],scope:'unregistered',repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40),definitions:{workflows:[],activities:[]},map:{repositories:[]}};
 const snapshot={...body,snapshot_sha256:definitionDigest(body)};
 await expect(prepareAuthoringReleaseProof(snapshot)).rejects.toThrow('authoring发布来源证明不匹配');
});

import {createHash} from 'node:crypto';
import {validateFixedImplementationBindings} from './fixed-git-source.js';

async function centralFixture(){
 const repo='perfectuser21/zenithjoy-workspace',revision='a'.repeat(40),central='perfectuser21/zenithjoy-skills',centralRevision='b'.repeat(40);
 const path='.claude/skills/demo/SKILL.md',sourcePath='business-skills/zenithjoy/demo/SKILL.md';
 const content='---\nname: demo\nversion: 1\n---\ncentral fixed content\n';
 const definition={key:'report.internal',name:'报告',capability_id:'11111111-1111-4111-8111-111111111111',channel:'internal',form:'openclaw_skill',version:'1.0.0',
  source:{repo,ref:'contracts/report.json',revision},runtime:{skill_id:'22222222-2222-4222-8222-222222222222',entrypoint:'workflow-commander'},
  input_schema:{type:'object'},resources:{},recovery:{max_attempts:1},activities:[{key:'read',name:'读回',executor_kind:'skill',acceptance:['产物可读'],implementation:{kind:'skill',repo,path,revision:'contract'}}]};
 const {source:_source,...document}=definition;
 const files=new Map([
  [`${repo}:${definition.source.ref}`,JSON.stringify(document)],
  [`${repo}:.skills-source.json`,JSON.stringify({version:1,repository:central,revision:centralRevision,profile:'zenithjoy',loader_sha256:'c'.repeat(64)})],
  [`${central}:distribution/catalog.json`,JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path,source:sourcePath,sha256:createHash('sha256').update(content).digest('hex')}]}}})],
  [`${central}:${sourcePath}`,content],
 ]);
 const readFile=source=>files.get(`${source.repo}:${source.path}`);
 const bindings=await validateFixedImplementationBindings(definition.activities[0],{repo,commit:revision},{readFile});
 const activityId='33333333-3333-4333-8333-333333333333',versionId='44444444-4444-4444-8444-444444444444',workflowId='55555555-5555-4555-8555-555555555555';
 const scope='commander-generic',protocol='definition-freeze-v1';
 const body={scope,repo,revision,status:'verified',gaps:[],
  canonical:{workflows:[{id:workflowId,key:definition.key,status:'active',capability_id:definition.capability_id,source_repo:repo,source_path:definition.source.ref}]},
  map:{repositories:[{scope_key:scope,adapter_config:{source_repo:repo,definition_protocol:protocol,workflow_keys:[definition.key]}}]},
  definitions:{workflows:[{workflow_id:workflowId,source_repo:repo,source_path:definition.source.ref,source_commit:revision,payload:{key:definition.key,registration_protocol:protocol,contract:definition,
   activities:[{slot_key:'read',activity_id:activityId,activity_version_id:versionId,sequence_no:1}]}}],
   activities:[{id:versionId,activity_id:activityId,payload:{registration_protocol:protocol,steps:[],implementation_bindings:bindings}}]}};
 return {snapshot:{...body,snapshot_sha256:definitionDigest(body)},readFile,files,declared:{repo,path,revision},resolved:{repo:central,path:sourcePath,revision:centralRevision}};
}

it('真实来源核验后的发布证明同时保留业务声明与中央固定身份，证明被改即拒绝',async()=>{
 const fixture=await centralFixture();
 const proof=await prepareAuthoringReleaseProof(fixture.snapshot,{readFile:fixture.readFile});
 const [entry]=assertAuthoringReleaseProof(fixture.snapshot,proof);
 expect(entry).toMatchObject(fixture.declared);expect(entry.resolved_source).toEqual(fixture.resolved);
 proof.implementation_source_set[0].resolved_source.path='other/SKILL.md';
 expect(()=>assertAuthoringReleaseProof(fixture.snapshot,proof)).toThrow();
});

it.each(['repo','path','revision'])('自洽重算快照也不能伪造中央来源：%s',async field=>{
 const fixture=await centralFixture();
 fixture.snapshot.definitions.activities[0].payload.implementation_bindings[0].resolved_source[field]=field==='revision'?'d'.repeat(40):'forged';
 const {snapshot_sha256:_sha,...body}=fixture.snapshot;fixture.snapshot.snapshot_sha256=definitionDigest(body);
 await expect(prepareAuthoringReleaseProof(fixture.snapshot,{readFile:fixture.readFile})).rejects.toThrow();
});

it('中央实际字节被改不能沿用正确摘要和快照取得发布证明',async()=>{
 const fixture=await centralFixture();
 fixture.files.set(`${fixture.resolved.repo}:${fixture.resolved.path}`,'---\nname: demo\nversion: 1\n---\nchanged\n');
 await expect(prepareAuthoringReleaseProof(fixture.snapshot,{readFile:fixture.readFile})).rejects.toThrow(/摘要/);
});
