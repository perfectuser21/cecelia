/** 固定部署/main/Git对象与实际加载字节一致才产生一次性非执行登记来源。 */
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFixedGitFile,createFixedGitReadSession} from '../workflow-authoring/fixed-git-source.js';
import {resolveGitHubToken} from '../harness-credentials.js';
import {buildInfraConsumerSources,INFRA_CONSUMER_PATHS} from './infra-consumer-source.js';
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),repo='perfectuser21/cecelia';
const paths=['packages/brain/src/routes/implementation-ci.js',...['infra-registry-bootstrap.js','infra-bootstrap-source.js','infra-consumer-source.js','consumer-evidence-store.js'].map(p=>'packages/brain/src/lib/'+p),'packages/brain/src/workflow-authoring/fixed-git-source.js','packages/brain/scripts/sync-steps-from-workspace.mjs','packages/brain/src/middleware/internal-auth.js'];
const loaded=new Map(paths.map(p=>{const url=new URL('../../'+p.slice('packages/brain/'.length),import.meta.url);if(!lstatSync(url).isFile()||lstatSync(url).isSymbolicLink())throw Error('infra_bootstrap_runtime_not_regular');return [p,readFileSync(url,'utf8')];}));
const sources=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
const revision=()=>process.env.GIT_SHA??execFileSync('git',['--no-replace-objects','rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:5000}).trim();
export async function prepareInfraBootstrapSource(input,options={}){
 const actual=options.revision??revision(),deadline=Date.now()+30000;
 if(!/^[a-f0-9]{40}$/.test(actual)||input.revision!==actual)fail('INFRA_BOOTSTRAP_DEPLOYMENT_MISMATCH');
 const checkDeadline=()=>{if(Date.now()>=deadline)fail('INFRA_BOOTSTRAP_SOURCE_DEADLINE');};
 const token=options.checkMain?null:await resolveGitHubToken();
 const checkMain=options.checkMain??(async rev=>{
  const res=await fetch(`https://api.github.com/repos/${repo}/commits/main`,{redirect:'error',headers:{Accept:'application/vnd.github.sha',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-Date.now())))});
  if(!res.ok||(await res.text()).trim()!==rev)fail('INFRA_BOOTSTRAP_MAIN_MISMATCH');
 });
 const check=async()=>{checkDeadline();await checkMain(actual);checkDeadline();};await check();
 const gitSession=createFixedGitReadSession();
 const read=options.readFile??((rev,path)=>readFixedGitFile({repo,path,revision:rev},{gitSession,deadline,resolveToken:async()=>token}));
 const bindings=[];
 for(const path of paths){checkDeadline();const bytes=await read(actual,path);checkDeadline();if(bytes!==loaded.get(path))fail('INFRA_BOOTSTRAP_RUNTIME_MISMATCH');bindings.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});}
 const proof=await buildInfraConsumerSources({scope:'cecelia-infra',repo,revision:actual,paths:[...INFRA_CONSUMER_PATHS],readSource:path=>read(actual,path)});
 await check();const cap=Object.freeze({});
 sources.set(cap,{request_sha256:stepSha256(input),source:{repo,revision:actual,sha256:stepSha256({bindings,proof})},check});return cap;
}
export function consumeInfraBootstrapSource(cap,input){
 const prepared=sources.get(cap);sources.delete(cap);
 if(!prepared||prepared.request_sha256!==stepSha256(input))fail('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');return prepared;
}
