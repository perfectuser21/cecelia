const isUUID=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const trusted=new WeakSet();
export const exactKeys=(value,required,optional=[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&required.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>required.includes(k)||optional.includes(k));
const text=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=256;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function freezeEvidence(value){if(value&&typeof value==='object'){Object.values(value).forEach(freezeEvidence);Object.freeze(value);}return value;}
export function phoneHubEndpointValid(value,machineId){
 if(!exactKeys(value,['http_endpoint','hub_id','hub_boot_id','hub_config_digest','hub_build_digest','physical']))return false;
 let url;try{url=new URL(value.http_endpoint);}catch{return false;}
 if(url.protocol!=='http:'||url.port!=='3459'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||url.href!==value.http_endpoint)return false;
 if(!text(value.hub_id)||!text(value.hub_boot_id)||!digest(value.hub_config_digest)||!digest(value.hub_build_digest))return false;
 const p=value.physical;
 return exactKeys(p,['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest'])&&
  ['machine_id','worker_id','physical_boot_id'].every(k=>text(p[k]))&&p.machine_id===machineId&&['config_digest','build_digest','action_digest'].every(k=>digest(p[k]));
}
export function isPhoneHubBinding(value){return trusted.has(value);}
/** Read-only historical version resolution: no current pointer or launch grant grants transport authority. */
export async function resolvePhoneHubBinding(db,input){
 if(!exactKeys(input,['executionVersionId','machineId'])||!isUUID(input.executionVersionId)||!text(input.machineId))throw Error('phone_http_binding_invalid');
 const {rows}=await db.query(`SELECT v.id,n.canonical_id,v.worker_id,v.worker_boot_id,v.endpoints FROM execution_node_versions v
  JOIN execution_nodes n USING(machine_registry_id) WHERE v.id=$1`,[input.executionVersionId]);
 const node=rows[0],endpoint=node?.endpoints?.phone_hub;
 if(rows.length!==1||node.id!==input.executionVersionId||node.canonical_id!==input.machineId||!phoneHubEndpointValid(endpoint,input.machineId)||endpoint.physical.worker_id!==node.worker_id||
  (node.worker_boot_id!==null&&endpoint.physical.physical_boot_id!==node.worker_boot_id))throw Error('phone_http_binding_unavailable');
 const binding=freezeEvidence({execution_version_id:node.id,...structuredClone(endpoint)});trusted.add(binding);return binding;
}
