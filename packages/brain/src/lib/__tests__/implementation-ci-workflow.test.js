import { describe,expect,it } from 'vitest';
import { readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync } from 'node:fs';
import yaml from 'js-yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync,execFileSync } from 'node:child_process';
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
it('可信依赖与scratch初始化先于artifact下载，不消费下载内容',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8')),steps=workflow.jobs.gate.steps;
 const download=steps.findIndex(s=>s.name?.includes('下载固定SHA'));
 for(const [index,step] of steps.entries())if(step.run==='npm ci --ignore-scripts'||step.name==='scratch正式迁移')expect(index).toBeLessThan(download);
 expect(steps.filter(s=>s.run==='npm ci --ignore-scripts')).toHaveLength(2);
});
it('真实zip只读取固定head.json，不解包额外路径或代码文件',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const step=workflow.jobs.gate.steps.find(s=>s.name?.includes('下载固定SHA')),root=mkdtempSync(join(tmpdir(),'ci-archive-boundary-'));
 try{
  const archive=join(root,'input.zip');
  execFileSync('python3',['-c','import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("head.json", json.dumps({"snapshot":{}})); z.writestr("extra-tool.mjs", "malicious"); z.close()',archive]);
  mkdirSync(join(root,'bin'));writeFileSync(join(root,'bin/gh'),`#!/bin/bash
case "$*" in
 *'/actions/artifacts?name='*) printf '%s\\n' '{"artifacts":[{"id":123,"expired":false,"workflow_run":{"head_branch":"main","head_sha":"${'a'.repeat(40)}","repository_id":1,"head_repository_id":1}}]}' ;;
 *'/actions/artifacts/123/zip'*) cat "$ARCHIVE" ;;
 *'/actions/artifacts/123'*) printf '99\\n' ;;
 *'/actions/runs/99'*) printf 'push .github/workflows/implementation-impact.yml\\n' ;;
 *) exit 80 ;;
esac
`,{mode:0o755});
  const result=spawnSync('/bin/bash',['-c',step.run],{cwd:root,encoding:'utf8',env:{PATH:`${root}/bin:${process.env.PATH}`,ARCHIVE:archive,RUNNER_TEMP:root,MODE:'pr',BASE:'a'.repeat(40),HEAD:'b'.repeat(40),GITHUB_REPOSITORY:'owner/repo'}});
  expect(result.status,result.stderr+result.stdout).toBe(0);
  expect(readdirSync(join(root,'implementation-input/base'))).toEqual(['base.json']);
  expect(JSON.parse(readFileSync(join(root,'implementation-input/head/head.json'),'utf8'))).toEqual({snapshot:{}});
 }finally{rmSync(root,{recursive:true,force:true});}
});
});
