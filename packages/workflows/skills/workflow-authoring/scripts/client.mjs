#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function taskId(id) { if (!UUID.test(id)) throw new Error('任务ID必须为UUID'); return id; }

export function createAuthoringClient({ fetch = globalThis.fetch,
  base = process.env.CECELIA_API_BASE_URL || 'http://localhost:5221/api/brain',
  token = process.env.CECELIA_INTERNAL_TOKEN } = {}) {
  async function call(path, method = 'GET', data) {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method, headers: { 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) },
      ...(data === undefined ? {} : { body:JSON.stringify(data) }), signal:AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.message || result.error?.message || result.error || '请求失败'}`);
    return result;
  }
  const status = id => call(`/workflow-authoring/runs/${taskId(id)}`);
  async function start(request, existingTaskId) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(request.request_key || '')) throw new Error('request_key必须是本次请求的稳定唯一标识');
    if (!request.goal?.trim() || !['create','update'].includes(request.operation)) throw new Error('缺少目标或创建/更新意图');
    const claimer = `workflow-authoring:${sha(request.request_key).slice(0,24)}`;
    const created = existingTaskId ? {id:taskId(existingTaskId)} : await call('/tasks','POST', {
      title:`创建或更新流程：${request.goal.slice(0,100)} [${request.request_key}]`, description:request.goal,
      task_type:'research', trigger_source:'user', source_id:`workflow-authoring:${request.request_key}`,
      payload:{workflow_authoring:true,source:'openclaw',mode:'headed'},
    });
    const id = taskId(created.task?.id || created.id);
    const rowResult = await call(`/tasks/${id}`), row = rowResult.task || rowResult;
    if (row.payload?.workflow_authoring !== true) throw new Error('现有任务不属于工作流管理流程');
    if (row.status === 'completed') return {task_id:id,state:await status(id)};
    if (row.claimed_by && row.claimed_by !== claimer) throw new Error('该任务已被其他执行者认领，保持原有所有权');
    if (!row.claimed_by) await call(`/tasks/${id}/claim`,'POST',{claimer});
    if (row.status === 'queued') await call(`/tasks/${id}`,'PATCH',{status:'in_progress'});
    const state = await call(`/workflow-authoring/runs/${id}/init`,'POST',request);
    return {task_id:id,state};
  }
  async function submit(id, stage, output) {
    const state = await status(id), submission_id = `${stage}-${sha(output)}`;
    const old = state.receipts.find(r=>r.submission_id===submission_id);
    if (old) return {state,receipt:old,replayed:true};
    return call(`/workflow-authoring/runs/${taskId(id)}/submit`,'POST',{
      stage,revision:state.revision,submission_id,output,
    });
  }
  async function finish(id) {
    const state = await status(id), receipt = state.outputs?.register;
    if (state.stage !== 'completed' || receipt?.readback_verified !== true) throw new Error('正式登记和回读尚未完成，不能收尾');
    return call(`/tasks/${taskId(id)}`,'PATCH',{status:'completed',result:{
      summary:`工作流 ${receipt.key} ${receipt.version} 已登记并回读`,actor:state.request.actor,
      evidence:[`workflows:${receipt.workflow_id}`,`definition:${receipt.definition_sha256}`],
      handoff:{schema_version:1,task_id:id,title:state.request.goal,verdict:'PASS',
        done:['六骨干活动完成；工作流及活动真实落库并回读'],not_done:[],next_steps:[],
        data_sources:[`GET /api/brain/workflow-authoring/runs/${id}`],created_at:new Date().toISOString()},
    }});
  }
  return {start,status,submit,finish};
}

export async function main(args) {
  const [command,...rest] = args, options = {};
  for(let i=0;i<rest.length;i+=2) {
    if (!rest[i]?.startsWith('--') || rest[i+1]===undefined) throw new Error('参数格式为 --名称 值');
    options[rest[i].slice(2)] = rest[i+1];
  }
  const client = createAuthoringClient();
  const input = async name => JSON.parse(await readFile(options[name], 'utf8'));
  if(command==='start') return client.start(await input('request'),options['task-id']);
  if(command==='status') return client.status(options['task-id']);
  if(command==='submit') return client.submit(options['task-id'],options.stage,await input('output'));
  if(command==='finish') return client.finish(options['task-id']);
  throw new Error('命令：start --request 文件；status --task-id ID；submit --task-id ID --stage 阶段 --output 文件；finish --task-id ID');
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result=>process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
}
