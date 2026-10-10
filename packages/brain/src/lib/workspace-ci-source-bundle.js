/** 只读冻结既有F3跨仓CI消费者；不执行来源，不注册或激活任何流程。 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parse } from 'acorn';
import { load } from 'js-yaml';

export const F3_IDENTITY=Object.freeze({workflow_id:'c308acc7-89ec-4c18-aff6-fd67fdf31ea3',workflow_key:'factory_f3_ops',capability_id:'ec4eb591-e064-4886-a7b6-4452cdf333d2',activity_id:'0466016e-6d9f-4325-aeb4-d8bc70424a48',reference_id:'74c9f7ed-6bb3-4b22-b426-7dde0e99cad5',slot_key:'step_1',sequence_no:1});
const UNVERIFIED=['69f2f796-c462-478e-bd80-3ab91fb2d25e','c6dfe695-6677-4104-9f03-f6d33d66c4bd','8fcfdf94-5ad5-4ddf-ae74-24b12efe3918'];
const WORKSPACE='perfectuser21/zenithjoy-workspace',BRAIN='perfectuser21/cecelia',SHA=/^[0-9a-f]{40}$/;
const SPECS=[{name:'implementation-impact',reader:'scripts/ci/__tests__/implementation-impact-workflow.test.mjs',callerJob:'impact',calleeJob:'gate',runner:'scripts/ci/implementation-pr-gate.mjs',inputs:['base_revision','head_revision','mode','scope','source_repo','tooling_revision']},{name:'pilot-release-verification',reader:'scripts/ci/__tests__/pilot-release-workflow.test.mjs',callerJob:'verify',calleeJob:'verify',runner:'scripts/ci/pilot-release-verification.mjs',inputs:['head_revision','scope','source_repo','tooling_revision']}];
const RUNNERS=new Set([...SPECS.map(s=>s.runner),'packages/brain/src/migrate.js']);
const ADMISSION_SCOPE_ENV = new Set([
 "${{ inputs.admission_scopes || vars.IMPLEMENTATION_ADMISSION_SCOPES || '' }}",
 "${{ inputs.admission_scopes || vars.IMPLEMENTATION_ADMISSION_SCOPES || (github.event_name == 'pull_request' && github.repository == 'perfectuser21/cecelia' && '{\"schema_version\":1,\"scopes\":[\"cecelia-kr\",\"cecelia-factory\"]}' || '') }}",
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details});};
const literal=n=>n?.type==='Literal'?n.value:undefined;
const member=(n,object,property)=>n?.type==='MemberExpression'&&!n.computed&&n.object?.type==='Identifier'&&n.object.name===object&&n.property?.name===property;
function nodes(ast){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type)out.push(n);for(const [k,v] of Object.entries(n)){if(['tokens','comments'].includes(k))continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(ast);return out;}
function executedNodes(root){
 const out=[];function walk(n){if(!n||typeof n!=='object')return;if(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration','ConditionalExpression','LogicalExpression'].includes(n.type))return;if(n.type)out.push(n);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(root);return out;
}
function readerProof(source,reader,input){
 let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});}catch{fail('READER_INPUT_UNPROVEN',{path:reader});}
 const all=nodes(ast),fs=new Set(),exists=new Set(),asserts=new Set(),testNames=new Set(),yaml=new Set();
 for(const n of ast.body.filter(n=>n.type==='ImportDeclaration')){
  if(['node:fs','fs'].includes(n.source.value))for(const s of n.specifiers){if(s.imported?.name==='readFileSync')fs.add(s.local.name);if(s.imported?.name==='existsSync')exists.add(s.local.name);}
  if(n.source.value==='node:assert/strict')for(const s of n.specifiers)if(s.type==='ImportDefaultSpecifier')asserts.add(s.local.name);
  if(n.source.value==='node:test')for(const s of n.specifiers)if(s.imported?.name==='test'||s.type==='ImportDefaultSpecifier')testNames.add(s.local.name);
  if(n.source.value==='yaml')for(const s of n.specifiers)if(s.type==='ImportDefaultSpecifier')yaml.add(s.local.name);
 }
 const urls=new Set(),urlDeclarations=new Set();
 const importNames=new Set([...fs,...exists,...asserts,...testNames,...yaml,'URL']);
 for(const n of all)if((n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&importNames.has(n.id.name))||((n.type==='FunctionDeclaration'||n.type==='FunctionExpression'||n.type==='ArrowFunctionExpression')&&(n.params||[]).some(p=>nodes(p).some(v=>v.type==='Identifier'&&importNames.has(v.name)))))fail('READER_INPUT_UNPROVEN',{path:reader});
 for(const n of all)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='NewExpression'&&n.init.callee?.name==='URL'){
  const [path,base]=n.init.arguments;
  if(typeof literal(path)==='string'&&base?.type==='MemberExpression'&&base.property?.name==='url'&&base.object?.type==='MetaProperty'&&base.object.meta?.name==='import'&&base.object.property?.name==='meta'&&posix.normalize(posix.join(posix.dirname(reader),literal(path)))===input){urls.add(n.id.name);urlDeclarations.add(n);}
 }
 const readCalls=all.filter(n=>n.type==='CallExpression'&&n.callee.type==='Identifier'&&fs.has(n.callee.name)&&n.arguments[0]?.type==='Identifier'&&urls.has(n.arguments[0].name)&&literal(n.arguments[1])==='utf8');
 const parseCalls=all.filter(n=>n.type==='CallExpression'&&[...yaml].some(name=>member(n.callee,name,'parse'))&&readCalls.includes(n.arguments[0]));
 // 实际parser须位于被node:test回调调用的函数中，字符串、未调用helper不构成证据。
 const funcs=ast.body.filter(n=>n.type==='FunctionDeclaration'&&n.id&&n.body.body.some(x=>x.type==='ReturnStatement'&&parseCalls.includes(x.argument)));
 const protectedNames=new Set([...importNames,...urls,...funcs.map(f=>f.id.name)]);
 for(const n of all){
  if(n.type==='AssignmentExpression'&&nodes(n.left).some(x=>x.type==='Identifier'&&protectedNames.has(x.name)))fail('READER_INPUT_UNPROVEN',{path:reader});
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&protectedNames.has(n.id.name)&&!urlDeclarations.has(n))fail('READER_INPUT_UNPROVEN',{path:reader});
  if(n.type==='FunctionDeclaration'&&funcs.some(f=>f.id.name===n.id?.name)&&!funcs.includes(n))fail('READER_INPUT_UNPROVEN',{path:reader});
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)&&(n.params||[]).some(p=>nodes(p).some(v=>v.type==='Identifier'&&protectedNames.has(v.name))))fail('READER_INPUT_UNPROVEN',{path:reader});
 }
 const existenceCall=n=>n?.type==='CallExpression'&&n.callee?.type==='Identifier'&&exists.has(n.callee.name)&&n.arguments[0]?.type==='Identifier'&&urls.has(n.arguments[0].name);
 const precondition=n=>n.type==='IfStatement'&&!n.alternate&&n.test?.type==='UnaryExpression'&&n.test.operator==='!'&&existenceCall(n.test.argument)&&n.consequent?.type==='ThrowStatement'||n.type==='ExpressionStatement'&&n.expression?.type==='CallExpression'&&[...asserts].some(a=>member(n.expression.callee,a,'ok'))&&existenceCall(n.expression.arguments[0]);
 for(const fn of funcs)if(fn.body.body.at(-1)?.type!=='ReturnStatement'||!parseCalls.includes(fn.body.body.at(-1).argument)||fn.body.body.slice(0,-1).some(n=>!precondition(n)))fail('READER_INPUT_UNPROVEN',{path:reader});
 const tests=ast.body.filter(n=>n.type==='ExpressionStatement').map(n=>n.expression).filter(n=>n.type==='CallExpression'&&n.callee.type==='Identifier'&&testNames.has(n.callee.name));
 const callsInTest=(t,name)=>{
  // 有options的test可能skip/todo；当前消费者只接受实际两参数形式。
  if(t.arguments.length!==2||t.arguments[1]?.body?.type!=='BlockStatement')return false;
  for(const statement of t.arguments[1].body.body){
   if(!['VariableDeclaration','ExpressionStatement','ReturnStatement','ThrowStatement'].includes(statement.type))return false;
   if(executedNodes(statement).some(n=>n.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name===name))return true;
   if(['ReturnStatement','ThrowStatement'].includes(statement.type))return false;
  }
  return false;
 };
 if(!parseCalls.length||!funcs.some(fn=>tests.some(t=>callsInTest(t,fn.id.name))))fail('READER_INPUT_UNPROVEN',{path:reader});
 return {selector:'literal_url_readfile_yaml_parse'};
}
function callerProof(yaml,spec,brainRevisions){
 const jobs=yaml?.jobs,job=jobs?.[spec.callerJob],contract=jobs?.['caller-contract'];
 const brainRevision=job?.with?.tooling_revision;
 if(!brainRevisions.includes(brainRevision)||job?.uses!==`${BRAIN}/.github/workflows/${spec.name}.yml@${brainRevision}`)fail('CALLER_PIN_MISMATCH',{path:spec.name});
 const needs=Array.isArray(job.needs)?job.needs:[job.needs];
 if(!contract||!needs.includes('caller-contract')||!(contract.steps||[]).some(s=>s.run===`node --test ${spec.reader}`&&s.if===undefined&&!s['continue-on-error']))fail('CALLER_REQUIRED_JOB_MISSING',{path:spec.name});
 if(job['continue-on-error']||contract['continue-on-error']||contract.if!==undefined||job.if!==undefined&&job.if!=="github.ref == 'refs/heads/main'"||yaml.on?.pull_request_target||yaml.on?.pull_request?.paths||yaml.on?.push?.paths)fail('CALLER_FAILURE_BYPASS',{path:spec.name});
 const admissionScopesRequested=Object.hasOwn(job.with,'admission_scopes');
 const callerInputs=admissionScopesRequested?['admission_scopes',...spec.inputs].sort():spec.inputs;
 if(admissionScopesRequested){
  let value;try{value=JSON.parse(job.with.admission_scopes);}catch{fail('CALLER_SOURCE_CONTRACT_MISMATCH',{path:spec.name});}
  if(spec.name!=='implementation-impact'||!value||Object.keys(value).sort().join(',')!=='schema_version,scopes'||value.schema_version!==1||!Array.isArray(value.scopes)||value.scopes.length!==2||[...value.scopes].sort().join(',')!=='cecelia-factory,zenithjoy')fail('CALLER_SOURCE_CONTRACT_MISMATCH',{path:spec.name});
 }
 if(job.with.source_repo!==WORKSPACE||job.with.scope!=='zenithjoy'||Object.keys(job.with).sort().join(',')!==callerInputs.join(','))fail('CALLER_SOURCE_CONTRACT_MISMATCH',{path:spec.name});
 return {brainRevision,admissionScopesRequested,selector:`jobs.${spec.callerJob}.needs/caller-contract.node_test`};
}
// 只承认未处于引号/注释/HereDoc中的行首直接node命令；复杂shell保UNKNOWN。
function directNodeCommands(source){
 if(source.includes('<<')||/^\s*(?:if\b|elif\b|else\b|fi\b|for\b|while\b|until\b|case\b|function\b|exit\b|return\b|[A-Za-z_]\w*\s*\(\s*\)\s*\{)/m.test(source))return [];
 const found=[];let quote=null;
 for(const line of source.split('\n')){
  if(!quote){const m=/^\s*node\s+tooling\/([-A-Za-z0-9_./]+\.(?:mjs|js))(?:\s|$)/.exec(line);if(m)found.push(m);}
  for(let i=0;i<line.length;i++){
   const c=line[i];if(c==='\\'&&quote!=="'"){i++;continue;}
   if(!quote&&c==='#')break;
   if(c===quote)quote=null;else if(!quote&&(c==='"'||c==="'"))quote=c;
  }
 }
 return found;
}
function calleeProof(yaml,spec,admissionScopesRequested=false){
 const inputs=yaml?.on?.workflow_call?.inputs;
 const optional=inputs?.admission_scopes;
 const expectedInputs=optional?['admission_scopes',...spec.inputs].sort():spec.inputs;
 if(optional&&(spec.name!=='implementation-impact'||Object.keys(optional).sort().join(',')!=='default,required,type'||optional.required!==false||optional.type!=='string'||optional.default!==''))fail('CALLEE_INTERFACE_MISMATCH',{path:spec.name});
 if(!inputs||admissionScopesRequested&&!optional||Object.keys(inputs).sort().join(',')!==expectedInputs.join(',')||spec.inputs.some(k=>inputs[k].required!==true||inputs[k].type!=='string'))fail('CALLEE_INTERFACE_MISMATCH',{path:spec.name});
 const job=yaml.jobs?.[spec.calleeJob];
 const knownGateGuard=spec.calleeJob==='gate'&&job?.if==="always() && (github.event_name == 'pull_request' || needs.snapshot-main.result == 'success')"&&Array.isArray(job.needs)&&job.needs.length===1&&job.needs[0]==='snapshot-main';
 if(!job||job.if!==undefined&&!knownGateGuard||job['continue-on-error'])fail('CALLEE_REQUIRED_JOB_MISSING',{path:spec.name});
 const checkout=(job.steps||[]).find(s=>s.uses?.startsWith('actions/checkout@')&&s.with?.repository===BRAIN&&s.with?.path==='tooling');
 if(!checkout||!/^\$\{\{ inputs\.tooling_revision(?: \|\| github\.[a-z_.]+)* \}\}$/.test(checkout.with.ref))fail('CALLEE_TOOLING_SOURCE_UNPROVEN',{path:spec.name});
 const runners=[];
 for(const step of job.steps||[]){
  const source=String(step.run||'');let commands=directNodeCommands(source),conditional=false;
  // callerProof 固定既有 scope=zenithjoy；这个精确预读只在独立巡查 scope 执行。
  // 它不能替代 required runner，也不能把未执行的 helper 冒记为既有消费者。
  if(source.includes('tooling/scripts/ci/implementation-patrol-baseline.mjs')){
   if(spec.name!=='implementation-impact'||step.if!=="env.MAP_SCOPE == 'cecelia-device-patrol'"
     ||job.env?.MAP_SCOPE!=="${{ inputs.scope || vars.IMPLEMENTATION_MAP_SCOPE || 'cecelia-kr' }}"
     ||job.env?.TOOLING_REVISION!==checkout.with.ref||step['continue-on-error']
     ||Object.keys(step.env||{}).sort().join(',')!=='GH_TOKEN'
     ||step.env.GH_TOKEN!=="${{ secrets.CECELIA_ACTIONS_READ_TOKEN || github.token }}"
     ||sha(Buffer.from(source))!=='c71a8a0bcc037d66a9beb56efa82f91179e09bad262139925cad1e85a05142e8')
    fail('CALLEE_PATROL_PRELUDE_UNPROVEN',{path:spec.name});
   continue;
  }
  // schema-v1的完整已审阅分支字节；复杂或改变后的shell仍UNKNOWN。
  if(spec.name==='implementation-impact'&&optional&&sha(Buffer.from(source))==='8e54cd03b82a18c8c94eaf0a438744193e093d680aa133f416e33ba4ca3ae21d'){
   if(job.env?.MODE!=="${{ inputs.mode || (github.event_name == 'pull_request' && 'pr' || 'main') }}"||!ADMISSION_SCOPE_ENV.has(job.env?.ADMISSION_SCOPES))fail('CALLEE_INTERFACE_MISMATCH',{path:spec.name});
   commands=[...source.matchAll(/^\s*node\s+tooling\/([-A-Za-z0-9_./]+\.(?:mjs|js))(?:\s|$)/gm)];conditional=true;
  }
  for(const m of commands){
   if(step.if!==undefined||step['continue-on-error'])fail('CALLEE_REQUIRED_JOB_MISSING',{path:spec.name});
   if(!RUNNERS.has(m[1])&&!(conditional&&m[1]==='scripts/ci/implementation-multi-pr-gate.mjs'))fail('CALLEE_SOURCE_OUTSIDE_CONTRACT',{path:m[1]});
   runners.push({path:m[1],selector:`jobs.${spec.calleeJob}.steps.${conditional?'fixed_versioned_conditional_node_tooling':'node_tooling'}`});
  }
 }
 if(!runners.some(r=>r.path===spec.runner))fail('CALLEE_RUNNER_MISSING',{path:spec.name});
 return runners;
}

export async function extractWorkspaceCiSourceBundle({workspace,brain,readSource,identity}={}){
 const gaps=[],bindings=[],relations=[],brainRevisions=brain?.revisions||[brain?.revision];
 const source_set=[workspace&&({...workspace}),...brainRevisions.map(revision=>({repo:brain?.repo,revision}))];
 const result=()=>({schema_version:1,source_basis:'fixed_revision_bytes',source_scope:'cecelia-factory',definition_scope:'consumer_evidence',source_set,admission:{status:'unknown',trusted_main_history:{status:'not_evaluated',required:'central trusted collector: Brain formal main ancestry or artifact provenance'},gaps:[{code:'BRAIN_MAIN_HISTORY_UNVERIFIED'}]},executable:false,status:gaps.length?'unknown':'verified',gaps,consumer:{...F3_IDENTITY,definition_scope:'consumer_evidence',status:gaps.length?'unknown':'verified',gaps:[...gaps],bindings,input_relations:relations},workflow_coverage:{status:'unknown',verified_reference_ids:gaps.length?[]:[F3_IDENTITY.reference_id],unverified_reference_ids:gaps.length?[F3_IDENTITY.reference_id,...UNVERIFIED]:[...UNVERIFIED]}});
 try{
  if(!identity||Object.keys(F3_IDENTITY).some(k=>identity[k]!==F3_IDENTITY[k])||Object.keys(identity).some(k=>!(k in F3_IDENTITY)))fail('F3_IDENTITY_MISMATCH');
  if(workspace?.repo!==WORKSPACE||brain?.repo!==BRAIN||!SHA.test(workspace?.revision||'')||!Array.isArray(brainRevisions)||!brainRevisions.length||brainRevisions.length>2||brainRevisions.some(r=>!SHA.test(r||''))||new Set(brainRevisions).size!==brainRevisions.length||Object.keys(workspace).sort().join(',')!=='repo,revision'||!['repo,revision','repo,revisions'].includes(Object.keys(brain).sort().join(','))||typeof readSource!=='function')fail('SOURCE_IDENTITY_INVALID');
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
   const callerEvidence=callerProof(caller.value,spec,brainRevisions);
   const reader=await read(workspace,spec.reader),readerBytes=await readSource({...workspace,path:spec.reader});
   if(sha(readerBytes)!==reader.content_sha256)fail('SOURCE_CHANGED_DURING_READ',{repo:workspace.repo,path:spec.reader});
   const readerEvidence=readerProof(readerBytes.toString(),spec.reader,path);
   relations.push({consumer:caller.source,input:reader,kind:'required_node_test',selector:callerEvidence.selector},{consumer:reader,input:caller.source,kind:'yaml_readfile_input',...readerEvidence});
   const calleeSide={repo:BRAIN,revision:callerEvidence.brainRevision};
   const callee=await yaml(calleeSide,path),runners=calleeProof(callee.value,spec,callerEvidence.admissionScopesRequested);
   relations.push({consumer:caller.source,input:callee.source,kind:'fixed_reusable_workflow',selector:`jobs.${spec.callerJob}.uses+tooling_revision`});
   for(const runner of runners){const code=await read(calleeSide,runner.path);relations.push({consumer:callee.source,input:code,kind:'fixed_job_node_source',selector:runner.selector});}
  }
  if(brainRevisions.some(revision=>!bindings.some(b=>b.repo===BRAIN&&b.revision===revision)))fail('SOURCE_IDENTITY_UNUSED');
 }catch(e){gaps.push({code:e.code||'SOURCE_PROTOCOL_INVALID',...(e.details||{})});}
 return result();
}
