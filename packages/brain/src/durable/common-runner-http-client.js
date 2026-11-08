/** 产品DBOS协调器的真实Brain公共Runner API客户端；不生成身份或业务终态。 */
export function createBrainCommonRunnerClient({brainUrl,credential,fetchFn=fetch,allowLoopbackForTests=false}={}) {
 const fail=(reason,status=503)=>Object.assign(Error(reason),{status});
 let base;try{base=new URL(brainUrl);}catch{throw fail('common_runner_brain_target_invalid');}
 const host=base.hostname,octets=host.split('.'),tailnet=octets.length===4&&octets.every(x=>/^(0|[1-9][0-9]{0,2})$/.test(x)&&Number(x)<=255)&&Number(octets[0])===100&&Number(octets[1])>=64&&Number(octets[1])<=127;
 const local=['localhost','127.0.0.1'].includes(host),fixture=allowLoopbackForTests===true&&process.env.NODE_ENV==='test'&&host==='127.0.0.1';
 if(base.protocol!=='http:'||base.username||base.password||base.search||base.hash||base.pathname!=='/'||!((local||tailnet)&&base.port==='5221'||fixture&&Number(base.port)>0)||typeof credential!=='function')throw fail('common_runner_brain_target_invalid');
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 return Object.freeze({async dispatch(action,runId,body){
  if(!['start','inspect','cancel','flush'].includes(action)||!uuid.test(runId??'')||!body||Array.isArray(body)||!uuid.test(body.task_id??''))throw fail('common_runner_brain_request_invalid',400);
  const token=credential();if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw fail('common_runner_brain_credential_unavailable');
  const url=new URL(`/api/brain/common-runner/${runId}/${action}`,base);
  let response;try{response=await fetchFn(url,{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':token},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw fail('common_runner_brain_transport_unknown');}
  if(!response.ok)throw fail(`common_runner_brain_http_${response.status}`,response.status);
  try{let length=0;const chunks=[];for await(const chunk of response.body??[]){length+=chunk.length;if(length>524288)throw Error('oversized');chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid');return value;}catch{throw fail('common_runner_brain_response_unknown');}
 }});
}
