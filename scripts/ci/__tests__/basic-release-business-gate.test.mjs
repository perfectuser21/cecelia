import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const sha='a'.repeat(40),version='1.445.288';
function verify(mode){
 const dir=mkdtempSync(join(tmpdir(),'release-business-gate-'));
 try{
  mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,'bin/docker'),`#!${process.execPath}
const fs=require('fs'),args=process.argv.slice(2),mode=process.env.SCENARIO;
fs.appendFileSync(process.env.CALLS,JSON.stringify(args)+'\\n');
if(args.some(x=>x.includes('staging-business.mjs'))){
 if(mode==='business-failed')process.exit(37);
 const receipt={protocol:'brain-staging-business/v1',status:'passed',git_sha:process.env.EXPECTED_SHA,task_id:'11111111-1111-4111-8111-111111111111',run_id:'22222222-2222-4222-8222-222222222222',task_status:'completed_no_pr',run_status:'success',artifact_verified:true,execution_stopped:true,external_services:'not_evaluated'};
 if(mode==='business-wrong-sha')receipt.git_sha='b'.repeat(40);
 if(mode==='business-missing-artifact')receipt.artifact_verified=false;
 if(mode==='business-not-stopped')receipt.execution_stopped=false;
 console.log('STAGING_BUSINESS_RECEIPT '+JSON.stringify(receipt));process.exit(0);
}
if(args.some(x=>x.endsWith('/health'))){console.log(JSON.stringify({status:'healthy',git_sha:process.env.EXPECTED_SHA,version:'${version}',runtime:{isolated:true,background_automation:false}}));process.exit(0);}
if(args.some(x=>x.endsWith('/tick/status'))){console.log('{"enabled":false}');process.exit(0);}
if(args.some(x=>x.includes('/tasks?limit=1'))){console.log('[]');process.exit(0);}
if(args.some(x=>x.includes('current_database'))){console.log('{"database":"cecelia_staging","host":"stage-db","tasks_table":true}');process.exit(0);}
process.exit(91);
`,{mode:0o700});
  const output=join(dir,'verification.json');
  const r=spawnSync('bash',['scripts/staging-verify.sh'],{cwd:root,encoding:'utf8',timeout:10000,env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,BRAIN_CANDIDATE_DOCKER_HOST:'',BRAIN_CANDIDATE_DOCKER_CONTEXT:'',EXPECTED_SHA:sha,EXPECTED_VERSION:version,STAGING_CONTAINER:'cecelia-admission-brain',STAGING_VERIFY_OUTPUT:output,CALLS:join(dir,'calls'),SCENARIO:mode}});
  return {...r,calls:readFileSync(join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse),receipt:r.status===0?JSON.parse(readFileSync(output,'utf8')):null};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('候选必须执行固定业务合同并在准入收据保留真实任务、运行、产物和停止证据',()=>{
 const r=verify('success');assert.equal(r.status,0,r.stderr+r.stdout);
 assert.ok(r.calls.some(args=>args.some(x=>x.includes('staging-business.mjs'))),'候选只通过健康/读取，没有执行固定业务合同');
 assert.equal(r.receipt.business?.status,'passed');
 assert.equal(r.receipt.business?.git_sha,sha);
 assert.equal(r.receipt.business?.artifact_verified,true);
 assert.equal(r.receipt.business?.execution_stopped,true);
 assert.equal(r.receipt.business?.external_services,'not_evaluated');
});
test('候选业务合同非零时真实验收脚本拒绝准入，不能只凭健康和数据库读取通过',()=>{
 const r=verify('business-failed');assert.notEqual(r.status,0,'固定业务合同失败仍通过候选准入');
 assert.ok(r.calls.some(args=>args.some(x=>x.includes('staging-business.mjs'))),'没有真正调用固定业务合同');
});

for(const mode of ['business-wrong-sha','business-missing-artifact','business-not-stopped'])test(`候选业务收据${mode}不能授权生产发布`,()=>{
 const r=verify(mode);assert.notEqual(r.status,0,mode+'仍通过候选准入');
});
