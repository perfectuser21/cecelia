import {createRequire} from 'node:module';
import {createPhoneHttpClient} from '../../phone-dispatch/http-client.js';
import {token,physical,maintenance,serverFixture} from './phone-http.js';
export async function observation(binding,patch={}){
 const {createPhoneHubServer}=createRequire(import.meta.url)('../../../scripts/phone-hub/service.cjs');
 const hub=createPhoneHubServer({token,identity:{hub_id:binding.hub_id,boot_id:binding.hub_boot_id,build_digest:binding.hub_build_digest,config_digest:binding.hub_config_digest,http_endpoint:binding.http_endpoint,hub_process_identity:{pid:123,boot_id:binding.hub_boot_id,start_time:'fixture-start',pgid:123,state:'S'}},
  capabilities:async()=>({...physical(),...binding.physical,resources:{...physical().resources,data_free_bytes:5*1024**3},...patch}),
  maintenance:async()=>({proof_scope:'hub-control',hub_control:maintenance(),targets:[{machine_id:binding.physical.machine_id,status:'verified',...maintenance()}],pending:0,stable:false,quiescent:false})});
 let result;await serverFixture((req,res)=>hub.emit('request',req,res),async()=>{result=await createPhoneHttpClient({token}).capabilities(binding);});return result;
}
