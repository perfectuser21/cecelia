/** 任务事实的只读机器区：白名单取数，保留页面上的人工备注。 */
import {syncManagedBodyBlock} from './workflow-body.js';
export const TASK_PROGRESS_MARKER='🤖 任务进度（机器维护';
const rich=value=>(String(value).slice(0,16000).match(/[\s\S]{1,1900}/g)||['']).map(content=>({type:'text',text:{content}}));
const text=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
export const TASK_PROGRESS_FIELDS=['summary','phase','status','facts','evidence','actor','pr_url','branch','commit','sha','version',
 'url','title','kind','next_step','next_steps','handoff','completed','remaining','validation','tests','deployment','implementation','done','not_done','verdict','scope','artifacts','detail','task_id','project_id','pr_urls','run_urls','docs','data_sources','already_registered',
 'pr','pilot_run','l4_e2e_run','merged_sha','candidate_run','smoke_glob_run','production_readback','recorded_at','completion_state'];
const allowed=new Set(TASK_PROGRESS_FIELDS);
function safe(value,depth=0){
 if(depth>5||value==null)return undefined;
 if(typeof value==='string')return value.slice(0,12000);
 if(typeof value==='number'||typeof value==='boolean')return value;
 if(Array.isArray(value))return value.slice(0,40).map(v=>safe(v,depth+1)).filter(v=>v!==undefined);
 if(typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>allowed.has(key)).map(([key,v])=>[key,safe(v,depth+1)]).filter(([,v])=>v!==undefined));
}
/** 支持一层业务包装；仅提取已知字段，包装名及私密字段不输出。 */
export function normalizeTaskProgress(result){
 if(typeof result==='string'){try{result=JSON.parse(result);}catch{return {summary:result.slice(0,12000)};}}
 if(!result||typeof result!=='object'||Array.isArray(result))return {};
 const normalized=safe(result)||{};
 const wrapped=Object.entries(result).filter(([key,v])=>!allowed.has(key)&&v&&typeof v==='object'&&!Array.isArray(v))
  .map(([,v])=>safe(v)).filter(v=>v&&Object.keys(v).length).slice(0,20);
 if(wrapped.length)normalized.updates=wrapped;
 return normalized;
}
export function buildTaskProgressBlock(task){
 const result=normalizeTaskProgress(task.result);
 const sections=[['原始目标',task.description||task.title],['当前状态',task.status],['进度与交接',Object.keys(result).length?result:'暂无进度回执']];
 return {object:'block',type:'toggle',toggle:{rich_text:rich(`${TASK_PROGRESS_MARKER}：改事实请改 Brain）`),
  children:sections.flatMap(([label,value])=>[{object:'block',type:'heading_3',heading_3:{rich_text:rich(label)}},
   {object:'block',type:'paragraph',paragraph:{rich_text:rich(text(value))}}])}};
}

export const syncTaskProgress=(token,pageId,task,request)=>syncManagedBodyBlock(token,pageId,buildTaskProgressBlock(task),request,TASK_PROGRESS_MARKER);

/** create 已成功但本地写回丢失时按稳定身份找回，禁止再建重复页。 */
export async function findCreatedTaskPage(token,dbId,taskId,request){
 const data=await request(token,`/databases/${dbId}/query`,'POST',{
  filter:{property:'Description',rich_text:{contains:`brain:${taskId}`}},page_size:100,
 });
 if(!Array.isArray(data?.results)||data.has_more)throw Error('任务页身份查询不完整');
 const pages=data.results.filter(page=>(page.properties?.Description?.rich_text||[])
  .map(t=>t.plain_text??t.text?.content??'').join('').includes(`brain:${taskId}`));
 if(pages.length>1)throw Error('任务页稳定身份重复，拒绝覆盖');
 return pages[0]||null;
}
