import protocol from '../../scripts/phone-ssh/protocol.cjs';
import transport from '../../scripts/phone-ssh/transport.cjs';
import {phoneSshValid,RECEIPT_BINDINGS} from './identity.js';
/** MMV侧固定SSH工具：endpoint和row必须来自服务端目录与store；Brain生产runtime不直用。 */
export function createPhoneSshClient({run=transport.runSsh}={}){
 return Object.freeze({async request(operation,row,endpoint){
  if(!phoneSshValid(endpoint)||row?.host!==endpoint.host)throw Error('phone_endpoint_invalid');
  const identity={dispatch_id:row.id,...Object.fromEntries(RECEIPT_BINDINGS.map(k=>[k,row[k]]))};
  const route={host:endpoint.host,user:endpoint.user,port:endpoint.port};
  const request=protocol.makeRequest(operation,identity,route);
  const result=await run('/usr/bin/ssh',transport.sshArgs(endpoint.hub,transport.HUB_COMMAND),JSON.stringify(request));
  const envelope=protocol.response(result,request,true);
  // authenticated只在本机完整验证两跳固定入口协议之后产生，wire上的同名字段无效。
  return {authenticated:true,receipt:envelope.receipt};
 }});
}
