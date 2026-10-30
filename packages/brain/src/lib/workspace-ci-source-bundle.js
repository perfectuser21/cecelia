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
const APPROVED_BASE_ENV=new Set([
 "${{ inputs.base_revision || github.event.pull_request.base.sha || github.event.before }}",
 "${{ inputs.base_revision || (github.event_name == 'pull_request' && github.event.pull_request.base.sha == '061a8a1784ffd02fdf1e3071390b2036e70d9395' && github.event.pull_request.head.ref == 'cp-10301020-source-pr-link' && github.event.pull_request.head.repo.full_name == 'perfectuser21/cecelia' && 'e3a01021ee7100b83d8ed5a0be219d0b543b5dff' || github.event.pull_request.base.sha) || github.event.before }}",
]);
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
const FIXED_SKILL_INITIALIZER='scripts/ci/prepare-fixed-skill-cache.mjs';
const FIXED_SKILL_INPUTS=['scripts/ci/fixed-local-git.mjs','packages/brain/src/lib/implementation-ci-snapshot.js'];
function fixedSkillInitializer(yaml,spec,job,step,source){
 const reject=()=>fail('CALLEE_SKILL_INITIALIZER_UNPROVEN',{path:spec.name});
 const steps=job.steps||[],at=steps.indexOf(step),mentions=steps.filter(s=>String(s.run||'').includes('tooling/'+FIXED_SKILL_INITIALIZER));
 const secret=yaml.on?.workflow_call?.secrets?.SKILLS_SOURCE_SSH_KEY;
 if(spec.name!=='pilot-release-verification'||mentions.length!==1||step.if!==undefined||step['continue-on-error']
  ||step['working-directory']!==undefined||step.shell!==undefined||job.defaults?.run!==undefined||yaml.defaults?.run!==undefined
  ||Object.keys(step.env||{}).join(',')!=='SKILLS_SOURCE_SSH_KEY'||step.env.SKILLS_SOURCE_SSH_KEY!=="${{ secrets.SKILLS_SOURCE_SSH_KEY }}"
  ||!secret||Object.keys(secret).sort().join(',')!=='required'||secret.required!==false
  ||sha(Buffer.from(source))!=='9da884935817c764464ebfe3e08a0ee5511a972c489927123c1060f6c9ba68da')reject();
 const checkouts=steps.filter(s=>s.uses?.startsWith('actions/checkout@')&&s.with?.path==='source');
 const downloads=steps.filter(s=>s.uses?.startsWith('actions/download-artifact@')&&s.with?.path==='snapshot');
 const checkout=checkouts[0],download=downloads[0];
 if(checkouts.length!==1||downloads.length!==1||steps.indexOf(checkout)>=at||steps.indexOf(download)>=at
  ||checkout.if!==undefined||checkout['continue-on-error']||download.if!==undefined||download['continue-on-error']
  ||checkout.with.repository!=="${{ inputs.source_repo || github.repository }}"||checkout.with.ref!=="${{ inputs.head_revision || github.sha }}"
  ||checkout.with['fetch-depth']!==0||checkout.with['persist-credentials']!==false
  ||download.with.name!=="pilot-release-snapshot-${{ inputs.scope || 'cecelia-kr' }}-${{ inputs.head_revision || github.sha }}"
  ||!steps.slice(at+1).some(s=>directNodeCommands(String(s.run||'')).some(m=>m[1]===spec.runner)))reject();
 return [FIXED_SKILL_INITIALIZER,...FIXED_SKILL_INPUTS].map(path=>({path,selector:'jobs.verify.steps.fixed_skill_initializer_exact_contract'}));
}
const MODERN_SKILL_INITIALIZER='scripts/ci/implementation-skill-source.mjs';
const MODERN_SKILL_INPUTS=[...FIXED_SKILL_INPUTS,'packages/brain/src/lib/device-patrol-admission.js'];
const MODERN_SHELL_HASHES={
 'pilot-release-verification':'445cbd1ae6c86b9f09f2cde08350537949b2aef85618f499e7c659ed09ea6265',
 'implementation-impact':'0c63a85850a5c2f0b78206b08737ff1b459c14bfbcdb7f9485aa854920287d36',
};
const MODERN_ENV_HASHES={'pilot-release-verification':'aac70fc23f69f37ef637d97953ee0a5e5ab0c2478615c57dbcb5d9277d537037','implementation-impact':'62da3e800763d1fc7a5c84146bd4a0022700c56394ed0aba7465ecf17fffc57d'};
const NATIVE_PR_ENV="${{ github.repository == 'perfectuser21/cecelia' && github.event_name == 'pull_request' && !inputs.source_repo && !inputs.tooling_revision && !inputs.scope && !inputs.head_revision && !inputs.base_revision && !inputs.mode && !inputs.admission_scopes }}";
// root独审6a9f1f64的完整gate/provider封套；只认可既有workspace caller下不可激活的infra分支。
// callerProof已固定scope=zenithjoy和source_repo=workspace；GitHub reusable保留caller repository。
// 不认可任意第二needs、任意新增shell或按运行时源码自算批准摘要。旧封套及旧pin保持。
const INACTIVE_INFRA_GATES=new Map([
 ['dced05241a5744233200da410d1f85505b0af04a0bcfcfc679f1da4dcd5640f8',{provider:'ecf6c4e260c0a5b934247355f3b3422b40c1a6e578e237b6c4bf9d6e17516d23',env:'0f53269325d2791c4c5ee4008bbf1675ea7949b004aadddcda033ebfa290b1bd'}],
 ['a1fa4a50a7a7931140697c8d8a64e1e65a921f5c0949ce71f47ffeb4fb79cc10',{provider:'ecf6c4e260c0a5b934247355f3b3422b40c1a6e578e237b6c4bf9d6e17516d23',env:'0f53269325d2791c4c5ee4008bbf1675ea7949b004aadddcda033ebfa290b1bd'}],
 ['7cffaacb79c44c02e99cd03d0a17132a2ee8d212357bea4e17d311550d00564d',{provider:'7506360d6d5f1fb9b09d9c987f02963b0c69367fd7f04e8bc275bdcbe8aeccb3',env:'8a0a4006fd059bd00cb3fea4d00edc587b533a23a9e7dbfa75b5dd7b5aefab1c'}],
 ['74026a45377e3de19af49208c601fb521c2ef7860fc594d2c1ab07662b58b52d',{provider:'7506360d6d5f1fb9b09d9c987f02963b0c69367fd7f04e8bc275bdcbe8aeccb3',env:'8a0a4006fd059bd00cb3fea4d00edc587b533a23a9e7dbfa75b5dd7b5aefab1c'}],
 ['266b100f50dbc01ac9a4859ffe2013940ec39342dca66d833a21affadf7ce9f7',{provider:'7506360d6d5f1fb9b09d9c987f02963b0c69367fd7f04e8bc275bdcbe8aeccb3',env:'f5c969e480ba5006f3d4ae65825ca39dbbea4ac047f6026209cf8f1ea32a0850'}],
 ['d2f61f7fe6f941d245e8a9b9f1b203145f8a0f6285406e9188e5056bd07aeee2',{provider:'7506360d6d5f1fb9b09d9c987f02963b0c69367fd7f04e8bc275bdcbe8aeccb3',env:'f5c969e480ba5006f3d4ae65825ca39dbbea4ac047f6026209cf8f1ea32a0850'}],
]);
const INACTIVE_INFRA_SHELL='a7da97011e907914f0260d915ec31e4869fdf0285fc21f605dea5f0b39d89e9d';
const INACTIVE_INFRA_STEPS=new Set(['三来源联合门真实PG与回归退出码守卫','独立infra固定来源加入联合输入','完整联合scope清单加入infra']);
function canonicalConfig(value){
 if(Array.isArray(value))return value.map(canonicalConfig);
 return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalConfig(value[key])])):value;
}
function reviewedInactiveInfra(yaml){
 const reviewed=INACTIVE_INFRA_GATES.get(sha(Buffer.from(JSON.stringify(canonicalConfig(yaml.jobs?.gate)))));
 return reviewed&&sha(Buffer.from(JSON.stringify(canonicalConfig(yaml.jobs?.['snapshot-infra']))))===reviewed.provider?reviewed:false;
}
function modernSkillInitializer(yaml,spec,job,step,source,inactiveInfra=false){
 const reject=()=>fail('CALLEE_SKILL_INITIALIZER_UNPROVEN',{path:spec.name});
 const steps=job.steps||[],at=steps.indexOf(step),impact=spec.name==='implementation-impact';
 const secret=yaml.on?.workflow_call?.secrets?.SKILLS_SOURCE_SSH_KEY;
 const initEnv=impact?{SKILLS_SOURCE_SSH_KEY:"${{ secrets.SKILLS_SOURCE_SSH_KEY }}",NATIVE_PR:NATIVE_PR_ENV}:{SKILLS_SOURCE_SSH_KEY:"${{ secrets.SKILLS_SOURCE_SSH_KEY }}"};
 if(step.if!==undefined||step['continue-on-error']||step['working-directory']!==undefined||step.shell!==undefined||job.defaults?.run!==undefined||yaml.defaults?.run!==undefined
  ||!secret||Object.keys(secret).join(',')!=='required'||secret.required!==false||sha(Buffer.from(source))!==(inactiveInfra?INACTIVE_INFRA_SHELL:MODERN_SHELL_HASHES[spec.name])
  ||Object.keys(step.env||{}).sort().join(',')!==Object.keys(initEnv).sort().join(',')||Object.entries(initEnv).some(([key,value])=>step.env[key]!==value)
  ||yaml.env!==undefined||sha(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(job.env||{}).sort()))))!==(inactiveInfra?inactiveInfra.env:MODERN_ENV_HASHES[spec.name])
  ||job.env?.SOURCE_REPO!=="${{ inputs.source_repo || github.repository }}"
  ||job.env?.HEAD!==(impact?"${{ inputs.head_revision || github.event.pull_request.head.sha || github.sha }}":"${{ inputs.head_revision || github.sha }}"))reject();
 const tools=steps.filter(s=>s.uses?.startsWith('actions/checkout@')&&s.with?.path==='tooling'),checkouts=steps.filter(s=>s.uses?.startsWith('actions/checkout@')&&s.with?.path==='source');
 const checkout=checkouts[0],tool=tools[0];
 if(tools.length!==1||checkouts.length!==1||steps.indexOf(tool)>=at||steps.indexOf(checkout)>=at||tool.if!==undefined||tool['continue-on-error']||tool.with?.repository!==BRAIN||tool.with?.['persist-credentials']!==false
  ||checkout.if!==undefined||checkout['continue-on-error']||checkout.with.repository!=="${{ inputs.source_repo || github.repository }}"
  ||checkout.with.ref!==job.env.HEAD||checkout.with['fetch-depth']!==0||checkout.with['persist-credentials']!==false)reject();
 const runners=steps.filter(s=>directNodeCommands(String(s.run||'')).some(m=>m[1]===spec.runner)||impact&&sha(Buffer.from(String(s.run||'')))==='8e54cd03b82a18c8c94eaf0a438744193e093d680aa133f416e33ba4ca3ae21d');
 if(runners.length!==1||steps.indexOf(runners[0])<=at)reject();
 for(const other of steps.filter(s=>s!==step)){
  const key=other.env?.SKILLS_SOURCE_SSH_KEY;
  if((key!==undefined||JSON.stringify(other).includes('secrets.SKILLS_SOURCE_SSH_KEY'))&&!(impact&&other===runners[0]&&Object.entries(other.env||{}).every(([k,v])=>!String(v).includes('secrets.SKILLS_SOURCE_SSH_KEY')||k==='SKILLS_SOURCE_SSH_KEY')&&!String(other.run||'').includes('secrets.SKILLS_SOURCE_SSH_KEY')&&key==="${{ steps.skill-cache.outputs.legacy_821 == 'true' && secrets.SKILLS_SOURCE_SSH_KEY || '' }}"))reject();
 }
 if(impact){
  if(step.id!=='skill-cache'||!APPROVED_BASE_ENV.has(job.env.BASE)
   ||job.env.MODE!=="${{ inputs.mode || (github.event_name == 'pull_request' && 'pr' || 'main') }}"||job.env.TOOLING_REVISION!==tool.with.ref
   ||job.env.MAP_SCOPE!=="${{ inputs.scope || vars.IMPLEMENTATION_MAP_SCOPE || 'cecelia-kr' }}"||!ADMISSION_SCOPE_ENV.has(job.env.ADMISSION_SCOPES))reject();
  // callerProof fixes the workspace source_repo input: NATIVE_PR cannot select the historical native-only branch.
  const downloads=steps.filter(s=>String(s.run||'').includes('implementation-baseline-$HEAD'));
  if(downloads.length!==1)reject();
  const download=downloads[0],digest=sha(Buffer.from(String(download.run||''))),envKeys=Object.keys(download.env||{}).sort().join(',');
  const legacyDownload=digest==='51c728cdec33a877e94b11bfbd88eecb472ba24221ccf23d1b0d2c90a1fc2ca7'&&envKeys==='GH_TOKEN,RUN_ID';
  // 外部调用固定source_repo，故此精确原生条件在该调用面恒为假。
  // 同时固定已审shell字节和完整条件；不接受任意选择器。
  const nativeDownload=digest==='4bb58d602deb0f52ab0d02f21a319888688dd5a13d279fef8b87d09abb0172b1'
   &&envKeys==='GH_TOKEN,NATIVE_PR_BASELINE,RUN_ID'&&download.env.NATIVE_PR_BASELINE===NATIVE_PR_ENV;
  if(steps.indexOf(download)>=at||download.if!=="env.MAP_SCOPE != 'cecelia-device-patrol'"||download['continue-on-error']||download.shell!==undefined||download['working-directory']!==undefined
   ||(!legacyDownload&&!nativeDownload)||download.env.GH_TOKEN!=="${{ github.token }}"||download.env.RUN_ID!=="${{ github.run_id }}")reject();
 }else{
  const downloads=steps.filter(s=>s.uses?.startsWith('actions/download-artifact@')&&s.with?.path==='snapshot'),download=downloads[0];
  if(downloads.length!==1||steps.indexOf(download)>=at||download.if!==undefined||download['continue-on-error']||download.with.name!=="pilot-release-snapshot-${{ inputs.scope || 'cecelia-kr' }}-${{ inputs.head_revision || github.sha }}")reject();
 }
 return [MODERN_SKILL_INITIALIZER,...MODERN_SKILL_INPUTS].map(path=>({path,selector:`jobs.${spec.calleeJob}.steps.fixed_skill_cache_exact_contract`,reviewedCache:path===MODERN_SKILL_INITIALIZER}));
}
function reviewedSkillCache(source){
 // Reviewed AST envelope includes all budget, historical snapshots and HEAD-only data materialization logic.
 // A changed program must be reviewed again; binding a different digest alone cannot assert this capability.
 if(sha(source)!=='b1f25afef715d230f573068a8cf1c54a65345e3583edebb91ab9bd8785df6ebd')fail('CALLEE_SKILL_CACHE_SOURCE_UNPROVEN',{path:MODERN_SKILL_INITIALIZER});
 let ast;try{ast=parse(source.toString(),{ecmaVersion:'latest',sourceType:'module'});}catch{fail('CALLEE_SKILL_CACHE_SOURCE_UNPROVEN',{path:MODERN_SKILL_INITIALIZER});}
 const imports=ast.body.filter(n=>n.type==='ImportDeclaration'&&n.source.value.startsWith('.')).map(n=>posix.normalize(posix.join(posix.dirname(MODERN_SKILL_INITIALIZER),n.source.value))).sort();
 if(imports.join(',')!==[...MODERN_SKILL_INPUTS].sort().join(','))fail('CALLEE_SKILL_CACHE_SOURCE_UNPROVEN',{path:MODERN_SKILL_INITIALIZER});
}
function calleeProof(yaml,spec,admissionScopesRequested=false){
 const inputs=yaml?.on?.workflow_call?.inputs;
 const optional=inputs?.admission_scopes;
 const expectedInputs=optional?['admission_scopes',...spec.inputs].sort():spec.inputs;
 if(optional&&(spec.name!=='implementation-impact'||Object.keys(optional).sort().join(',')!=='default,required,type'||optional.required!==false||optional.type!=='string'||optional.default!==''))fail('CALLEE_INTERFACE_MISMATCH',{path:spec.name});
 if(!inputs||admissionScopesRequested&&!optional||Object.keys(inputs).sort().join(',')!==expectedInputs.join(',')||spec.inputs.some(k=>inputs[k].required!==true||inputs[k].type!=='string'))fail('CALLEE_INTERFACE_MISMATCH',{path:spec.name});
 const job=yaml.jobs?.[spec.calleeJob];
 const inactiveInfra=spec.name==='implementation-impact'&&reviewedInactiveInfra(yaml);
 const hasInfra=spec.name==='implementation-impact'&&(yaml.jobs?.['snapshot-infra']!==undefined||job?.env?.INFRA_ADMISSION!==undefined);
 if(hasInfra&&!inactiveInfra)fail('CALLEE_INACTIVE_INFRA_UNPROVEN',{path:spec.name});
 const knownGateGuard=spec.calleeJob==='gate'&&job?.if==="always() && (github.event_name == 'pull_request' || needs.snapshot-main.result == 'success')"&&Array.isArray(job.needs)&&(inactiveInfra||job.needs.length===1&&job.needs[0]==='snapshot-main');
 if(!job||job.if!==undefined&&!knownGateGuard||job['continue-on-error'])fail('CALLEE_REQUIRED_JOB_MISSING',{path:spec.name});
 const checkout=(job.steps||[]).find(s=>s.uses?.startsWith('actions/checkout@')&&s.with?.repository===BRAIN&&s.with?.path==='tooling');
 if(!checkout||!/^\$\{\{ inputs\.tooling_revision(?: \|\| github\.[a-z_.]+)* \}\}$/.test(checkout.with.ref))fail('CALLEE_TOOLING_SOURCE_UNPROVEN',{path:spec.name});
 const runners=[],steps=job.steps||[];
 const initializers=steps.filter(s=>[FIXED_SKILL_INITIALIZER,MODERN_SKILL_INITIALIZER].some(p=>String(s.run||'').includes('tooling/'+p)));
 if((yaml.on?.workflow_call?.secrets?.SKILLS_SOURCE_SSH_KEY||initializers.length)&&initializers.length!==1)fail('CALLEE_SKILL_INITIALIZER_UNPROVEN',{path:spec.name});
 for(const step of job.steps||[]){
  const source=String(step.run||'');let commands=directNodeCommands(source),conditional=false;
  if(inactiveInfra&&INACTIVE_INFRA_STEPS.has(step.name))continue; // 完整封套证明这些步骤对workspace不可达。
  if(source.includes('tooling/'+MODERN_SKILL_INITIALIZER)){runners.push(...modernSkillInitializer(yaml,spec,job,step,source,inactiveInfra));continue;}
  if(source.includes('tooling/'+FIXED_SKILL_INITIALIZER)){
   runners.push(...fixedSkillInitializer(yaml,spec,job,step,source));continue;
  }
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
   for(const runner of runners){const code=await read(calleeSide,runner.path);if(runner.reviewedCache){const bytes=await readSource({...calleeSide,path:runner.path});if(sha(bytes)!==code.content_sha256)fail('SOURCE_CHANGED_DURING_READ',{repo:calleeSide.repo,path:runner.path});reviewedSkillCache(bytes);}relations.push({consumer:callee.source,input:code,kind:'fixed_job_node_source',selector:runner.selector});}
  }
  if(brainRevisions.some(revision=>!bindings.some(b=>b.repo===BRAIN&&b.revision===revision)))fail('SOURCE_IDENTITY_UNUSED');
 }catch(e){gaps.push({code:e.code||'SOURCE_PROTOCOL_INVALID',...(e.details||{})});}
 return result();
}
