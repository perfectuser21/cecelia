import {qiumiEnv} from './env.js';
import {nativeAgentBody} from '../lib/native-agent-protocol.js';
import {loadRegistryPool,cheapGates} from './cheap-gates.js';
import {parseExecParams} from './exec-params.js';
import {loadNativeAgentSettings} from '../lib/native-agent-settings.js';
import {resolvePhone,currentAccountOf,unresolvedNote} from './phone-resolver.js';
export async function routeNativeQiumiTask(task,{pool,env={}}){
 const settings=loadNativeAgentSettings(env),routing=qiumiEnv(env);
 const registry=await loadRegistryPool((sql,args)=>pool.query(sql,args));
 let body;try{body=nativeAgentBody(task);}catch(error){return {outcome:'blocked',reason:error.message};}
 const params=parseExecParams(body,{nativeAgent:true});
 if(params.errors.length)return {outcome:'fail',reason:'native_agent_parameters_invalid',detail:params.errors.join(',')};
 const cheap=cheapGates(task,registry,{...env,departments:env.departments??routing.departments,deviceKeywords:env.deviceKeywords??routing.deviceKeywords});
 const deviceRequest=params.device??task.payload?.device_serial;
 const resolution=deviceRequest?resolvePhone('手机：'+deviceRequest,registry.phoneRows):cheap.phoneResolution;
 const phone=resolution?.status==='unique'?resolution.phone:null;
 if((deviceRequest||cheap.isDevice)&&!phone)return {outcome:'unresolved',reason:'device_unresolved',detail:{reason:'native_device_identity_required',requested:deviceRequest??null,candidates:resolution?.candidates??[]},note:unresolvedNote(registry.phoneRows)};
 const relations=task.payload?.qiumi_source?.agent_workflow_ids??[];
 if(relations.length&&!params.agent&&!cheap.department&&!cheap.agentRef)return {outcome:'blocked',reason:'native_agent_agent_binding_required'};
 const department=params.agent??cheap.department??cheap.agentRef??settings.default_department??'main';
 const hint=phone?{is_device:true,serial:phone.serial,host:phone.host??null,profile:phone.profile??null,account:currentAccountOf(phone),requested:deviceRequest??null}:null;
 return {outcome:'agent',department,kind:'agent',engine:'native-agent',model:params.model??null,payloadPatch:{
  provider:'native-agent',qiumi_department:department,qiumi_kind:'agent',
  ...(phone?{device_serial:phone.serial}:{}),
  qiumi_route:{source:'native-agent',device_hint:hint,decided_at:new Date().toISOString()},
  model:params.model??null,thinking:params.thinking??null,timeout_sec:params.timeoutSec??null,acceptance:params.acceptance??null,
 }};
}
