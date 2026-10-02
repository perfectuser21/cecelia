import { describe,expect,it } from 'vitest';
import { readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import yaml from 'js-yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
describe('implementation-ci-workflow',()=>{
it('实际PR/main触发存在，中央凭据只在main快照job，回归job不持Brain token',()=>{
  const path=new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url);
  expect(existsSync(path),'不能只交CLI测试，必须有实际workflow').toBe(true);
  const workflow=yaml.load(readFileSync(path,'utf8'));
  expect(workflow.on.pull_request.branches).toContain('main');expect(workflow.on.push.branches).toContain('main');
  expect(workflow.jobs['snapshot-main'].if).toContain("github.event_name != 'pull_request'");
  expect(JSON.stringify(workflow.jobs['snapshot-main'])).toContain('CECELIA_INTERNAL_TOKEN');
  expect(JSON.stringify(workflow.jobs.gate)).not.toContain('CECELIA_INTERNAL_TOKEN');
  expect(JSON.stringify(workflow.jobs.gate)).toContain('implementation-pr-gate.mjs');
});

it('执行产物与候选源码的job不能保存受信分支npm缓存',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 for(const job of Object.values(workflow.jobs))for(const step of job.steps||[]){
  expect(step.uses||'').not.toMatch(/^actions\/cache/);
  if((step.uses||'').startsWith('actions/setup-node'))expect(step.with?.cache).toBeUndefined();
 }
});
it('真实执行下载步骤：固定base artifact缺失返回非零并留下准确gap，零PASSreceipt',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const step=workflow.jobs.gate.steps.find(s=>s.name?.includes('下载固定SHA'));
 const root=mkdtempSync(join(tmpdir(),'ci-download-gap-'));
 try{
  mkdirSync(join(root,'bin'));writeFileSync(join(root,'bin/gh'),`#!/bin/bash
printf '%s\\n' '{"artifacts":[]}'
`,{mode:0o755});
  const result=spawnSync('/bin/bash',['-c',step.run],{cwd:root,encoding:'utf8',env:{PATH:`${root}/bin:${process.env.PATH}`,RUNNER_TEMP:root,MODE:'pr',BASE:'a'.repeat(40),HEAD:'b'.repeat(40),GITHUB_REPOSITORY:'perfectuser21/zenithjoy-workspace'}});
  expect(result.status).not.toBe(0);
  const gap=join(root,'implementation-output/gap.json');expect(existsSync(gap),result.stdout+result.stderr).toBe(true);
  expect(JSON.parse(readFileSync(gap,'utf8'))).toMatchObject({status:'unknown',stage:'snapshot_download',code:'IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING'});
  expect(existsSync(join(root,'implementation-output/receipt.json'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
});
