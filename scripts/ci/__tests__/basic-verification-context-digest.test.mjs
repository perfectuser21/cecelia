import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const historicalRevision='f67184328cf877d438869606eb828d1d25d92d20';
const modulePath='scripts/ci/implementation-verification-context.mjs';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>JSON.stringify(canonical(value));
const sha=value=>crypto.createHash('sha256').update(bytes(value)).digest('hex');
const seal=(body,key)=>({...body,[key]:sha(body)});

function fixture(){
 const paths=['tests/first.test.js','tests/second.test.js'],retired='tests/retired.test.js';
 const source={repo:'perfectuser21/cecelia',base_revision:'a'.repeat(40),head_revision:'b'.repeat(40),changed_files:[...paths,retired].map(path=>({path}))};
 const owners=['vitest.config.js','packages/brain/vitest.config.js'],consumer='.github/workflows/ci.yml',graph=sha([]);
 const reports=['cecelia-kr','cecelia-factory','cecelia-infra'].map((scope,index)=>{
  const report={scope_key:scope,registry_repo:scope+'-source',source:structuredClone(source),ci_context:{purpose:'admission_only'},affected_usages:[],verification_owner_coverage:{}};
  for(const side of ['base','head']){
   const revision=source[side+'_revision'];
   report[side]={revision,mapping_status:'verified',traversal:{truncated:false},graph_snapshot:{source_revision:revision,digest:graph,row_count:0},file_coverage:source.changed_files.map(({path})=>({path,matched_paths:[],truncated:false}))};
   report.verification_owner_coverage[side]=owners.map(path=>({path,matched_paths:index===2?[]:[consumer],source_revision:revision,graph_sha256:graph,truncated:false}));
   if(index!==2)report.affected_usages.push({evidence:[{side,revision,implementation:{repo:source.repo,registry_repo:report.registry_repo,revision,path:consumer}}]});
  }
  return report;
 });
 const evidence=seal({schema_version:1,purpose:'admission_only',evidence_kind:'derived_verification_input_candidates',source,rows:paths.map(path=>({
  input_facts:{role:'verification_input',path,source:{side:'head',revision:source.head_revision},entry_verified:false,owner_verified:false},
  eligible_owner_paths:owners,execution_status:'not_evaluated',coverage:'unknown',input_witness_sha256:'c'.repeat(64),
 }))},'verification_inputs_sha256');
 const replacements=paths.map(path=>({path,sha256:'d'.repeat(64),git_blob_sha1:'e'.repeat(40),config:{sha256:'f'.repeat(64)}}));
 const retirements=seal({purpose:'admission_only',kind:'explicit_verification_retirement',source,rows:[{
  path:retired,change:'D',side:'base',base:{revision:source.base_revision},head:{revision:source.head_revision,absent:true},
  replacement_inputs:replacements,requires_native_base_no_business_consumer:true,entry_verified:false,owner_verified:false,retirement_authorized:false,
  catalog:{path:'config/verification-retirements/test.json',sha256:'1'.repeat(64)},catalog_limitations:['declaration only'],
 }]},'retirement_candidates_sha256');
 const entries=seal({purpose:'admission_only',source,retirement_candidates_sha256:retirements.retirement_candidates_sha256,rows:[{
  path:retired,replacement_entries:replacements.map(input=>({path:input.path,entry:{input:{...input,source:{side:'head',revision:source.head_revision}},witness:{kind:'vitest_config_input',config:input.config},eligible_owner_paths:owners,entry_support_sha256:'2'.repeat(64)}})),
 }]},'retirement_entry_candidates_sha256');
 const graphs={scopes:reports.map(report=>({scope_key:report.scope_key,registry_repo:report.registry_repo,...Object.fromEntries(['base','head'].map(side=>[side,seal({
  schema_version:1,purpose:'admission_only',repo:source.repo,registry_repo:report.registry_repo,side,source_revision:source[side+'_revision'],graph_snapshot_row_count:0,graph_snapshot_digest:graph,
  rows:[{path:retired,reverse_paths:[retired],truncated:false}],
 },'raw_graph_facts_sha256')]))}))};
 return {source,evidence,reports,raw_consumer_graph_facts:graphs,retirement_candidates:retirements,retirement_entry_evidence:entries};
}

async function observe(){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 Object.assign(env,{GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'});
 const original=execFileSync('git',['--no-replace-objects','show',historicalRevision+':'+modulePath],{cwd:root,env,encoding:'utf8'});
 // Published main object is fixed; only dependency specifiers become absolute for the data module.
 assert.equal(crypto.createHash('sha256').update(original).digest('hex'),'c916259bd1a917b57e99f80f949fd6f475d9a6dacc0a491af2ac4d154adcc038');
 let rewritten=original,replaced=0;
 for(const specifier of ['../../packages/brain/src/lib/implementation-impact.js','./implementation-verification-inputs.mjs']){
  const target=pathToFileURL(resolve(root,'scripts/ci',specifier)).href;
  assert.equal(rewritten.split("from '"+specifier+"'").length,2);
  rewritten=rewritten.replace("from '"+specifier+"'","from '"+target+"'");replaced++;
 }
 assert.equal(replaced,2);
 const watched=new Map(),counts=new Map(),createHash=crypto.createHash;
 crypto.createHash=function(...args){
  const hash=createHash.apply(this,args),update=hash.update;
  hash.update=function(data,...rest){
   const key=watched.get(typeof data==='string'?data:Buffer.isBuffer(data)?data.toString():null);
   if(key)counts.set(key,(counts.get(key)||0)+1);
   return update.call(this,data,...rest);
  };
  return hash;
 };
 syncBuiltinESMExports();
 try{
  const old=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
  const current=await import(pathToFileURL(resolve(root,modulePath)).href);
  const options=fixture();
  const measure=build=>{
   watched.clear();counts.clear();for(const report of options.reports)watched.set(bytes(report),report.scope_key);
   const untouched=JSON.stringify(options),context=build(options);assert.equal(JSON.stringify(options),untouched);
   return {context,counts:Object.fromEntries(options.reports.map(report=>[report.scope_key,counts.get(report.scope_key)||0]))};
  };
  const historical=measure(old.buildVerificationInputContext),first=measure(current.buildVerificationInputContext);
  assert.deepEqual(first.context,historical.context);
  assert.equal(first.context.context_sha256,historical.context.context_sha256);
  assert.equal(first.context.authorized_inputs.length,2);assert.equal(first.context.authorized_retirements.length,1);
  assert.equal(first.context.authorized_retirements[0].replacements.length,2);
  assert.deepEqual(historical.counts,{'cecelia-kr':8,'cecelia-factory':8,'cecelia-infra':0});
  options.reports[0].changed_between_calls='actual new report bytes';
  const second=measure(current.buildVerificationInputContext),historicalSecond=measure(old.buildVerificationInputContext);
  assert.deepEqual(second.context,historicalSecond.context);
  assert.notEqual(second.context.context_sha256,first.context.context_sha256);
  assert.notEqual(second.context.authorized_inputs[0].owner_claims[0].source_report_sha256,first.context.authorized_inputs[0].owner_claims[0].source_report_sha256);
  for(const api of [old,current]){
   assert.throws(()=>api.assertVerificationInputContext({source:options.source,reports:options.reports,context:first.context}),{code:'VERIFICATION_CONTEXT_MISMATCH'});
   const forged=structuredClone(second.context);forged.authorized_inputs[0].owner_claims[0].source_report_sha256='0'.repeat(64);
   const {context_sha256,...body}=forged;forged.context_sha256=sha(body);
   assert.throws(()=>api.assertVerificationInputContext({source:options.source,reports:options.reports,context:forged}),{code:'VERIFICATION_CONTEXT_MISMATCH'});
   const invalid=structuredClone(options);invalid.reports[0].affected_usages[0].evidence[0].revision='9'.repeat(40);
   assert.throws(()=>api.buildVerificationInputContext(invalid),{code:'VERIFICATION_CONTEXT_NATIVE_USAGE_SOURCE_INVALID'});
   const inputTamper=structuredClone(options);inputTamper.evidence.verification_inputs_sha256='0'.repeat(64);
   assert.throws(()=>api.buildVerificationInputContext(inputTamper),{code:'VERIFICATION_CONTEXT_INPUT_INVALID'});
  }
  process.stdout.write(JSON.stringify({historical:historical.counts,first:first.counts,second:second.counts,old_current_deep_equal:true,cross_call_changed_and_fresh:true,tamper_rejected:true}));
 }finally{crypto.createHash=createHash;syncBuiltinESMExports();}
}

if(process.argv[2]==='--observe-context-hashes')await observe();
else test('单次context对多owner及退休共用report仅精确SHA一次，跨调用重读且与已发布D逐字段一致',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--observe-context-hashes'],{cwd:root,env,encoding:'utf8',timeout:15000,killSignal:'SIGKILL',maxBuffer:1024*1024});
 assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
 const observed=JSON.parse(result.stdout);
 assert.equal(observed.old_current_deep_equal,true);assert.equal(observed.cross_call_changed_and_fresh,true);assert.equal(observed.tamper_rejected,true);
 assert.deepEqual(observed.first,{'cecelia-kr':1,'cecelia-factory':1,'cecelia-infra':0});
 assert.deepEqual(observed.second,observed.first);
});
