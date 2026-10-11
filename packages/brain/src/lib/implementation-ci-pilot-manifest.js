/** 既有试点来源接力及显式旧集合升级；保业务字段，经正式store CAS激活。 */
import {createRequire} from 'node:module';
import {submitMapManifest,activateMapManifest} from './map-manifest-store.js';
import { TREE_NODES_SQL } from './tree-nodes-sql.js';
const require=createRequire(import.meta.url);
const pilots=require('../../config/map-manifests/brain-pilot-bindings.json');
const conflict=()=>Object.assign(Error('试点规范映射或层级已变化，不能自动推进来源'),{code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED',status:409});
export async function preparePilotManifestAdvance(db,q){
  const spec=Object.values(pilots).find(p=>p.scope_key===q.scope);if(!spec)return null;
  if(spec.source_repo!==q.repo||!/^[0-9a-f]{40}$/.test(q.revision||''))throw conflict();
  const registrations=(await db.query('SELECT * FROM map_scope_repositories WHERE scope_key=$1',[q.scope])).rows;
  if(registrations.length!==1||registrations[0].repo!==spec.registry_repo||registrations[0].adapter_config?.source_repo!==q.repo)throw conflict();
  const active=(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key=$1 AND status='active'",[q.scope])).rows;
  if(active.length!==1)throw conflict();
  const row=active[0];
  const manifest=structuredClone(row.manifest),ids=[...spec.value_streams,...spec.capabilities].map(n=>n.entity_id);
  const entities=(await db.query(`SELECT id,parent_journey_id,capability_code FROM ${TREE_NODES_SQL} n WHERE id=ANY($1::uuid[])`,[ids])).rows;
  const fields=['value_streams','capabilities'];
  const exactKeys=(field,keys)=>Array.isArray(manifest[field])&&manifest[field].length===keys.length
    &&new Set(manifest[field].map(n=>n.key)).size===keys.length&&manifest[field].every(n=>keys.includes(n.key));
  const full=fields.every(field=>exactKeys(field,spec[field].map(n=>n.key)));
  const upgrade=!full&&spec.upgrade_from&&fields.every(field=>exactKeys(field,spec.upgrade_from[field]));
  if(!full&&!upgrade)throw conflict();
  let changed=!!upgrade;
  for(const [field,type] of [['value_streams','value_stream'],['capabilities','capability']]){
    for(const expected of spec[field]){
      let node=manifest[field].find(n=>n.key===expected.key);
      const entity=entities.find(e=>e.id===expected.entity_id);
      const parent=type==='capability'?spec.value_streams.find(v=>v.key===expected.value_stream_key)?.entity_id:null;
      if(!entity||entity.parent_journey_id!==parent||expected.canonical_code&&entity.capability_code!==expected.canonical_code)throw conflict();
      if(!node){
        if(!upgrade||spec.upgrade_from[field].includes(expected.key))throw conflict();
        const {entity_id,canonical_code:_code,...item}=expected;
        node={...item,brain_binding:{entity_type:type,entity_id,source_repo:q.repo,source_revision:q.revision}};
        manifest[field].push(node);
      }
      const b=node.brain_binding;
      if(!b||b.entity_id!==expected.entity_id||b.entity_type!==type||b.source_repo!==q.repo||!/^[0-9a-f]{40}$/.test(b.source_revision||'')
        ||type==='capability'&&node.value_stream_key!==expected.value_stream_key)throw conflict();
      changed ||= b.source_revision!==q.revision;b.source_revision=q.revision;
    }
  }
  return changed?{manifest,expectedActive:{id:row.id,digest:row.digest}}:null;
}
export async function advancePilotManifest(pool,plan,checkMain){
  if(!plan)return;
  await checkMain();
  const draft=await submitMapManifest(pool,plan.manifest);
  await activateMapManifest(pool,draft.manifest_version.id,{expectedActive:plan.expectedActive,beforeCommit:checkMain});
  await checkMain();
}
