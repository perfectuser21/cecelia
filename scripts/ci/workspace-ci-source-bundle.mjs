/** 只读冻结既有F3跨仓CI消费者；不执行来源，不注册或激活任何流程。 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parse } from 'espree';
import { load } from 'js-yaml';

export const F3_IDENTITY=Object.freeze({workflow_id:'c308acc7-89ec-4c18-aff6-fd67fdf31ea3',workflow_key:'factory_f3_ops',capability_id:'ec4eb591-e064-4886-a7b6-4452cdf333d2',activity_id:'0466016e-6d9f-4325-aeb4-d8bc70424a48',reference_id:'74c9f7ed-6bb3-4b22-b426-7dde0e99cad5',slot_key:'step_1',sequence_no:1});
const UNVERIFIED=['69f2f796-c462-478e-bd80-3ab91fb2d25e','c6dfe695-6677-4104-9f03-f6d33d66c4bd','8fcfdf94-5ad5-4ddf-ae74-24b12efe3918'];
const WORKSPACE='perfectuser21/zenithjoy-workspace',BRAIN='perfectuser21/cecelia',SHA=/^[0-9a-f]{40}$/;
const SPECS=[{name:'implementation-impact',reader:'scripts/ci/__tests__/implementation-impact-workflow.test.mjs',callerJob:'impact',calleeJob:'gate',runner:'scripts/ci/implementation-pr-gate.mjs',inputs:['base_revision','head_revision','mode','scope','source_repo','tooling_revision']},{name:'pilot-release-verification',reader:'scripts/ci/__tests__/pilot-release-workflow.test.mjs',callerJob:'verify',calleeJob:'verify',runner:'scripts/ci/pilot-release-verification.mjs',inputs:['head_revision','scope','source_repo','tooling_revision']}];
const RUNNERS=new Set([...SPECS.map(s=>s.runner),'packages/brain/src/migrate.js']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details});};
const literal=n=>n?.type==='Literal'?n.value:undefined;
const member=(n,object,property)=>n?.type==='MemberExpression'&&!n.computed&&n.object?.type==='Identifier'&&n.object.name===object&&n.property?.name===property;
function nodes(ast){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type)out.push(n);for(const [k,v] of Object.entries(n)){if(['tokens','comments'].includes(k))continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(ast);return out;}
function readerProof(source,reader,input){
 let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});}catch{fail('READER_INPUT_UNPROVEN',{path:reader});}
 const all=nodes(ast),fs=new Set(),testNames=new Set(),yaml=new Set();
 for(const n of ast.body.filter(n=>n.type==='ImportDeclaration')){
  if(['node:fs','fs'].includes(n.source.value))for(const s of n.specifiers)if(s.imported?.name==='readFileSync')fs.add(s.local.name);
  if(n.source.value==='node:test')for(const s of n.specifiers)if(s.imported?.name==='test'||s.type==='ImportDefaultSpecifier')testNames.add(s.local.name);
  if(n.source.value==='yaml')for(const s of n.specifiers)if(s.type==='ImportDefaultSpecifier')yaml.add(s.local.name);
 }
 const urls=new Set();
 for(const n of all)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='NewExpression'&&n.init.callee?.name==='URL'){
  const [path,base]=n.init.arguments;
  if(typeof literal(path)==='string'&&base?.type==='MemberExpression'&&base.property?.name==='url'&&base.object?.type==='MetaProperty'&&base.object.meta?.name==='import'&&base.object.property?.name==='meta'&&posix.normalize(posix.join(posix.dirname(reader),literal(path)))===input)urls.add(n.id.name);
 }
 const readCalls=all.filter(n=>n.type==='CallExpression'&&n.callee.type==='Identifier'&&fs.has(n.callee.name)&&n.arguments[0]?.type==='Identifier'&&urls.has(n.arguments[0].name)&&literal(n.arguments[1])==='utf8');
 const parseCalls=all.filter(n=>n.type==='CallExpression'&&[...yaml].some(name=>member(n.callee,name,'parse'))&&readCalls.includes(n.arguments[0]));
 // 实际parser须位于被node:test回调调用的函数中，字符串、未调用helper不构成证据。
 const funcs=all.filter(n=>n.type==='FunctionDeclaration'&&n.id&&n.body.body.some(x=>x.type==='ReturnStatement'&&parseCalls.includes(x.argument)));
 const tests=ast.body.filter(n=>n.type==='ExpressionStatement').map(n=>n.expression).filter(n=>n.type==='CallExpression'&&n.callee.type==='Identifier'&&testNames.has(n.callee.name));
 if(!parseCalls.length||!funcs.some(fn=>tests.some(t=>t.arguments.slice(1).some(cb=>cb.body?.type==='BlockStatement'&&cb.body.body.filter(s=>['VariableDeclaration','ExpressionStatement','ReturnStatement'].includes(s.type)).some(s=>nodes(s).some(n=>n.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name===fn.id.name))))))fail('READER_INPUT_UNPROVEN',{path:reader});
 return {selector:'literal_url_readfile_yaml_parse'};
}
function callerProof(yaml,spec,brainRevision){
 const jobs=yaml?.jobs,job=jobs?.[spec.callerJob],contract=jobs?.['caller-contract'];
 if(job?.uses!==`${BRAIN}/.github/workflows/${spec.name}.yml@${brainRevision}`||job?.with?.tooling_revision!==brainRevision)fail('CALLER_PIN_MISMATCH',{path:spec.name});
 const needs=Array.isArray(job.needs)?job.needs:[job.needs];
 if(!contract||!needs.includes('caller-contract')||!(contract.steps||[]).some(s=>s.run===`node --test ${spec.reader}`&&!s.if&&!s['continue-on-error']))fail('CALLER_REQUIRED_JOB_MISSING',{path:spec.name});
 if(job['continue-on-error']||contract['continue-on-error']||contract.if||job.if&&job.if!=="github.ref == 'refs/heads/main'"||yaml.on?.pull_request_target||yaml.on?.pull_request?.paths||yaml.on?.push?.paths)fail('CALLER_FAILURE_BYPASS',{path:spec.name});
 if(job.with.source_repo!==WORKSPACE||job.with.scope!=='zenithjoy'||Object.keys(job.with).sort().join(',')!==spec.inputs.join(','))fail('CALLER_SOURCE_CONTRACT_MISMATCH',{path:spec.name});
 return {selector:`jobs.${spec.callerJob}.needs/caller-contract.node_test`};
}
function calleeProof(yaml,spec){
 const inputs=yaml?.on?.workflow_call?.inputs;
 if(!inputs||Object.keys(inputs).sort().join(',')!==spec.inputs.join(',')||spec.inputs.some(k=>inputs[k].required!==true||inputs[k].type!=='string'))fail('CALLEE_INTERFACE_MISMATCH',{path:spec.name});
 const job=yaml.jobs?.[spec.calleeJob];
 if(!job||job['continue-on-error'])fail('CALLEE_REQUIRED_JOB_MISSING',{path:spec.name});
 const checkout=(job.steps||[]).find(s=>s.uses?.startsWith('actions/checkout@')&&s.with?.repository===BRAIN&&s.with?.path==='tooling');
 if(!checkout||!/^\$\{\{ inputs\.tooling_revision(?: \|\| github\.[a-z_.]+)* \}\}$/.test(checkout.with.ref))fail('CALLEE_TOOLING_SOURCE_UNPROVEN',{path:spec.name});
 const runners=[];
 for(const step of job.steps||[])for(const m of String(step.run||'').matchAll(/\bnode\s+tooling\/([-A-Za-z0-9_./]+\.(?:mjs|js))\b/g)){
  if(step.if||step['continue-on-error'])fail('CALLEE_REQUIRED_JOB_MISSING',{path:spec.name});
  if(!RUNNERS.has(m[1]))fail('CALLEE_SOURCE_OUTSIDE_CONTRACT',{path:m[1]});
  runners.push({path:m[1],selector:`jobs.${spec.calleeJob}.steps.node_tooling`});
 }
 if(!runners.some(r=>r.path===spec.runner))fail('CALLEE_RUNNER_MISSING',{path:spec.name});
 return runners;
}

export async function extractWorkspaceCiSourceBundle({workspace,brain,readSource,identity}={}){
 const gaps=[],bindings=[],relations=[],source_set=[workspace,brain].map(x=>x&&({...x}));
 const result=()=>({schema_version:1,source_basis:'fixed_revision_bytes',source_scope:'cecelia-factory',definition_scope:'consumer_evidence',source_set,executable:false,status:gaps.length?'unknown':'verified',gaps,consumer:{...F3_IDENTITY,definition_scope:'consumer_evidence',status:gaps.length?'unknown':'verified',gaps:[...gaps],bindings,input_relations:relations},workflow_coverage:{status:'unknown',verified_reference_ids:gaps.length?[]:[F3_IDENTITY.reference_id],unverified_reference_ids:gaps.length?[F3_IDENTITY.reference_id,...UNVERIFIED]:[...UNVERIFIED]}});
 try{
  if(!identity||Object.keys(F3_IDENTITY).some(k=>identity[k]!==F3_IDENTITY[k])||Object.keys(identity).some(k=>!(k in F3_IDENTITY)))fail('F3_IDENTITY_MISMATCH');
  if(workspace?.repo!==WORKSPACE||brain?.repo!==BRAIN||!SHA.test(workspace?.revision||'')||!SHA.test(brain?.revision||'')||Object.keys(workspace).sort().join(',')!=='repo,revision'||Object.keys(brain).sort().join(',')!=='repo,revision'||typeof readSource!=='function')fail('SOURCE_IDENTITY_INVALID');
  const sources=new Map();
  async function read(side,path){
   const key=`${side.repo}@${side.revision}:${path}`;if(sources.has(key))return sources.get(key);
   let bytes;try{bytes=await readSource({...side,path});}catch{fail('SOURCE_READ_FAILED',{repo:side.repo,revision:side.revision,path});}
   if(typeof bytes==='string')bytes=Buffer.from(bytes);
   if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>1024*1024)fail('SOURCE_BYTES_INVALID',{repo:side.repo,path});
   const source={...side,path,content_sha256:sha(bytes)};sources.set(key,source);
   bindings.push({kind:'code',...source,digest:`sha256:${source.content_sha256}`,scope:'activity',validation_scope:'consumer_source',status:'verified'});
   return source;
  }
  async function yaml(side,path){const source=await read(side,path);let text;try{text=await readSource({...side,path});}catch{fail('SOURCE_READ_FAILED',{repo:side.repo,path});}const bytes=Buffer.isBuffer(text)?text:Buffer.from(text);if(sha(bytes)!==source.content_sha256)fail('SOURCE_CHANGED_DURING_READ',{repo:side.repo,path});try{return {source,value:load(bytes.toString('utf8'))};}catch{fail('SOURCE_YAML_INVALID',{repo:side.repo,path});}}
  for(const spec of SPECS){
   const path=`.github/workflows/${spec.name}.yml`,caller=await yaml(workspace,path);
   const callerEvidence=callerProof(caller.value,spec,brain.revision);
   const reader=await read(workspace,spec.reader),readerBytes=await readSource({...workspace,path:spec.reader});
   if(sha(readerBytes)!==reader.content_sha256)fail('SOURCE_CHANGED_DURING_READ',{repo:workspace.repo,path:spec.reader});
   const readerEvidence=readerProof(readerBytes.toString(),spec.reader,path);
   relations.push({consumer:caller.source,input:reader,kind:'required_node_test',...callerEvidence},{consumer:reader,input:caller.source,kind:'yaml_readfile_input',...readerEvidence});
   const callee=await yaml(brain,path),runners=calleeProof(callee.value,spec);
   relations.push({consumer:caller.source,input:callee.source,kind:'fixed_reusable_workflow',selector:`jobs.${spec.callerJob}.uses+tooling_revision`});
   for(const runner of runners){const code=await read(brain,runner.path);relations.push({consumer:callee.source,input:code,kind:'fixed_job_node_source',selector:runner.selector});}
  }
 }catch(e){gaps.push({code:e.code||'SOURCE_PROTOCOL_INVALID',...(e.details||{})});}
 return result();
}
