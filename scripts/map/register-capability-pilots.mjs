#!/usr/bin/env node
/** 默认仅生成可审manifest；--apply明确执行正式登记/提交/激活API，不直写库。 */
import { readFileSync,writeFileSync,realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateMapManifest,digestMapManifest } from '../../packages/brain/src/lib/map-manifest-schema.js';
const pilots=JSON.parse(readFileSync(new URL('../../packages/brain/config/map-manifests/brain-pilot-bindings.json',import.meta.url),'utf8'));
export function buildPilotManifest(pilot,{revision,decision,baseManifest}={}){
  const spec=pilots[pilot];if(!spec||typeof revision!=='string'||!/^[0-9a-f]{40}$/.test(revision))throw Error('pilot与固定revision必填');
  if(spec.mode==='patch'&&baseManifest?.scope_key!==spec.scope_key)throw Error('必须提供该scope完整当前manifest，不能覆盖旧地图');
  const manifest=spec.mode==='patch'?structuredClone(baseManifest):{scope_key:spec.scope_key,schema_version:1,value_streams:[],capabilities:[],boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:'试点未登记共享前置项'}};
  manifest.source_decision_id=decision;
  for(const [field,type] of [['value_streams','value_stream'],['capabilities','capability']])for(const {entity_id,...item} of spec[field]){
    let node=manifest[field].find(n=>n.key===item.key);
    if(!node){if(spec.mode==='patch')throw Error(`既有节点不存在: ${item.key}`);node={...item};manifest[field].push(node);}
    if(node.brain_binding&&node.brain_binding.entity_id!==entity_id)throw Error(`既有规范绑定冲突: ${item.key}`);
    node.brain_binding={entity_type:type,entity_id,source_repo:spec.source_repo,source_revision:revision};
  }
  const result=validateMapManifest(manifest);if(!result.valid)throw Error(JSON.stringify(result.errors));return result.manifest;
}
async function main(){
  const args=process.argv.slice(2),opts={};
  for(let i=0;i<args.length;i++){if(args[i]==='--apply'){opts.apply=true;continue;}if(!['--pilot','--revision','--decision','--base-manifest','--output','--api-url'].includes(args[i])||!args[i+1])throw Error('无效参数');opts[args[i].slice(2)]=args[++i];}
  if(!opts.output)throw Error('--output必填，保留可审提交正文');
  const baseManifest=opts['base-manifest']?JSON.parse(readFileSync(opts['base-manifest'],'utf8')):null;
  const manifest=buildPilotManifest(opts.pilot,{...opts,baseManifest});writeFileSync(opts.output,JSON.stringify(manifest,null,2)+'\n');
  if(!opts.apply)return;
  const token=process.env.CECELIA_INTERNAL_TOKEN,base=opts['api-url'];
  if(!token||!base||!/^https?:\/\//.test(base))throw Error('正式应用必须显式api-url与内部token');
  const call=async(path,body)=>{
    const response=await fetch(`${base.replace(/\/$/,'')}/api/brain/${path}`,{method:body?'POST':'GET',headers:{'X-Internal-Token':token,'Content-Type':'application/json'},...(body&&{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
    const value=await response.json();if(!response.ok)throw Object.assign(Error(JSON.stringify(value)),{status:response.status});return value;
  };
  const spec=pilots[opts.pilot];
  if(spec.mode==='patch'){
    const active=await call(`map?scope=${encodeURIComponent(spec.scope_key)}`);
    if(active.manifest_digest!==digestMapManifest(baseManifest))throw Error('完整旧manifest已漂移，拒绝覆盖');
  }
  if(spec.mode==='create'){
    try{const active=await call(`map?scope=${encodeURIComponent(spec.scope_key)}`);if(active.manifest_digest!==digestMapManifest(manifest))throw Error('scope已有其他完整地图，拒绝以试点覆盖');}
    catch(error){if(error.status!==404)throw error;}
  }
  await call('implementation-ci/repositories',{scope_key:spec.scope_key,repo:spec.registry_repo,adapter_key:'legacy-ledger-v1',adapter_config:{source_repo:spec.source_repo}});
  const result=await call('map/manifests',manifest),id=result.manifest_version.id;
  await call(`map/manifests/${id}/activate`,{});
  process.stdout.write(JSON.stringify({scope:spec.scope_key,manifest_version_id:id,manifest_digest:digestMapManifest(manifest)})+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1]))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
