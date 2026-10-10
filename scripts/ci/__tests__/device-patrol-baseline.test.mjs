import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePatrolBaselineRun,downloadPatrolBaseline} from '../implementation-patrol-baseline.mjs';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {canonical,sha as digest} from '../../../packages/brain/src/lib/device-patrol-admission.js';
const sha='a'.repeat(40);
const run={head_sha:sha,head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/device-patrol-admission.yml',conclusion:'success',repository:{full_name:'perfectuser21/cecelia'},head_repository:{full_name:'perfectuser21/cecelia'}};
test('巡查身份artifact只能由固定已发布工具main可信baseline成功运行提供',()=>{
 assert.equal(validatePatrolBaselineRun(run,sha),run);
 for(const patch of [{head_sha:'b'.repeat(40)},{event:'pull_request'},{head_branch:'feature'},{conclusion:'failure'},{path:'.github/workflows/ci.yml'},{head_repository:{full_name:'attacker/fork'}}])assert.throws(()=>validatePatrolBaselineRun({...run,...patch},sha));
});
test('真实zip下载消费固定身份而不解包代码；摘要篡改拒绝',()=>{
 const root=mkdtempSync(join(tmpdir(),'patrol-trusted-artifact-'));
 try{
  const base='73bd094ae34ecccb1514b09fd4fec8733b846769',intro='f0923e5396bade1986ba5452e766cabb5f4a30b3';
  const contract={schema_version:1,scope:'cecelia-device-patrol',capability_id:'2173a385-a743-41f3-bb7d-d0e4b1d51d4e',workflows:[['66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff','single-phone-account-patrol','d51eefa1-0ffd-43d7-94ba-16ff6b4d3800'],['7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70','phone-account-patrol-batch','b33c9f29-5c5f-4fb1-908c-475bb9566085']].map(([id,key,a])=>({id,key,activities:[{id:a,key:'source',bindings:['scripts/phone-account-patrol/runner.py'],assertion_ref:'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'}]})),auxiliary_paths:[],maintenance_owner:'主理人',schedule:{time:'22:00',timezone:'Asia/Shanghai'}};
  const body={schema_version:1,scope:contract.scope,repo:'perfectuser21/zenithjoy-workspace',revision:base,revision_basis:'requested_ci_input_not_source_attestation',purpose:'scope_identity_bootstrap_only',status:'verified',gaps:[],registration:{provenance:{base_revision:base,introduced_revision:intro,base_tree_sha:'c'.repeat(40),base_paths:[],introduced_paths:['scripts/phone-account-patrol/implementation-contract.json'],compare_status:'ahead',actor:'test'},source:{contract}}};
  const snap={snapshot:{...body,snapshot_sha256:digest(JSON.stringify(canonical(body)))}};
  const fixture=join(root,'head.json'),zip=join(root,'input.zip');writeFileSync(fixture,JSON.stringify(snap));
  execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"head.json"); z.writestr("execute.mjs","malicious"); z.close()',zip,fixture]);
  const bytes=readFileSync(zip),artifact={id:12,expired:false,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),workflow_run:{id:34,head_sha:sha,head_branch:'main'}};
  const execute=(bin,args,opts)=>{
   if(bin!=='gh')return execFileSync(bin,args,opts);const path=args[1];
   if(path.endsWith('/zip'))return bytes;
   const value=path.includes('git/ref/')?{object:{sha}}:path.includes('/compare/')?{status:'identical',merge_base_commit:{sha}}:path.includes('artifacts?')?{artifacts:[artifact]}:run;return JSON.stringify(value);
  };
  const out=join(root,'out');assert.equal(downloadPatrolBaseline(sha,out,{execute}).revision,base);assert.deepEqual(readdirSync(join(out,'base')),['base.json']);assert.equal(readFileSync(join(out,'head/head.json'),'utf8'),JSON.stringify(snap));
  artifact.digest='sha256:'+'0'.repeat(64);assert.throws(()=>downloadPatrolBaseline(sha,out,{execute}),/DIGEST_MISMATCH/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
