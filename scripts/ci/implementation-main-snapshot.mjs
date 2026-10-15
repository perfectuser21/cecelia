/** 可信 main 的中央快照发布器；HTTP 错误只作诊断，完整验证后才发布正式文件。 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,renameSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateImplementationSnapshot,extractImplementationAdmissionSnapshots} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
const SHA=/^[a-f0-9]{40}$/;
const REFRESHABLE=new Set(['definition_snapshot_missing','scope_manifest_missing','manifest_source_mismatch']);
const CAS_CODES=new Set(['MAP_MANIFEST_ACTIVE_CONFLICT','ACTIVITY_CONTRACT_SNAPSHOT_CHANGED','IMPLEMENTATION_CI_ACTIVITY_CONTRACT_SNAPSHOT_CHANGED']);
const fail=(code,details={})=>Object.assign(Error(code),{code,...details});
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
/** 历史 base 只证明原 main 差分父输入；不会刷新旧 SHA 或替换成 latest。 */
export async function publishMainSnapshots({brainUrl,token,scope,repo,base,head,output='evidence'},
 {fetchFn=globalThis.fetch,readMain=(repository)=>execFileSync('gh',['api',`repos/${repository}/commits/main`,'--jq','.sha'],{encoding:'utf8',timeout:30000}).trim()}={}){
 if(!token)throw fail('IMPLEMENTATION_CI_TOKEN_MISSING');
 if(!SHA.test(base)||!SHA.test(head)||!/^[-\w.]+\/[-\w.]+$/.test(repo)||!/^[-\w]+$/.test(scope))throw fail('IMPLEMENTATION_CI_REVISION_INVALID');
 const origin=new URL(brainUrl);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash)throw fail('IMPLEMENTATION_CI_URL_INVALID');
 const diagnostics=join(output,'diagnostics');mkdirSync(diagnostics,{recursive:true});
 if(['base.json','head.json'].some(name=>existsSync(join(output,name))))throw fail('IMPLEMENTATION_CI_OUTPUT_EXISTS');
 let sequence=0;
 const main=async()=>{if(await readMain(repo)!==head)throw fail('IMPLEMENTATION_CI_MAIN_MOVED');};
 const request=async(method,targetScope,revision)=>{
  const route=method==='POST'?'refresh':'snapshot';const url=new URL(`${origin.href.replace(/\/$/,'')}/api/brain/implementation-ci/${route}`);
  const query={scope:targetScope,repo,revision};if(method==='GET')url.search=new URLSearchParams(query).toString();
  const response=await fetchFn(url,{method,redirect:'error',headers:{'X-Internal-Token':token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(query)}:{}),signal:AbortSignal.timeout(600000)});
  const text=await response.text();let body;try{body=JSON.parse(text);}catch{body=null;}
  writeFileSync(join(diagnostics,`${++sequence}-${route}.json`),JSON.stringify({method,...query,http_status:response.status,body:body??text},null,2)+'\n');
  if(!response.ok)throw fail(body?.error?.code??'IMPLEMENTATION_CI_HTTP_ERROR',{status:response.status,provider_code:body?.error?.code??null});
  if(!body)throw fail('IMPLEMENTATION_CI_SNAPSHOT_INVALID');return body;
 };
 const readParent=async()=>{const b=await request('GET',scope,head);validatePublishedSnapshot(b,{scope,repo,revision:head});return b;};
 const stageSnapshot=(body,target)=>target===scope?body.snapshot:body.snapshot.admission_companion?.snapshot;
 try{
  const baseline=await request('GET',scope,base);const bs=validatePublishedSnapshot(baseline,{scope,repo,revision:base});
  if(bs.status!=='verified')throw fail('IMPLEMENTATION_CI_BASE_SNAPSHOT_UNKNOWN');
  await main();let current=await readParent();
  const scopes=scope==='cecelia-kr'&&repo==='perfectuser21/cecelia'?[scope,'cecelia-factory']:[scope];
  for(const target of scopes){
   const before=stageSnapshot(current,target);
   if(!before)throw fail('IMPLEMENTATION_CI_ADMISSION_COMPANION_MISSING');
   if(before.status==='verified'&&before.gaps.length===0)continue;
   if(!before.gaps.length||before.gaps.some(g=>!REFRESHABLE.has(g.code)))throw fail('IMPLEMENTATION_CI_SNAPSHOT_NOT_REFRESHABLE');
   await main();let conflict;
   try{
    const refreshed=await request('POST',target,head);
    validatePublishedSnapshot(refreshed,{scope:target,repo,revision:head});
   }catch(error){
    if(error.status!==409||!CAS_CODES.has(error.code))throw error;
    conflict=error; // 只复用同 SHA 的已提交赢家；不重发 refresh、不放宽中央 CAS。
   }
   await main();current=await readParent();const after=stageSnapshot(current,target);
   if(after?.status!=='verified'||after.gaps.length)throw conflict??fail('IMPLEMENTATION_CI_SNAPSHOT_UNKNOWN');
  }
  current=await readParent();validatePublishedSnapshot(current,{scope,repo,revision:head,complete:true});await main();
  // 两份都完成验证后再落盘；upload 只在整个 step 成功时允许执行。
  for(const [name,value] of [['base',baseline],['head',current]]){
   const temporary=join(output,`.${name}.validated.tmp`);writeFileSync(temporary,JSON.stringify(value)+'\n');renameSync(temporary,join(output,`${name}.json`));
  }
  const proof={schema_version:1,scope,repo,base_revision:base,head_revision:head,head_snapshot_sha256:current.snapshot.snapshot_sha256,admission_scopes:scopes,base_admission:'parent_scope_only',status:'verified'};
  writeFileSync(join(diagnostics,'publication.json'),JSON.stringify(proof,null,2)+'\n');return proof;
 }catch(error){
  writeFileSync(join(diagnostics,'failure.json'),JSON.stringify({status:'failed',code:error.code??'IMPLEMENTATION_CI_PUBLISH_FAILED',http_status:error.status??null,provider_code:error.provider_code??null,scope,repo,base_revision:base,head_revision:head},null,2)+'\n');throw error;
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 publishMainSnapshots({brainUrl:process.env.BRAIN_URL,token:process.env.CECELIA_INTERNAL_TOKEN,scope:process.env.MAP_SCOPE,repo:process.env.SOURCE_REPO,base:process.env.BASE,head:process.env.HEAD})
  .then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(`${error.code??'IMPLEMENTATION_CI_PUBLISH_FAILED'}\n`);process.exitCode=1;});
}
