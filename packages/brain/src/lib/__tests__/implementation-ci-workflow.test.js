import { describe,expect,it } from 'vitest';
import { readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync,symlinkSync } from 'node:fs';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync,execFileSync } from 'node:child_process';
describe('implementation-ci-workflow',()=>{
it('正常Brain单测执行巡查可信baseline实际ZIP与治理行为回归',()=>{
 const root=new URL('../../../../../',import.meta.url);
 const child=spawnSync(process.execPath,['--test','scripts/ci/__tests__/device-patrol-baseline.test.mjs','scripts/ci/__tests__/device-patrol-governance.test.mjs'],{cwd:root,encoding:'utf8',timeout:30000});
 expect(child.status,child.stdout+child.stderr).toBe(0);expect(child.stdout).toMatch(/(?:pass 3|tests 3)/);expect(child.stdout).toMatch(/(?:fail 0)/);
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 expect(workflow.on.workflow_dispatch).toBeDefined();expect(JSON.stringify(workflow.jobs)).toContain('refs/heads/main');
 expect(JSON.stringify(workflow.jobs['device-patrol-baseline'])).not.toContain('--data-binary');expect(JSON.stringify(workflow.jobs['device-patrol-baseline'])).not.toContain('pull_request');
});
it('主CI集成入口安装根扫描器与Brain锁依赖，不能被子workspace安装裁剪',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
 const steps=workflow.jobs['brain-integration'].steps;
 const tests=steps.findIndex(s=>s.name==='Integration Tests');
 const installs=steps.slice(0,tests).filter(s=>/npm ci/.test(s.run||''));
 expect(installs.length).toBeGreaterThan(0);
 expect(installs.at(-1)['working-directory']||'.').toBe('.');
 expect(installs.at(-1).run.trim()).toMatch(/^npm ci(?: --(?:ignore-scripts|no-audit|no-fund))*$/);
 expect(steps[tests].run).toContain('src/__tests__/integration/');
});
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

it('自仓PR仅精确native双scope消费同一官方artifact companion，main exporter字节接口保持单scope',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const producer=workflow.jobs['snapshot-main'];
 expect(producer.steps.find(s=>s.env).env.ADMISSION_SCOPES).toBeUndefined();
 expect(producer.steps.filter(s=>(s.uses||'').startsWith('actions/upload-artifact')).map(s=>s.with.path)).toEqual(['evidence/head.json','evidence/base.json']);
 expect(workflow.jobs.gate.env.ADMISSION_SCOPES).toBe("${{ inputs.admission_scopes || vars.IMPLEMENTATION_ADMISSION_SCOPES || (github.event_name == 'pull_request' && github.repository == 'perfectuser21/cecelia' && '{\"schema_version\":1,\"scopes\":[\"cecelia-kr\",\"cecelia-factory\"]}' || '') }}");
 const download=workflow.jobs.gate.steps.find(s=>s.name?.includes('下载固定SHA')).run;
 expect(download.match(/node tooling\/scripts\/ci\/implementation-pr-gate\.mjs --extract-scopes/g)).toHaveLength(2);
 expect(download).not.toContain('head-$scope.json');
 const runner=workflow.jobs.gate.steps.find(s=>s.name==='实际变更影响与固定回归').run;
 expect(createHash('sha256').update(runner).digest('hex')).toBe('8e54cd03b82a18c8c94eaf0a438744193e093d680aa133f416e33ba4ca3ae21d');
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
  // 真CLI执行官方下载shell；缺companion必须拒绝联合来源。
  symlinkSync(new URL('../../../../../',import.meta.url),join(root,'tooling'),'dir');
  const joint=spawnSync('/bin/bash',['-c',step.run],{cwd:root,encoding:'utf8',env:{PATH:`${root}/bin:${process.env.PATH}`,ARCHIVE:archive,RUNNER_TEMP:root,MODE:'pr',BASE:'a'.repeat(40),HEAD:'b'.repeat(40),GITHUB_REPOSITORY:'perfectuser21/cecelia',ADMISSION_SCOPES:'{"schema_version":1,"scopes":["cecelia-kr","cecelia-factory"]}'}});
  expect(joint.status).not.toBe(0);
  expect(JSON.parse(readFileSync(join(root,'implementation-output/gap.json'),'utf8'))).toMatchObject({status:'unknown',code:'IMPLEMENTATION_CI_SCOPE_COMPANION_INVALID'});
  expect(existsSync(join(root,'implementation-input/base/base-cecelia-factory.json'))).toBe(false);
  expect(existsSync(join(root,'implementation-output/receipt.json'))).toBe(false);

 }finally{rmSync(root,{recursive:true,force:true});}
});

it('同base正规artifact按真实创建时间选择，拒把API首项或较大ID当更新来源',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const step=workflow.jobs.gate.steps.find(s=>s.name?.includes('下载固定SHA')),root=mkdtempSync(join(tmpdir(),'ci-artifact-time-order-'));
 try{
  const archive=join(root,'input.zip'),capture=join(root,'api-calls.log');
  execFileSync('python3',['-c','import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("head.json", json.dumps({"snapshot":{}})); z.close()',archive]);
  mkdirSync(join(root,'bin'));writeFileSync(join(root,'bin/gh'),`#!/bin/bash
printf '%s\\n' "$*" >> "$API_CALLS"
case "$*" in
 *'/actions/artifacts?name='*) printf '%s\\n' '{"artifacts":[{"id":123,"created_at":"2026-10-09T05:45:12Z","expired":false,"workflow_run":{"head_branch":"main","head_sha":"${'a'.repeat(40)}","repository_id":1,"head_repository_id":1}},{"id":122,"created_at":"2026-10-09T05:49:49Z","expired":false,"workflow_run":{"head_branch":"main","head_sha":"${'a'.repeat(40)}","repository_id":1,"head_repository_id":1}}]}' ;;
 *'/actions/artifacts/123/zip'*|*'/actions/artifacts/122/zip'*) cat "$ARCHIVE" ;;
 *'/actions/artifacts/123'*|*'/actions/artifacts/122'*) printf '99\\n' ;;
 *'/actions/runs/99'*) printf 'push .github/workflows/implementation-impact.yml\\n' ;;
 *) exit 80 ;;
esac
`,{mode:0o755});
  const result=spawnSync('/bin/bash',['-c',step.run],{cwd:root,encoding:'utf8',env:{PATH:`${root}/bin:${process.env.PATH}`,API_CALLS:capture,ARCHIVE:archive,RUNNER_TEMP:root,MODE:'pr',BASE:'a'.repeat(40),HEAD:'b'.repeat(40),GITHUB_REPOSITORY:'owner/repo'}});
  expect(result.status,result.stdout+result.stderr).toBe(0);
  expect(readFileSync(capture,'utf8')).toContain('/actions/artifacts/122/zip');
  expect(readFileSync(capture,'utf8')).not.toContain('/actions/artifacts/123/zip');
 }finally{rmSync(root,{recursive:true,force:true});}
});
});
