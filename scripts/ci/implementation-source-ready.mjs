/** 仅等待已发布 main 的实际来源收集器；不登记定义、不刷新任何 scope。 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNativeConsumerRuntime} from '../../packages/brain/src/lib/native-consumer-runtime.js';
const REPO='perfectuser21/cecelia',SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
// 精确历史响应仅表示旧进程仍在运行；绝不能据此宣告新收集器就绪。
const LEGACY_PATHS=['source','runtime-source','build-source','build-envelopes','workspace-source']
 .map(name=>`packages/brain/src/lib/existing-ops-${name}.js`).sort();
const PRIOR_PATHS=[...LEGACY_PATHS,...['envelope','core-envelope','entry-envelopes','local-envelopes'].map(name=>`packages/brain/src/lib/existing-ops-provenance-${name}.js`)].sort();
const PRIOR_STAGE_PATHS=[...PRIOR_PATHS,...['source','envelopes'].map(name=>`packages/brain/src/lib/existing-ops-stage-${name}.js`)].sort();
const fail=code=>Object.assign(Error(code),{code});
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...expected].sort());
export function expectedSourceRuntime({repoRoot,revision}){
 if(!SHA.test(revision))throw fail('SOURCE_READY_INPUT_INVALID');
 const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 if(git('rev-parse','HEAD').trim()!==revision)throw fail('SOURCE_READY_CHECKOUT_MISMATCH');
 const files=readNativeConsumerRuntime().files.map(({path})=>({path,sha256:createHash('sha256').update(execFileSync('git',['show',`${revision}:${path}`],{cwd:repoRoot,timeout:30000,maxBuffer:4*1024*1024})).digest('hex')}));
 return {schema_version:1,repo:REPO,files};
}
function validateResponse(body,expected){
 if(!keys(body,['schema_version','repo','git_sha','files'])||body.schema_version!==1||body.repo!==REPO
  ||!(body.git_sha===null||typeof body.git_sha==='string'&&SHA.test(body.git_sha))
  ||!Array.isArray(body.files))throw fail('SOURCE_READY_RESPONSE_INVALID');
 const prior=[LEGACY_PATHS,PRIOR_PATHS,PRIOR_STAGE_PATHS].find(paths=>paths.length===body.files.length);
 const paths=prior??expected.files.map(file=>file.path);
 if(body.files.length!==paths.length)throw fail('SOURCE_READY_RESPONSE_INVALID');
 for(const [i,file] of body.files.entries())if(!keys(file,['path','sha256'])||file.path!==paths[i]||typeof file.sha256!=='string'||!HASH.test(file.sha256))throw fail('SOURCE_READY_RESPONSE_INVALID');
 if(prior)return false;
 return body.files.every((f,i)=>f.sha256===expected.files[i].sha256);
}
export async function waitForSourceRuntime({brainUrl,token,repoRoot,revision,timeoutMs=3600000,intervalMs=30000},
 {fetchFn=globalThis.fetch,readMain=async()=>execFileSync('gh',['api',`repos/${REPO}/commits/main`,'--jq','.sha'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim(),now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!token||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000||!Number.isInteger(intervalMs)||intervalMs<1||intervalMs>60000)throw fail('SOURCE_READY_INPUT_INVALID');
 let origin;try{origin=new URL(brainUrl);}catch{throw fail('SOURCE_READY_INPUT_INVALID');}
 if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw fail('SOURCE_READY_INPUT_INVALID');
 const deadline=now()+timeoutMs,expected=expectedSourceRuntime({repoRoot,revision});
 const checkDeadline=()=>{if(now()>=deadline)throw fail('SOURCE_READY_TIMEOUT');};
 const main=async()=>{checkDeadline();let actual;try{actual=await readMain();}catch{throw fail('SOURCE_READY_MAIN_UNAVAILABLE');}checkDeadline();if(actual!==revision)throw fail('SOURCE_READY_MAIN_MOVED');};
 let attempts=0;
 for(;;){
  await main();attempts++;let response,body;
  try{
   response=await fetchFn(new URL('/api/brain/implementation-ci/runtime-source',origin),{method:'GET',redirect:'error',headers:{'X-Internal-Token':token},signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-now())))});
   if(response.ok){const text=await response.text();if(text.length>65536)throw fail('SOURCE_READY_RESPONSE_INVALID');try{body=JSON.parse(text);}catch{throw fail('SOURCE_READY_RESPONSE_INVALID');}}
  }catch(error){
   if(error.code==='SOURCE_READY_RESPONSE_INVALID')throw error;
   if(!['TypeError','TimeoutError','AbortError'].includes(error.name))throw fail('SOURCE_READY_FETCH_ERROR');
   response=undefined;
  }
  checkDeadline();await main();
  if(response?.ok){
   if(validateResponse(body,expected))return {schema_version:1,status:'ready',repo:REPO,revision,files:expected.files,runtime_git_sha:body.git_sha,attempts};
  }else if(response&&![404,502,503,504].includes(response.status))throw fail('SOURCE_READY_HTTP_ERROR');
  checkDeadline();await sleep(Math.min(intervalMs,deadline-now()));
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const output='evidence/source-readiness';mkdirSync(output,{recursive:true});
 waitForSourceRuntime({brainUrl:process.env.BRAIN_URL,token:process.env.CECELIA_INTERNAL_TOKEN,repoRoot:process.env.TOOLING_ROOT||'tooling',revision:process.env.HEAD})
  .then(result=>{writeFileSync(join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write('SOURCE_RUNTIME_READY\n');})
  .catch(error=>{const code=error.code?.startsWith('SOURCE_READY_')?error.code:'SOURCE_READY_FAILED';writeFileSync(join(output,'failure.json'),JSON.stringify({status:'failed',code})+'\n');process.stderr.write(code+'\n');process.exitCode=1;});
}
