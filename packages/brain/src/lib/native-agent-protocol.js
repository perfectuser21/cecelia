import {createHash,randomUUID} from 'node:crypto';
import {loadNativeAgentSettings} from './native-agent-settings.js';
import {parseExecParams,requestedAiAccount} from '../routing/exec-params.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export const NATIVE_COMMON_KEYS=['tenant','department','role','account_ref','task_id','run_id','request_nonce','input_digest'];
const reject=reason=>{throw Error(reason);};
const text=(value,reason)=>typeof value==='string'&&value.trim()?value.trim():reject(reason);
export function nativeAgentBody(task){
 const source=task.payload?.qiumi_source??{},proof=task.payload?.native_agent_content;
 if(proof?.protocol!=='notion-complete-body/v1'||proof.complete!==true||typeof proof.empty_body!=='boolean'||!Array.isArray(proof.page_ids)||!proof.page_ids.length||typeof source.body!=='string'||proof.empty_body!==!source.body.trim())reject('native_agent_body_incomplete');
 return source.body.trim()?source.body:text(source.title??task.title,'native_agent_body_required');
}
export function nativeAgentStartRequest(task,now=Date.now(),env=process.env){
 const settings=loadNativeAgentSettings(env);
 const p=task.payload??{},s=p.qiumi_source??{},body=nativeAgentBody(task);
 const accounts=requestedAiAccount(body);
 if(accounts&&(accounts.length!==1||!accounts[0]||accounts[0].length>256))reject('native_agent_account_required');
 const account=accounts?.[0]??settings.default_account_ref;
 if(!account)reject('native_agent_account_required');
 const params=parseExecParams(body,{nativeAgent:true});
 if(params.errors.length)reject('native_agent_parameters_invalid');
 // 默认只来自部署配置，旧Jev/ModelMap的推断不能冒充用户显式要求。
 const model=text(params.model??settings.default_model,'native_agent_model_required');
 const thinking=params.thinking??settings.default_thinking;
 if(typeof thinking!=='string'||!['off','minimal','low','medium','high','xhigh','adaptive','max'].includes(thinking))reject('native_agent_thinking_required');
 const seconds=params.timeoutSec??Number(settings.default_timeout_sec);
 if(!Number.isInteger(seconds)||seconds<60||seconds>10800)reject('native_agent_timeout_required');
 const skillIds=s.skill_ids??[];
 if(!Array.isArray(skillIds)||skillIds.some(x=>typeof x!=='string'||!x.trim()))reject('native_agent_skills_invalid');
 const explicit=[...body.matchAll(/^\s*(?:调用\s*Skill|Skill|技能)\s*[：:]\s*([^\r\n]+)/gim)].map(m=>m[1].trim());
 const skill_ids=[...new Set(skillIds.length?skillIds:explicit)];
 const source={task_id:task.id,title:s.title??task.title,remark:s.remark??'',channel:s.channel??null,agent_workflow_ids:s.agent_workflow_ids??[],notion_page_id:p.notion_page_id??null,
  notion_zh_page_id:p.notion_zh_page_id??null,device:p.qiumi_route?.device_hint??null,acceptance:p.acceptance??params.acceptance??null};
 // 原正文是连续后缀；不能改用description的2000字投影或摘掉账号/权限/输入区块。
 const prompt='本Task已由Brain登记，你是本任务执行者。不要重建同一Task、二次派回OpenClaw或自行修改Notion/Task终态；返回真实事实与证据，由Brain收账。\nBrain任务来源与已绑定约束：\n'+JSON.stringify(source)+'\n\n'+body;
 return {protocol:'native-agent/v1',action:'start',tenant:text(task.tenant_id??p.tenant_id,'native_agent_tenant_required'),
  department:text(params.agent??(p.qiumi_route?.source==='native-agent'?p.qiumi_department:null)??settings.default_department??'main','native_agent_department_required'),role:text(settings.default_role??'agent','native_agent_role_required'),
  account_ref:account,task_id:task.id,run_id:randomUUID(),request_nonce:randomUUID(),input_digest:hash(prompt),
  prompt,model,thinking,skill_ids,timeout_ms:seconds*1000,deadline_ms:now+seconds*1000};
}
export function nativeAgentOperation(binding,action){
 return {protocol:'native-agent/v1',action,...Object.fromEntries(NATIVE_COMMON_KEYS.map(k=>[k,binding.request[k]]))};
}
export function nativeAgentReceipt(binding,value){
 const request=binding.request;
 if(!value||value.protocol!=='native-agent/v1'||NATIVE_COMMON_KEYS.some(k=>value[k]!==request[k]))reject('native_agent_receipt_identity');
 if(value.status==='rejected'&&value.launch_state==='not_started'){if(value.execution_stopped!==true)reject('native_agent_stop_unconfirmed');return value;}
 for(const key of ['model','thinking','skill_ids','timeout_ms','deadline_ms'])if(JSON.stringify(value[key])!==JSON.stringify(request[key]))reject('native_agent_receipt_parameters');
 if(value.frozen?.source_digest!==binding.host?.bundle_sha256)reject('native_agent_receipt_source');
 const keys=['config_digest','profile_digest','command_digest','skills_digest','source_digest','auth_identity_sha256','stdin_digest','codex_config_sha256','permissions_digest'];
 if(!value.frozen||keys.some(k=>!/^([a-f0-9]{64})$/.test(value.frozen[k]??'')))reject('native_agent_receipt_frozen');
 if(typeof value.frozen.codex_config_present!=='boolean')reject('native_agent_receipt_frozen');
 if(binding.actual_cli_model&&binding.actual_cli_model!==value.actual_cli_model)reject('native_agent_receipt_parameters');
 if(typeof value.actual_cli_model!=='string'||!value.actual_cli_model)reject('native_agent_receipt_parameters');
 if(binding.frozen&&Object.keys(binding.frozen).some(k=>binding.frozen[k]!==value.frozen[k]))reject('native_agent_receipt_profile_changed');
 if(!['running','completed','failed','timed_out','cancelled','unknown'].includes(value.status))reject('native_agent_receipt_state');
 if(['completed','failed','timed_out','cancelled'].includes(value.status)){
  if(value.launch_state!=='stopped'||value.execution_stopped!==true||value.result?.child_exited!==true)reject('native_agent_stop_unconfirmed');
  if(value.status==='completed'&&value.result.exit_code!==0)reject('native_agent_exit_mismatch');
  if(value.status==='cancelled'&&value.termination_scope!=='known_process_group')reject('native_agent_cancel_unconfirmed');
 }
 return value;
}
