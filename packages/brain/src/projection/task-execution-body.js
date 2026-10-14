/** Task机器执行目录；不读写人工调度列，不从当前任务结果补历史Run。 */
import {randomUUID} from 'node:crypto';
import {syncManagedBodyBlock} from './workflow-body.js';
import {notionReq as defaultNotionReq} from '../recurring-notion-sync.js';
export const TASK_EXECUTION_MARKER='🤖 执行回链（机器维护';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const compact=x=>String(x??'').replaceAll('-','').toLowerCase();
export function taskPageIdentity(page,id){
 const content=p=>(p?.rich_text||[]).map(x=>x.plain_text??x.text?.content??'').join('');
 const brain=content(page.properties?.['Brain ID']),description=content(page.properties?.Description);
 const matches=[...description.matchAll(/(?:^|[\s·])brain:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?=$|[\s·])/gi)].map(m=>m[1]);
 if(page.properties?.['Brain ID']&&brain!==id)return false;
 if(/brain:/i.test(description)&&(matches.length!==1||matches[0]!==id))return false;
 return brain===id||matches.length===1&&matches[0]===id;
}
function connectBefore(pool,deadline){
 return new Promise((resolve,reject)=>{let expired=false;const timer=setTimeout(()=>{expired=true;reject(Error('Task执行正文连接预算耗尽'));},Math.max(1,deadline-Date.now()));
  Promise.resolve(pool.connect()).then(c=>{clearTimeout(timer);if(expired)c.release();else resolve(c);},e=>{clearTimeout(timer);reject(e);});});
}
const marker=id=>`${TASK_EXECUTION_MARKER}·任务 ${id}）`;
const text=s=>({type:'text',text:{content:String(s).slice(0,1900)}});
const link=(s,id)=>({type:'text',text:{content:String(s).slice(0,1900),link:{url:`https://app.notion.com/p/${compact(id)}`}}});
const paragraphs=parts=>Array.from({length:Math.ceil(parts.length/20)},(_,i)=>({object:'block',type:'paragraph',paragraph:{rich_text:parts.slice(i*20,i*20+20)}}));
export function buildTaskExecutionBlock({task,workflows=[],runs=[],totalRuns=0}){
 const wf=workflows.length?workflows.map((w,i)=>w.notion_id?link(`${i?'\n':''}${w.name||w.id}`,w.notion_id):text(`${i?'\n':''}${w.name||w.id}（未投影）`)):[text('流程归属未知')];
 const records=runs.length?runs.flatMap(r=>[r.notion_id?link(r.run_id,r.notion_id):text(`${r.run_id}（未投影）`),text(` · ${r.status||'未知'} · ${r.started_at||'时间未知'} · 流程 ${r.workflow_id||'归属未知'}\n`)]):[text('暂无运行记录')];
 const omitted=Math.max(0,totalRuns-runs.length);
 return{object:'block',type:'toggle',toggle:{rich_text:[text(marker(task.id)+'：真实流程与每次运行')],children:[...paragraphs([text('任务声明/实际Run关联流程（各Run归属见记录）')]),...paragraphs(wf),...paragraphs([text('真实运行记录（按最近开始时间排序；每条为独立attempt）')]),...paragraphs(records),...paragraphs([text(`共 ${totalRuns} 次运行；展示最近 ${runs.length} 次；另 ${omitted} 次未展示。${omitted?'更早记录请在 Runs 库按 Task 关系查看。':''}`)])]}};
}
const PENDING_PREFIX='task_execution_body_pending:';
async function metadataOn(client,sql,args,deadline){
 const remaining=deadline-Date.now();if(remaining<=0)throw Error('Task执行正文元数据预算耗尽');
 await client.query('BEGIN');
 try{await client.query("SELECT set_config('statement_timeout',$1,true)",[String(Math.min(3000,remaining))]);const result=await client.query(sql,args);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
async function metadata(pool,sql,args,deadline){
 const c=await connectBefore(pool,deadline);try{return await metadataOn(c,sql,args,deadline);}finally{c.release();}
}
/** 原子登记重试意图；只写投影metadata，不改任务业务状态/更新时间。 */
export async function queueTaskExecutionBodies(pool,taskIds,deadline){
 const ids=[...new Set(taskIds)].filter(uuid);if(!ids.length)return;
 const entries=Object.fromEntries(ids.map(id=>[id,{task_id:id,nonce:randomUUID()}]));
 await metadata(pool,`INSERT INTO working_memory(key,value_json,updated_at)
  SELECT $2||entry.key,entry.value,NOW() FROM jsonb_each($1::jsonb) entry
  ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json`,[JSON.stringify(entries),PENDING_PREFIX],deadline);
}
/** 正式血管周期消费最多10项；同Task锁、共享deadline及成功nonce CAS。 */
export async function syncTaskExecutionBodies(pool,{token,notionReq=defaultNotionReq,taskIds=[],taskDbId,deadline=Date.now()+8000}={}){
 const stat={synced:0,pending:0,failed:0,skipped:0,errors:[],completedTaskIds:[]};
 if(Date.now()>=deadline)return{...stat,pending:new Set(taskIds).size};
 if(!token||!uuid(taskDbId))return{...stat,pending:new Set(taskIds).size};
 let pending;
 try{await queueTaskExecutionBodies(pool,taskIds,deadline);pending=(await metadata(pool,"SELECT key,value_json FROM working_memory WHERE starts_with(key,$1) ORDER BY updated_at,key LIMIT 10",[PENDING_PREFIX],deadline)).rows;}
 catch(e){return{...stat,failed:1,errors:[{error:e.message}]};}
 for(let index=0;index<pending.length;index++){
  const entry=pending[index],id=entry.value_json?.task_id;
  if(Date.now()>=deadline-100){stat.pending+=pending.length-index;break;}
  let c,locked=false,transaction=false,complete=false;
  try{
   if(!uuid(id)||entry.key!==PENDING_PREFIX+id)throw Error('Task待办身份冲突');
   c=await connectBefore(pool,deadline);locked=(await c.query("SELECT pg_try_advisory_lock(hashtext('task-execution-body:' || $1)) AS locked",[id])).rows[0]?.locked;
   if(!locked){stat.pending++;continue;}
   await c.query('BEGIN READ ONLY');transaction=true;
   const query=async(sql,args)=>{const remaining=deadline-100-Date.now();if(remaining<=0)throw Error('Task执行正文读取预算耗尽');await c.query("SELECT set_config('statement_timeout',$1,true)",[String(Math.min(3000,remaining))]);return c.query(sql,args);};
   const task=(await query("SELECT id,title,notion_id,payload->>'workflow_id' AS workflow_id FROM tasks WHERE id=$1",[id])).rows[0];
   if(!task?.notion_id){stat.pending++;continue;}if(!uuid(task.notion_id))throw Error('Task页面身份无效');
   const links=(await query("SELECT external_id FROM projection_links WHERE target='notion' AND entity_type='tasks' AND entity_id=$1",[id])).rows;
   if(links.some(l=>compact(l.external_id)!==compact(task.notion_id)))throw Error('Task页面链接冲突');
   const runs=(await query(`SELECT run_id,task_id,workflow_id,context->'workflow_snapshot'->>'workflow_id' AS frozen_workflow_id,status,notion_id,started_at,COUNT(*) OVER()::int AS total_runs
    FROM task_runs WHERE task_id=$1 ORDER BY started_at DESC,run_id DESC LIMIT 100`,[id])).rows;
   const pages=new Set(),runIds=new Set();for(const r of runs){if(r.frozen_workflow_id&&r.workflow_id&&r.frozen_workflow_id!==r.workflow_id)throw Error('Run冻结Workflow身份冲突');if(r.task_id!==id||!r.run_id||runIds.has(r.run_id))throw Error('Run任务归属或唯一身份冲突');runIds.add(r.run_id);if(r.notion_id){if(!uuid(r.notion_id)||pages.has(compact(r.notion_id))||compact(r.notion_id)===compact(task.notion_id))throw Error('Run页面身份冲突');pages.add(compact(r.notion_id));}}
   const workflowIds=[...new Set([task.workflow_id,...runs.map(r=>r.workflow_id)].filter(uuid))];
   const workflows=workflowIds.length?(await query(`SELECT w.id,w.name,pl.external_id AS notion_id FROM workflows w
    LEFT JOIN projection_links pl ON pl.target='notion-directory' AND pl.entity_type='workflows' AND pl.entity_id=w.id WHERE w.id=ANY($1::uuid[]) ORDER BY w.id`,[workflowIds])).rows:[];
   for(const w of workflows)if(w.notion_id&&!uuid(w.notion_id))throw Error('Workflow页面身份无效');
   await c.query('COMMIT');transaction=false;
   const request=(t,path,method='GET',body=null)=>{if(Date.now()>=deadline-100)throw Error('Task执行正文预算耗尽');return notionReq(t,path,method,body,{deadline:deadline-100});};
   const page=await request(token,`/pages/${task.notion_id}`);
   if(compact(page.id)!==compact(task.notion_id)||page.archived||page.in_trash||compact(page.parent?.database_id)!==compact(taskDbId)||!taskPageIdentity(page,id))throw Error('Task页面Brain ID或数据库身份不符');
   await syncManagedBodyBlock(token,task.notion_id,buildTaskExecutionBlock({task,workflows,runs,totalRuns:runs[0]?.total_runs??0}),request,marker(id));stat.synced++;
   complete=runs.every(r=>r.notion_id)&&workflows.length===workflowIds.length&&workflows.every(w=>w.notion_id);
   if(complete){const removed=await metadataOn(c,'DELETE FROM working_memory WHERE key=$1 AND value_json=$2::jsonb',[entry.key,JSON.stringify(entry.value_json)],deadline);if(removed.rowCount===1)stat.completedTaskIds.push(id);else stat.pending++;}else stat.pending++;
  }catch(e){stat.failed++;stat.errors.push({task_id:id,error:e.message});}
  finally{
   if(c){if(transaction)await c.query('ROLLBACK').catch(()=>{});
    if(!complete&&Date.now()<deadline)await metadataOn(c,'UPDATE working_memory SET updated_at=NOW() WHERE key=$1 AND value_json=$2::jsonb',[entry.key,JSON.stringify(entry.value_json)],deadline).catch(()=>{});
    if(locked)await c.query("SELECT pg_advisory_unlock(hashtext('task-execution-body:' || $1))",[id]).catch(()=>{});c.release();}
   else if(Date.now()<deadline)await metadata(pool,'UPDATE working_memory SET updated_at=NOW() WHERE key=$1 AND value_json=$2::jsonb',[entry.key,JSON.stringify(entry.value_json)],deadline).catch(()=>{});
  }
 }
 return stat;
}
