import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
import { resolveGitHubToken } from '../harness-credentials.js';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const repo='perfectuser21/cecelia',path='packages/brain/config/company-kr-workflow.json';
export async function readCompanyKrFile(revision,filePath=path) {
  try {return execFileSync('git',['show',`${revision}:${filePath}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
  catch {
    const response=await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${revision}`,{headers:{Accept:'application/vnd.github.raw',Authorization:`Bearer ${await resolveGitHubToken()}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw Error(`固定KR来源读取失败: ${response.status}`);
    return response.text();
  }
}
export async function loadCompanyKrSource(spec,{revision=process.env.GIT_SHA,readSource=readCompanyKrFile}={}) {
  const commit=revision||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(!/^[0-9a-f]{40}$/.test(commit)) throw Error('KR来源revision必须固定commit');
  const actual=JSON.parse(await readSource(commit));
  if(stepSha256(actual)!==stepSha256(spec)) throw Error('KR配置与固定commit不一致');
  return {repo,path,commit};
}
