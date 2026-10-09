#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions } from './us-price-keyword-core.mjs';

/** 显式非AI lane永不领取；生产Notion回灌旧行无lane，以明确执行参数约束作用域。 */
export function selectRequest(task, now = Date.now()) {
  const p=task.payload??{};
  if(task.status!=='queued'||task.task_type!=='qiumi_task'||p.source!=='notion_gtd'||task.claimed_by) return null;
  if([task.lane,p.lane,task.metadata?.lane].some(l=>l&&l!=='AI')) return null;
  if([task.notion_props,p.notion_props,p].some(v=>Object.hasOwn(v??{},'qiumi_human_hold'))) return null;
  const scheduled=task.next_run_at??p.next_run_at;
  if(scheduled&&(!Number.isFinite(Date.parse(scheduled))||Date.parse(scheduled)>now)) return null;
  const body=task.description||p.qiumi_source?.body||'';
  const block=body.match(/【执行参数】([\s\S]*?)【执行参数结束】/)?.[1];
  if(!block||!/^\s*(?:执行Agent|agent|执行者)\s*[:：]\s*us-price-compare\s*$/im.test(block)) return null;
  const field=(text,key)=>text.match(new RegExp(`^\\s*(?:${key})\\s*[:：=]\\s*(.+?)\\s*$`,'im'))?.[1];
  const keyword=field(body,'关键词|keyword');
  if(!keyword) return null;
  const model=field(block,'模型|model')??'openai/gpt-6-sol';
  try { return parseOptions(['--keyword',keyword,'--count',field(body,'数量|count')??'1','--zip',field(body,'邮编|ZIP')??'53132','--model',model,'--task-id',task.id]); }
  catch { return null; }
}
export async function watchOnce({request,run}) {
  const response=await request('/tasks?status=queued&task_type=qiumi_task&limit=100','GET');
  const tasks=Array.isArray(response)?response:response.tasks??[];
  for(const task of tasks) {
    const o=selectRequest(task);if(!o) continue;
    try {
      await run(['--task-id',task.id,'--keyword',o.keyword,'--count',String(o.count),'--zip',o.zip,'--model',o.model]);
      return {task_id:task.id,outcome:'finished'};
    } catch(error) {
      // CLI在原子claim前失败时不写回该任务，避免覆盖另一个执行者。
      return {task_id:task.id,outcome:/HTTP 409/.test(error.message)?'claim_conflict':'failed'};
    }
  }
  return {outcome:'idle'};
}
async function main(args) {
  if(args.includes('--help')) {console.log('用法: node us-price-notion-watch.mjs --once；定时器每30秒启动一次，只领取明确Agent的现有Notion任务。');return;}
  if(args.length!==1||args[0]!=='--once') throw new Error('必须显式指定 --once，由系统定时器重复启动');
  const base=process.env.CECELIA_BRAIN_URL??'http://localhost:5221';
  const request=async(path,method)=>{
    const r=await fetch(base+'/api/brain'+path,{method,signal:AbortSignal.timeout(30000)});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);return r.json();
  };
  const run=args=>new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[fileURLToPath(new URL('./us-price-keyword.mjs',import.meta.url)),...args],{stdio:['ignore','pipe','pipe'],timeout:1800000});
    let tail='';p.stdout.on('data',()=>{});p.stderr.on('data',d=>{tail=(tail+d).slice(-2000);});
    p.on('error',()=>reject(new Error('CLI启动失败')));
    p.on('close',code=>code===0?resolve():reject(new Error(tail||'CLI失败')));
  });
  console.log(JSON.stringify(await watchOnce({request,run})));
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href) main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
