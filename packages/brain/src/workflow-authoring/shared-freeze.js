import yaml from 'js-yaml';
import {definitionDigest} from './contracts.js';
import {validateImplementationBindings} from '../lib/implementation-bindings.js';
const fail=()=>{throw Object.assign(Error('共享活动固定版本、合同或来源不匹配'),{code:'activity_revision_conflict',status:409});};
export async function prepareSharedFreeze(slot,versions,read){
 const version=versions?.find(v=>v.id===slot.reuse_activity_definition_version_id);
 if(!version||version.activity_id!==slot.reuse_activity_id||version.payload?.activity_id!==slot.reuse_activity_id
  ||version.contract_sha256!==slot.reuse_contract_sha256||definitionDigest(version.payload.contract)!==version.contract_sha256)fail();
 const source={repo:version.source_repo,path:version.source_path,revision:version.source_commit};
 let doc;try{doc=yaml.load(await read(source));}catch{fail();}
 const contract=version.payload.contract,{workflow_authoring:meta,...bare}=contract;
 const declared=doc?.activities?.filter(a=>a.key===contract.key)??[];
 if(declared.length!==1||definitionDigest(declared[0])!==definitionDigest(bare))fail();
 if(meta&&(doc.key!==meta.workflow_key||definitionDigest(doc.runtime)!==definitionDigest(meta.runtime)
  ||meta.source?.repo!==source.repo||meta.source?.ref!==source.path||meta.source?.revision!==source.revision))fail();
 const fixed={repo:source.repo,path:source.path,commit:source.revision};
 const bindings=await validateImplementationBindings(contract,read,fixed);
 if(!bindings.length||bindings.some(b=>b.status!=='verified')||definitionDigest(bindings)!==definitionDigest(version.payload.implementation_bindings))fail();
 return {version,bindings};
}
