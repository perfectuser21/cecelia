import {CODING_MUTATION_TASK_TYPES,RETIRED_DEVELOPMENT_TASK_TYPES} from './task-type-registry.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const developmentTypes=new Set([...CODING_MUTATION_TASK_TYPES,...RETIRED_DEVELOPMENT_TASK_TYPES]);
const PR=/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
const refuse=(code,url)=>{const error=Error(code);error.code=code;if(url)error.pr_url=url;throw error;};

// 显式PR字段表示交付；开发任务也消费嵌套交付线索。评审/研究的嵌套PR只作引用。
// 合并事实仅采信既有数据库记录或GitHub精确URL的MERGED读回。
export async function verifyTaskCompletionPr(task, request={}, {readPr=async url=>{
  const {stdout}=await run('gh',['pr','view',url,'--json','url,state,mergedAt'],{timeout:10000,maxBuffer:65536});
  return JSON.parse(stdout);
}}={}) {
  const delivery=developmentTypes.has(task.task_type)||task.payload?.work_kind==='coding_mutation';
  const reported=[task.pr_url,request.pr_url,...(delivery?[task.payload?.pr_url,task.result?.pr_url,request.result?.pr_url]:[])]
    .filter(value=>value!=null && value!=='');
  if(!reported.length)return null;
  if(reported.some(value=>typeof value!=='string'||!PR.test(value)))refuse('PR_MERGE_UNVERIFIED');
  const urls=[...new Set(reported)];
  if(urls.length!==1)refuse('PR_MERGE_UNVERIFIED');
  const url=urls[0];
  if(task.pr_url===url && task.pr_merged_at && Number.isFinite(Date.parse(task.pr_merged_at)))return {url,mergedAt:task.pr_merged_at};
  let pr;
  try{pr=await readPr(url);}catch{refuse('PR_MERGE_UNVERIFIED');}
  if(pr?.url!==url)refuse('PR_MERGE_UNVERIFIED');
  if(pr.state!=='MERGED')refuse('PR_NOT_MERGED',url);
  if(!pr.mergedAt || !Number.isFinite(Date.parse(pr.mergedAt)))refuse('PR_MERGE_UNVERIFIED');
  return {url,mergedAt:pr.mergedAt};
}
