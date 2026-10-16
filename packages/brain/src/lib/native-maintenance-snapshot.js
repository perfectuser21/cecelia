/** 只分类本系统v1维护观测；不授业务资格，不改历史版本或按current指针替换历史。 */
import {nativeSpec as spec,NATIVE_REPO,NATIVE_SPEC_PATH,NATIVE_SOURCE_PATHS} from './workflow-assembly-native-source.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
export const NATIVE_OBSERVATION_SCOPE='native_maintenance_observation';
const same=(a,b)=>{try{return definitionDigest(a)===definitionDigest(b);}catch{return false;}};
function sealed(row,kind,id,contract){
 return row?.[kind+'_id']===id&&row.source_repo===NATIVE_REPO&&row.source_path===NATIVE_SPEC_PATH
  &&/^[a-f0-9]{40}$/.test(row.source_commit??'')&&row.contract_sha256===definitionDigest(contract)
  &&row.payload_sha256===definitionDigest({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload});
}
function bindingsMatch(bindings,revision){
 return Array.isArray(bindings)&&bindings.length===NATIVE_SOURCE_PATHS.length
  &&new Set(bindings.map(b=>b?.path)).size===NATIVE_SOURCE_PATHS.length
  &&bindings.every(b=>b&&NATIVE_SOURCE_PATHS.includes(b.path)&&b.kind==='code'&&b.repo===NATIVE_REPO&&b.revision===revision
   &&/^[a-f0-9]{64}$/.test(b.content_sha256??'')&&b.digest==='sha256:'+b.content_sha256
   &&b.status==='verified'&&b.scope==='activity'&&b.validation_scope==='runtime_bytes');
}
export async function isNativeMaintenanceObservationDefinition(db,row){
 const p=row?.payload,a=spec.activities[0];
 if(!p||!sealed(row,'workflow',spec.id,spec)||p.protocol!==spec.protocol||p.key!==spec.key
  ||!same(p.contract,spec)||!Array.isArray(p.activities)||p.activities.length!==1)return false;
 const fixed=p.activities[0];
 if(!same(fixed,{reference_id:a.reference_id,slot_key:a.key,sequence_no:1,activity_id:a.id,activity_version_id:fixed?.activity_version_id})
  ||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(fixed?.activity_version_id??''))return false;
 const base={protocol:spec.protocol,workflow_id:spec.id,key:spec.key,contract:spec,activities:[fixed]};
 // 27590历史没有scope/capability字段；只接受这一完整旧shape，不原地补写旧payload。
 if(!same(p,base)&&!same(p,{...base,definition_scope:NATIVE_OBSERVATION_SCOPE,capability_id:spec.capability_id}))return false;
 const found=(await db.query(`SELECT row_to_json(w) AS workflow,row_to_json(c) AS capability,row_to_json(vs) AS stream,
  row_to_json(r) AS reference,row_to_json(a) AS activity,row_to_json(av) AS version
  FROM workflows w JOIN capabilities c ON c.id=w.capability_id JOIN value_streams vs ON vs.id=c.parent_journey_id
  JOIN workflow_activity_refs r ON r.id=$2 JOIN activities a ON a.id=r.activity_id
  JOIN activity_definition_versions av ON av.id=$3 WHERE w.id=$1`,[spec.id,a.reference_id,fixed.activity_version_id])).rows[0];
 if(!found)return false;
 const {workflow:w,capability:c,stream,reference:r,activity:activity,version:av}=found;
 if(w.key!==spec.key||w.capability_id!==spec.capability_id||w.source_repo!==NATIVE_REPO||w.source_path!==NATIVE_SPEC_PATH
  ||c.id!==spec.capability_id||c.parent_journey_id!=='2d22d890-dbab-441b-a602-2727de668aaf'
  ||stream.id!==c.parent_journey_id||stream.name!=='系统看护'||stream.parent_journey_id!==null
  ||!['系统看护 · 业务线健康巡检','系统看护·业务线健康巡检'].includes(c.name)
  ||r.workflow_id!==spec.id||r.activity_id!==a.id||r.slot_key!==a.key||r.sequence_no!==1
  ||r.source_repo!==NATIVE_REPO||r.source_path!==NATIVE_SPEC_PATH
  ||activity.id!==a.id||activity.workflow_id!==spec.id||activity.executor_kind!=='code'
  ||activity.capability_key!==spec.capability||activity.activity_key!==a.key||!same(activity.contract,a)
  ||!sealed(av,'activity',a.id,a)||av.source_commit!==row.source_commit)return false;
 const ap=av.payload;
 const expected={protocol:spec.protocol,activity_id:a.id,contract:a,steps:[],implementation_bindings:ap.implementation_bindings};
 return bindingsMatch(ap.implementation_bindings,row.source_commit)
  &&(same(ap,expected)||same(ap,{...expected,definition_scope:NATIVE_OBSERVATION_SCOPE,capability_id:spec.capability_id}));
}
