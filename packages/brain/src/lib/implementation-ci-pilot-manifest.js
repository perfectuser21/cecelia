/** 仅既有两个试点的来源锚点接力；保留完整业务字段，经正式store CAS激活。 */
import {readFileSync} from 'node:fs';
import {submitMapManifest,activateMapManifest} from './map-manifest-store.js';
const pilots=JSON.parse(readFileSync(new URL('../../config/map-manifests/brain-pilot-bindings.json',import.meta.url),'utf8'));
const conflict=()=>Object.assign(Error('试点规范映射或层级已变化，不能自动推进来源'),{code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED',status:409});
export async function preparePilotManifestAdvance(db,q){
  const spec=Object.values(pilots).find(p=>p.scope_key===q.scope);if(!spec)return null;
  if(spec.source_repo!==q.repo)throw conflict();
  const registrations=(await db.query('SELECT * FROM map_scope_repositories WHERE scope_key=$1',[q.scope])).rows;
  if(registrations.length!==1||registrations[0].repo!==spec.registry_repo||registrations[0].adapter_config?.source_repo!==q.repo)throw conflict();
  const row=(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key=$1 AND status='active'",[q.scope])).rows[0];
  if(!row)throw conflict();
  const manifest=structuredClone(row.manifest),ids=[...spec.value_streams,...spec.capabilities].map(n=>n.entity_id);
  const entities=(await db.query('SELECT id,parent_journey_id FROM journeys WHERE id=ANY($1::uuid[])',[ids])).rows;
  let changed=false;
  for(const [field,type] of [['value_streams','value_stream'],['capabilities','capability']]){
    if(manifest[field]?.length!==spec[field].length)throw conflict();
    for(const expected of spec[field]){
      const node=manifest[field].find(n=>n.key===expected.key),b=node?.brain_binding,entity=entities.find(e=>e.id===expected.entity_id);
      const parent=type==='capability'?spec.value_streams.find(v=>v.key===expected.value_stream_key)?.entity_id:null;
      if(!b||b.entity_id!==expected.entity_id||b.entity_type!==type||b.source_repo!==q.repo||!entity||entity.parent_journey_id!==parent
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
