import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const PR=/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
const refuse=(code,url)=>{const error=Error(code);error.code=code;if(url)error.pr_url=url;throw error;};

// 请求与结果中的PR只是核验线索；仅采信既有合并事实或GitHub精确URL的MERGED读回。
export async function verifyTaskCompletionPr(task, request={}, {readPr=async url=>{
  const {stdout}=await run('gh',['pr','view',url,'--json','url,state,mergedAt'],{timeout:10000,maxBuffer:65536});
  return JSON.parse(stdout);
}}={}) {
  const reported=[task.pr_url,task.payload?.pr_url,task.result?.pr_url,request.pr_url,request.result?.pr_url]
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
