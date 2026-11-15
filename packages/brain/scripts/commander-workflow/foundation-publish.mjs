#!/usr/bin/env node
// CD最后一步：验证已安装组件，复用发布/观测账，再读回可派目录。不会创建业务任务。
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const fail=code=>{throw Error(`foundation_publish_${code}`);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const ordered=components=>components.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function publicationEndpoint(base){
 let u;try{u=new URL(base);}catch{fail('endpoint_invalid');}
 if(u.username||u.password||u.search||u.hash||!u.pathname.replace(/\/$/,'').endsWith('/api/brain')
  ||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))fail('endpoint_invalid');
 return u.href.replace(/\/$/,'');
}
function componentFile(root,c){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.repo??'')||c.repo.split('/').some(p=>['.','..'].includes(p))
  ||!/^[a-f0-9]{40}$/.test(c.revision??'')||typeof c.path!=='string'||path.isAbsolute(c.path)||c.path.includes('\\')||c.path.includes('\0')
  ||c.path.split('/').some(p=>!p||p==='.'||p==='..'))fail('component_path_invalid');
 let current=root;
 for(const part of [...c.repo.split('/'),c.revision,...c.path.split('/')]){
  current=path.join(current,part);if(!fs.existsSync(current)||fs.lstatSync(current).isSymbolicLink())fail('component_path_invalid');
 }
 const st=fs.statSync(current);if(!st.isFile()||st.size>8*1024*1024||!fs.realpathSync(current).startsWith(root+path.sep))fail('component_path_invalid');
 return current;
}
export function verifyInstalledComponents(components,bundleRoot){
 if(!path.isAbsolute(bundleRoot??'')||!fs.existsSync(bundleRoot)||fs.lstatSync(bundleRoot).isSymbolicLink())fail('bundle_root_invalid');
 const root=fs.realpathSync(bundleRoot);
 if(!Array.isArray(components)||!components.length||components.length>10000)fail('components_invalid');
 let count=0,total=0;const seen=new Set();
 for(const c of components){
  if(c.kind==='repo')continue;
  if(!['code','skill'].includes(c.kind)||!/^sha256:[a-f0-9]{64}$/.test(c.digest??''))fail('components_invalid');
  const file=componentFile(root,c);if(seen.has(file))fail('component_duplicate');seen.add(file);
  const bytes=fs.readFileSync(file);total+=bytes.length;if(total>64*1024*1024)fail('components_oversized');
  if('sha256:'+hash(bytes)!==c.digest)fail('component_drift');count++;
 }
 if(!count)fail('components_empty');
 return {verified_files:count};
}
function deploymentObservation(plan,{statePath,machineId,bundleRoot}){
 const identity=hash(JSON.stringify(canonical({plan,machineId,bundleRoot:fs.realpathSync(bundleRoot)})));
 if(statePath&&fs.existsSync(statePath)){
  if(fs.lstatSync(statePath).isSymbolicLink()||!fs.statSync(statePath).isFile())fail('deployment_state_invalid');
  const saved=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(saved.identity!==identity||saved.observation_sha256!==hash(JSON.stringify(canonical(saved.observation))))fail('deployment_state_conflict');
  return saved.observation;
 }
 const attempt=randomUUID(),observation={...plan.observation,event_key:'foundation:'+attempt,attempt_key:'foundation-deploy:'+attempt,observed_at:new Date().toISOString()};
 if(statePath){
  const saved={identity,observation,observation_sha256:hash(JSON.stringify(canonical(observation)))};
  const fd=fs.openSync(statePath,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(saved)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 return observation;
}
export async function publishFoundation(plan,{bundleRoot,base=process.env.CECELIA_API_BASE_URL,token=process.env.CECELIA_INTERNAL_TOKEN,machineId=process.env.FOUNDATION_MACHINE_ID,statePath,fetch:fetchFn=globalThis.fetch}={}){
 base=publicationEndpoint(base);
 if(!plan?.release||!plan.observation||Object.keys(plan).some(k=>!['release','observation'].includes(k)))fail('plan_invalid');
 if(typeof machineId!=='string'||!machineId||typeof plan.release.target!=='string'||!plan.release.target.startsWith(machineId+'/')||!/^[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+$/.test(plan.release.target))fail('deployment_machine_mismatch');
 const installed=verifyInstalledComponents(plan.release.components,bundleRoot);
 if(JSON.stringify(ordered(plan.release.components))!==JSON.stringify(ordered(plan.observation.components??[]))
  ||plan.release.environment!==plan.observation.environment||plan.release.target!==plan.observation.target)fail('observation_components_mismatch');
 const call=async(route,body)=>{
  const response=await fetchFn(base+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(60000),
   headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)fail(`http_${response.status}`);return response.json();
 };
 const {release}=await call('/releases',plan.release);
 if(!release?.id||release.payload?.verification?.status!=='verified')fail('ci_unverified');
 const observed=deploymentObservation(plan,{statePath,machineId,bundleRoot});
 const {observation}=await call(`/releases/${encodeURIComponent(release.id)}/observations`,observed);
 const gate=await call(`/releases/${encodeURIComponent(release.id)}/gate`);
 if(gate.deployed!==true||!observation?.id||gate.current_observation_id!==observation.id)fail('deployment_unverified');
 const {workflows}=await call('/workflow-foundation/catalog');
 const published=release.payload.workflows;
 if(!Array.isArray(published)||!published.length||!Array.isArray(workflows))fail('catalog_unavailable');
 const ready=published.map(w=>workflows.find(row=>row.workflow_id===w.workflow_id&&row.workflow_definition_version_id===w.id&&row.release_id===release.id&&row.status==='ready'));
 if(ready.some(w=>!w))fail('catalog_unavailable');
 return {status:'ready',release_id:release.id,observation_id:observation.id,...installed,
  workflows:ready.map(({workflow_id,workflow_definition_version_id,release_id})=>({workflow_id,workflow_definition_version_id,release_id})),started_tasks:0};
}
export async function main(args){
 if(args.length!==6||args[0]!=='--plan'||args[2]!=='--bundle-root'||args[4]!=='--result')fail('usage_plan_bundle_root_result');
 const input=fs.readFileSync(args[1]);if(input.length>4*1024*1024)fail('plan_oversized');
 const target=path.resolve(args[5]),tmp=target+'.'+process.pid+'.tmp';
 const result=await publishFoundation(JSON.parse(input),{bundleRoot:path.resolve(args[3]),statePath:target+'.deployment.json'});
 try{fs.writeFileSync(tmp,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,target);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv.slice(2)).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
}
