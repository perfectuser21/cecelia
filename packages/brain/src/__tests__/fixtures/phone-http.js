import {randomUUID,createHmac} from 'node:crypto';
import http from 'node:http';
import {vi,expect} from 'vitest';
export const token='fixture-phone-http-private-'.repeat(3);
export const hash='a'.repeat(64);
export const endpoint=()=>({http_endpoint:'http://127.0.0.1:3459/',hub_id:'fixture-hub',hub_boot_id:'fixture-hub-boot',hub_config_digest:hash,hub_build_digest:hash,
 physical:{machine_id:'fixture-machine',worker_id:'fixture-worker',physical_boot_id:'fixture-physical-boot',config_digest:'c'.repeat(64),build_digest:'d'.repeat(64),action_digest:'e'.repeat(64)}});
export const node=()=>({id:randomUUID(),canonical_id:'fixture-machine',worker_id:'fixture-worker',worker_boot_id:'fixture-physical-boot',endpoints:{phone_hub:endpoint()}});
export const maintenance=()=>({pending:0,in_flight:0,activity_revision:0,draining:false,stable:true,quiescent:false,marker_identity:null});
export const physical=()=>({schema:'phone-physical-probe/v1',request_nonce:randomUUID(),...endpoint().physical,action:'adb_get_state',
 resources:{cpu_count:4,memory_total_bytes:8000000000,memory_free_bytes:1000000000,load_1m:0.2,data_free_bytes:1000000000},adb_daemon:{reachable:true},external_locks:{occupied:0},maintenance:{...maintenance(),journal_pending:0,external_occupied:0},observed_at:new Date().toISOString()});
export function wire(operation,nonce){
 const e=endpoint();
 return {...(operation==='capabilities'?physical():{proof_scope:'hub-control',hub_control:maintenance(),targets:[{machine_id:e.physical.machine_id,status:'verified',...maintenance()}],pending:0,stable:false,quiescent:false}),
  schema:operation==='capabilities'?'phone-capabilities/v1':'phone-maintenance/v1',scope:'phone-hub',hub_id:e.hub_id,boot_id:e.hub_boot_id,build_digest:e.hub_build_digest,config_digest:e.hub_config_digest,http_endpoint:e.http_endpoint,
  ...(operation==='capabilities'?{physical_config_digest:e.physical.config_digest,physical_build_digest:e.physical.build_digest,physical_observed_at:new Date().toISOString()}:{}),
  hub_process_identity:{pid:123,boot_id:e.hub_boot_id,start_time:'fixture-process-start',pgid:123,state:'S'},execution:false,request_nonce:nonce,observed_at:new Date().toISOString()};
}
export const signed=receipt=>({receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')});
export async function serverFixture(handler,run){
 const server=http.createServer(handler);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 // Only the private test TCP port is mapped: real native HTTP, persisted URL and all protocol bytes remain exercised.
 const nativeRequest=http.request;
 const mapping=vi.spyOn(http,'request').mockImplementation((url,options,callback)=>{
  expect(url.hostname).toBe('127.0.0.1');expect(url.port).toBe('3459');
  const privateUrl=new URL(url);privateUrl.port=String(server.address().port);return nativeRequest(privateUrl,options,callback);
 });
 try{await run(server);}finally{mapping.mockRestore();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
