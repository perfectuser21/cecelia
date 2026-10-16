/** 可信 main 的中央快照发布器；HTTP 错误只作诊断，完整验证后才发布正式文件。 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,renameSync,existsSync,realpathSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateImplementationSnapshot,extractImplementationAdmissionSnapshots} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
const SHA=/^[a-f0-9]{40}$/;
const REFRESHABLE=new Set(['definition_snapshot_missing','scope_manifest_missing','manifest_source_mismatch']);
const CAS_CODES=new Set(['MAP_MANIFEST_ACTIVE_CONFLICT']);
const fail=(code,details={})=>Object.assign(Error(code),{code,...details});
// 固定枚举来源：implementation-ci-snapshot.js 的 ciFailure 和已知 provider 错误。
const SAFE_CODES=new Set([
 'ACTIVITY_CONTRACT_SNAPSHOT_CHANGED',
 'IMPLEMENTATION_CI_ACTIVITY_CONTRACT_SNAPSHOT_CHANGED',
 'IMPLEMENTATION_CI_ADMISSION_COMPANION_MISSING',
 'IMPLEMENTATION_CI_ADMISSION_SCOPES_INVALID',
 'IMPLEMENTATION_CI_ADMISSION_SNAPSHOT_UNKNOWN',
 'IMPLEMENTATION_CI_ARTIFACT_ORIGIN_INVALID',
 'IMPLEMENTATION_CI_AUTHORING_SNAPSHOT_CHANGED',
 'IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING',
 'IMPLEMENTATION_CI_BASE_SNAPSHOT_UNKNOWN',
 'IMPLEMENTATION_CI_COMPANION_DIGEST_MISMATCH',
 'IMPLEMENTATION_CI_COMPANION_FACTORY_DEFINITION_INVALID',
 'IMPLEMENTATION_CI_COMPANION_FACTORY_EXECUTION_INVALID',
 'IMPLEMENTATION_CI_COMPANION_FACTORY_IDENTITY_INVALID',
 'IMPLEMENTATION_CI_COMPANION_FACTORY_INVALID',
 'IMPLEMENTATION_CI_COMPANION_IDENTITY_INVALID',
 'IMPLEMENTATION_CI_COMPANION_REGISTRY_DIGEST_MISMATCH',
 'IMPLEMENTATION_CI_COMPANION_SNAPSHOT_IDENTITY_INVALID',
 'IMPLEMENTATION_CI_COMPANION_SOURCE_SET_INVALID',
 'IMPLEMENTATION_CI_COMPANION_STATUS_INVALID',
 'IMPLEMENTATION_CI_CONSUMER_MAIN_SOURCE_UNKNOWN',
 'IMPLEMENTATION_CI_CONSUMER_REFRESH_INPUT_INVALID',
 'IMPLEMENTATION_CI_CONSUMER_SOURCE_SET_INVALID',
 'IMPLEMENTATION_CI_CROSS_REPO_SNAPSHOT_MISSING',
 'IMPLEMENTATION_CI_DEFINITION_DIGEST_MISMATCH',
 'IMPLEMENTATION_CI_FACTORY_CANONICAL_REGISTRY_MISMATCH',
 'IMPLEMENTATION_CI_FACTORY_EXECUTION_BOUNDARY_INVALID',
 'IMPLEMENTATION_CI_FACTORY_REGISTRY_DIGEST_MISMATCH',
 'IMPLEMENTATION_CI_FACTORY_REGISTRY_IDENTITY_INVALID',
 'IMPLEMENTATION_CI_HTTP_ERROR',
 'IMPLEMENTATION_CI_INTERNAL_ERROR',
 'IMPLEMENTATION_CI_MAIN_MOVED',
 'IMPLEMENTATION_CI_MAIN_UNAVAILABLE',
 'IMPLEMENTATION_CI_OUTPUT_EXISTS',
 'IMPLEMENTATION_CI_PUBLISH_FAILED',
 'IMPLEMENTATION_CI_REFRESH_UNCONFIGURED',
 'IMPLEMENTATION_CI_REPOSITORY_CONFLICT',
 'IMPLEMENTATION_CI_REPOSITORY_INPUT_INVALID',
 'IMPLEMENTATION_CI_REVISION_INVALID',
 'IMPLEMENTATION_CI_SCOPE_REPOSITORY_AMBIGUOUS',
 'IMPLEMENTATION_CI_SCOPE_REPOSITORY_MISSING',
 'IMPLEMENTATION_CI_SNAPSHOT_DIGEST_MISMATCH',
 'IMPLEMENTATION_CI_SNAPSHOT_IDENTITY_MISMATCH',
 'IMPLEMENTATION_CI_SNAPSHOT_INVALID',
 'IMPLEMENTATION_CI_SNAPSHOT_NOT_REFRESHABLE',
 'IMPLEMENTATION_CI_SNAPSHOT_PROVIDER_FAILED',
 'IMPLEMENTATION_CI_SNAPSHOT_STATUS_INVALID',
 'IMPLEMENTATION_CI_SNAPSHOT_UNKNOWN',
 'IMPLEMENTATION_CI_SOURCE_COMMIT_MISMATCH',
 'IMPLEMENTATION_CI_SOURCE_COMMIT_UNAVAILABLE',
 'IMPLEMENTATION_CI_SOURCE_PATH_INVALID',
 'IMPLEMENTATION_CI_SOURCE_REGISTRY_INVALID',
 'IMPLEMENTATION_CI_SOURCE_REGISTRY_MISSING',
 'IMPLEMENTATION_CI_SOURCE_REGISTRY_OWNER_INVALID',
 'IMPLEMENTATION_CI_SOURCE_TREE_INCOMPLETE',
 'IMPLEMENTATION_CI_SOURCE_TREE_UNAVAILABLE',
 'IMPLEMENTATION_CI_SOURCE_UNAVAILABLE',
 'IMPLEMENTATION_CI_SYNC_ADAPTER_MISSING',
 'IMPLEMENTATION_CI_TOKEN_MISSING',
 'IMPLEMENTATION_CI_URL_INVALID',
 'MAP_MANIFEST_ACTIVE_CONFLICT',
 'OPS_REGISTRY_CHANGED',
 'OPS_SOURCE_PARSER_UNAVAILABLE',
 'OPS_SOURCE_UNKNOWN',
]);
const SAFE_CAUSES=new Set(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','EPIPE','ABORT_ERR','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','ERR_INVALID_URL']);
const SAFE_NAMES=new Set(['Error','TypeError','RangeError','SyntaxError','AbortError','TimeoutError','AggregateError']);
const safeCode=value=>SAFE_CODES.has(value)||SAFE_CAUSES.has(value)?value:null;
const readProperty=(value,key)=>{try{return value?.[key];}catch{return undefined;}};
function exceptionDiagnostic(error,depth=0){
 const name=readProperty(error,'name'),code=readProperty(error,'code'),rawMessage=readProperty(error,'message'),cause=depth<2?readProperty(error,'cause'):null;
 const message=typeof rawMessage==='string'?rawMessage:null;
 return {name:SAFE_NAMES.has(name)?name:null,code:safeCode(code),
  message_length:message?.length??null,message_sha256:message===null?null:createHash('sha256').update(message).digest('hex'),
  ...(cause?{cause:exceptionDiagnostic(cause,depth+1)}:{})};
}

export function validatePublishedSnapshot(body,{scope,repo,revision,complete=false}){
 if(body?.error)throw fail('IMPLEMENTATION_CI_SNAPSHOT_PROVIDER_FAILED',{provider_code:body.error.code??null});
 const s=validateImplementationSnapshot(body?.snapshot);
 if(s.scope!==scope||s.repo!==repo||s.revision!==revision)throw fail('IMPLEMENTATION_CI_SNAPSHOT_IDENTITY_MISMATCH');
 if(!['verified','unknown'].includes(s.status)||!Array.isArray(s.gaps)||(s.status==='verified')!==(s.gaps.length===0))throw fail('IMPLEMENTATION_CI_SNAPSHOT_STATUS_INVALID');
 if(complete){
  if(s.status!=='verified')throw fail('IMPLEMENTATION_CI_SNAPSHOT_UNKNOWN');
  if(scope==='cecelia-kr'&&repo==='perfectuser21/cecelia')extractImplementationAdmissionSnapshots(s,['cecelia-kr','cecelia-factory']);
 }
 return s;
}
/** 中央只保留当前 active manifest；旧 SHA 只能回退到同 SHA 的正式 provider 产物。 */
function readHistoricalArtifact({repo,revision,diagnostics}){
 const gh=(endpoint,binary=false)=>execFileSync('gh',['api',endpoint],{encoding:binary?undefined:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
 const json=endpoint=>JSON.parse(gh(endpoint));
 const name=`implementation-snapshot-${revision}`,prefix=`repos/${repo}/actions`;
 const collection=json(`${prefix}/artifacts?name=${name}&per_page=100`);
 if(!Array.isArray(collection.artifacts)||collection.total_count>100)throw fail('IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING');
 const valid=item=>Number.isSafeInteger(item?.id)&&item.id>0&&item.name===name&&item.expired===false
  &&typeof item.created_at==='string'&&item.created_at.trim()!==''&&Number.isFinite(Date.parse(item.created_at))
  &&item.workflow_run?.head_sha===revision&&item.workflow_run.head_branch==='main'
  &&Number.isSafeInteger(item.workflow_run.id)&&item.workflow_run.id>0
  &&Number.isSafeInteger(item.workflow_run.repository_id)&&item.workflow_run.repository_id===item.workflow_run.head_repository_id;
 const candidate=collection.artifacts.filter(valid).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id)[0];
 if(!candidate)throw fail('IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING');
 const artifact=json(`${prefix}/artifacts/${candidate.id}`);
 if(!valid(artifact)||artifact.id!==candidate.id||artifact.workflow_run.id!==candidate.workflow_run.id)throw fail('IMPLEMENTATION_CI_ARTIFACT_ORIGIN_INVALID');
 const runId=artifact.workflow_run.id,run=json(`${prefix}/runs/${runId}`);
 if(run.id!==runId||run.head_sha!==revision||run.head_branch!=='main'||!['push','workflow_dispatch'].includes(run.event)
  ||run.path!=='.github/workflows/implementation-impact.yml'||run.repository?.full_name!==repo||run.head_repository?.full_name!==repo)throw fail('IMPLEMENTATION_CI_ARTIFACT_ORIGIN_INVALID');
 const jobs=json(`${prefix}/runs/${runId}/jobs?per_page=100`);
 if(!Number.isInteger(jobs.total_count)||jobs.total_count>100||!Array.isArray(jobs.jobs)
  ||!jobs.jobs.some(j=>j.name==='snapshot-main'&&j.status==='completed'&&j.conclusion==='success'))throw fail('IMPLEMENTATION_CI_SNAPSHOT_PROVIDER_FAILED');
 const temporary=mkdtempSync(join(diagnostics,'historical-artifact-'));
 try{
  const archive=join(temporary,'snapshot.zip');writeFileSync(archive,gh(`${prefix}/artifacts/${artifact.id}/zip`,true));
  const body=JSON.parse(execFileSync('unzip',['-p',archive,'head.json'],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));
  writeFileSync(join(diagnostics,'historical-base-source.json'),JSON.stringify({repo,revision,artifact_id:artifact.id,run_id:runId,provider_job:'snapshot-main',provider_status:'success'})+'\n');
  return body;
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
function refreshable(snapshot){
 const derivedMissing=snapshot.map?.manifest===null&&snapshot.gaps.some(g=>g.code==='scope_manifest_missing');
 return snapshot.gaps.length>0&&snapshot.gaps.every(g=>REFRESHABLE.has(g.code)||derivedMissing&&g.code==='workflow_capability_unmapped');
}
/** 历史 base 只证明原 main 差分父输入；不会刷新旧 SHA 或替换成 latest。 */
export async function publishMainSnapshots({brainUrl,token,scope,repo,base,head,output='evidence'},
 {fetchFn=globalThis.fetch,readMain=(repository)=>execFileSync('gh',['api',`repos/${repository}/commits/main`,'--jq','.sha'],{encoding:'utf8',timeout:30000}).trim()}={}){
 if(!token)throw fail('IMPLEMENTATION_CI_TOKEN_MISSING');
 if(!SHA.test(base)||!SHA.test(head)||!/^[-\w.]+\/[-\w.]+$/.test(repo)||!/^[-\w]+$/.test(scope))throw fail('IMPLEMENTATION_CI_REVISION_INVALID');
 const origin=new URL(brainUrl);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash)throw fail('IMPLEMENTATION_CI_URL_INVALID');
 const diagnostics=join(output,'diagnostics');mkdirSync(diagnostics,{recursive:true});
 if(['base.json','head.json'].some(name=>existsSync(join(output,name))))throw fail('IMPLEMENTATION_CI_OUTPUT_EXISTS');
 let sequence=0,operation={stage:'initialization',started_at:new Date().toISOString()};
 const main=async()=>{
  operation={stage:'read_main',revision:head,started_at:new Date().toISOString()};
  try{if(await readMain(repo)!==head)throw fail('IMPLEMENTATION_CI_MAIN_MOVED');}
  finally{operation.finished_at=new Date().toISOString();}
 };
 const validate=(body,options)=>{
  operation={stage:'validate_snapshot',scope:options.scope,revision:options.revision,started_at:new Date().toISOString()};
  try{return validatePublishedSnapshot(body,options);}finally{operation.finished_at=new Date().toISOString();}
 };
 const request=async(method,targetScope,revision)=>{
  const route=method==='POST'?'refresh':'snapshot';const url=new URL(`${origin.href.replace(/\/$/,'')}/api/brain/implementation-ci/${route}`);
  const query={scope:targetScope,repo,revision};if(method==='GET')url.search=new URLSearchParams(query).toString();
  const attempt=++sequence;
  operation={stage:'request_fetch',method,scope:targetScope,revision,started_at:new Date().toISOString(),finished_at:null,
   fetch_invoked:false,dispatch_status:'UNKNOWN',response_received:false,http_status:null,body_read_completed:false,
   post_outcome:method==='POST'?'UNKNOWN':null};
  const observation=operation;
  const save=()=>writeFileSync(join(diagnostics,`request-${attempt}.json`),JSON.stringify(observation,null,2)+'\n');
  let failed=false;
  try{
  save();
  const options={method,redirect:'error',headers:{'X-Internal-Token':token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(query)}:{}),signal:AbortSignal.timeout(600000)};
  observation.fetch_invoked=true;
  const response=await fetchFn(url,options);
  observation.response_received=true;observation.http_status=Number.isInteger(response.status)?response.status:null;
  observation.stage='request_body';save();
  const text=await response.text();observation.body_read_completed=true;
  observation.post_outcome=method==='POST'?'RESPONSE_RECEIVED':null;
  let body;try{body=JSON.parse(text);}catch{body=null;}
  writeFileSync(join(diagnostics,`${attempt}-${route}.json`),JSON.stringify({method,...query,http_status:response.status,body:body??text},null,2)+'\n');
  if(!response.ok)throw fail(body?.error?.code??'IMPLEMENTATION_CI_HTTP_ERROR',{status:response.status,provider_code:body?.error?.code??null});
  if(!body)throw fail('IMPLEMENTATION_CI_SNAPSHOT_INVALID');return body;
  }catch(error){failed=true;throw error;}
  finally{observation.finished_at=new Date().toISOString();try{save();}catch(error){if(!failed)throw error;}}
 };
 const readParent=async()=>{const b=await request('GET',scope,head);validate(b,{scope,repo,revision:head});return b;};
 const stageSnapshot=(body,target)=>target===scope?body.snapshot:body.snapshot.admission_companion?.snapshot;
 try{
  let baseline=null,baseSource=base===head?'validated_current_head':'central_exact_revision';
  if(base!==head){
   baseline=await request('GET',scope,base);
   let bs=validate(baseline,{scope,repo,revision:base});
   if(bs.status!=='verified'){
    operation={stage:'historical_artifact',revision:base,started_at:new Date().toISOString()};
    baseline=readHistoricalArtifact({repo,revision:base,diagnostics});baseSource='official_exact_revision_artifact';
    bs=validate(baseline,{scope,repo,revision:base});
   }
   if(bs.status!=='verified')throw fail('IMPLEMENTATION_CI_BASE_SNAPSHOT_UNKNOWN');
  }
  await main();let current=await readParent();
  const scopes=scope==='cecelia-kr'&&repo==='perfectuser21/cecelia'?[scope,'cecelia-factory']:[scope];
  for(let round=0;round<2;round++){
   for(const target of scopes){
    const before=stageSnapshot(current,target);
    if(!before)throw fail('IMPLEMENTATION_CI_ADMISSION_COMPANION_MISSING');
    if(before.status==='verified'&&before.gaps.length===0)continue;
    if(!refreshable(before))throw fail('IMPLEMENTATION_CI_SNAPSHOT_NOT_REFRESHABLE');
    await main();let conflict;
    try{
     const refreshed=await request('POST',target,head);
     validate(refreshed,{scope:target,repo,revision:head});
    }catch(error){
     if(readProperty(error,'status')!==409||!CAS_CODES.has(readProperty(error,'code')))throw error;
     conflict=error; // 只复用同 SHA 的已提交赢家；不重发 refresh、不放宽中央 CAS。
    }
    await main();current=await readParent();const after=stageSnapshot(current,target);
    if(after?.status!=='verified'||after.gaps.length)throw conflict??fail('IMPLEMENTATION_CI_SNAPSHOT_UNKNOWN');
   }
   current=await readParent();await main();
   const missing=scopes.map(target=>stageSnapshot(current,target)).filter(s=>s?.status!=='verified'||s.gaps.length);
   if(!missing.length)break;
   if(round===1)throw fail('IMPLEMENTATION_CI_SNAPSHOT_UNKNOWN');
   if(missing.some(s=>s?.status!=='unknown'||!refreshable(s)))throw fail('IMPLEMENTATION_CI_SNAPSHOT_NOT_REFRESHABLE');
   // 仅已通过的阶段在最终读取时退化才补一次；POST失败与单阶段验证失败不会到达这里。
   await main();current=await readParent();await main();
  }
  validate(current,{scope,repo,revision:head,complete:true});await main();
  if(base===head)baseline=current; // 当前 SHA 不是历史：只复用刚完成双 scope 验证的同一 bundle。
  // 两份都完成验证后再落盘；upload 只在整个 step 成功时允许执行。
  for(const [name,value] of [['base',baseline],['head',current]]){
   const temporary=join(output,`.${name}.validated.tmp`);writeFileSync(temporary,JSON.stringify(value)+'\n');renameSync(temporary,join(output,`${name}.json`));
  }
  const proof={schema_version:1,scope,repo,base_revision:base,head_revision:head,head_snapshot_sha256:current.snapshot.snapshot_sha256,admission_scopes:scopes,base_admission:'parent_scope_only',base_source:baseSource,status:'verified'};
  writeFileSync(join(diagnostics,'publication.json'),JSON.stringify(proof,null,2)+'\n');return proof;
 }catch(error){
  const exception=exceptionDiagnostic(error),status=readProperty(error,'status'),providerCode=readProperty(error,'provider_code');
  try{writeFileSync(join(diagnostics,'failure.json'),JSON.stringify({status:'failed',code:exception.code??'IMPLEMENTATION_CI_PUBLISH_FAILED',http_status:Number.isInteger(status)?status:null,provider_code:safeCode(providerCode),scope,repo,base_revision:base,head_revision:head,operation:{...operation,finished_at:operation.finished_at??new Date().toISOString()},exception},null,2)+'\n');}catch{} // 诊断失败不能替换原始操作异常。
  throw error;
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 publishMainSnapshots({brainUrl:process.env.BRAIN_URL,token:process.env.CECELIA_INTERNAL_TOKEN,scope:process.env.MAP_SCOPE,repo:process.env.SOURCE_REPO,base:process.env.BASE,head:process.env.HEAD})
  .then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(`${safeCode(readProperty(error,'code'))??'IMPLEMENTATION_CI_PUBLISH_FAILED'}\n`);process.exitCode=1;});
}
