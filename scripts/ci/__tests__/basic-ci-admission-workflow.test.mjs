import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cruise} from 'dependency-cruiser';
import yaml from 'js-yaml';
const path=new URL('../../../.github/workflows/ci-admission-baseline.yml',import.meta.url);
function readPublicationWorkflowText(){return readFileSync(path,'utf8');}
test('独立publisher仅CI workflow_run main push成功触发，token全只读且无生产能力',()=>{
 const text=readPublicationWorkflowText(),w=yaml.load(text);
 assert.deepEqual(w.on,{workflow_run:{workflows:['CI'],types:['completed'],branches:['main']}});
 assert.deepEqual(w.permissions,{contents:'read',actions:'read',checks:'read'});assert.deepEqual(Object.keys(w.jobs),['ci-admission-baseline']);
 const job=w.jobs['ci-admission-baseline'];assert.equal(job.name,'ci-admission-baseline');
 for(const clause of ["github.repository == 'perfectuser21/cecelia'","github.event.workflow_run.event == 'push'","github.event.workflow_run.head_branch == 'main'","github.event.workflow_run.conclusion == 'success'","github.event.workflow_run.head_repository.full_name == 'perfectuser21/cecelia'"])assert.ok(job.if.includes(clause),clause);
 const checkouts=job.steps.filter(s=>s.uses==='actions/checkout@v4');assert.equal(checkouts.length,2);
 assert.deepEqual(checkouts.map(s=>s.with.ref),['${{ github.sha }}','${{ github.event.workflow_run.head_sha }}']);
 assert.deepEqual(checkouts.map(s=>s.with.path),['control','source']);assert.ok(checkouts.every(s=>s.with['persist-credentials']===false&&s.with['fetch-depth']===0));
 assert.equal(job.env.DB_NAME,'cecelia_scratch');assert.equal(job.env.DB_USER,'ci');assert.equal(job.env.NODE_ENV,'test');
 assert.equal(job.services.postgres.env.POSTGRES_DB,'cecelia_scratch');
 const publish=job.steps.find(s=>s.id==='publish');assert.equal(publish.env.GH_TOKEN,'${{ github.token }}');
 assert.equal(publish.run.trim(),'node control/scripts/ci/ci-admission-publisher.mjs "$GITHUB_WORKSPACE/source" "$GITHUB_WORKSPACE/control" "$RUNNER_TEMP/ci-admission-publication"');
 const upload=job.steps.find(s=>s.uses==='actions/upload-artifact@v4');assert.equal(upload.if,"steps.publish.outputs.published == 'true'");assert.equal(upload.with.name,'implementation-ci-admission-baseline-${{ github.event.workflow_run.head_sha }}');assert.equal(upload.with['if-no-files-found'],'error');
 assert.deepEqual(upload.with.path.trim().split('\n'),['${{ runner.temp }}/ci-admission-publication/ci-admission.json','${{ runner.temp }}/ci-admission-publication/assertions.json']);
 assert.ok(job.steps.some(s=>s.run==='node control/packages/brain/src/migrate.js'));assert.ok(job.steps.some(s=>s.run==='node --test control/scripts/ci/__tests__/ci-admission-inputs.pg.test.mjs'));
 assert.doesNotMatch(text,/secrets\.|tailscale|BRAIN_API|BRAIN_DEPLOY|SSH_KEY|source-runtime-ready|snapshot-main|deploy\.sh/);
});

test('当前正式dependency-cruiser必须认领真实publisher YAML数据输入',async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),reader='scripts/ci/__tests__/basic-ci-admission-workflow.test.mjs';
 const result=await cruise([reader],{baseDir:root,doNotFollow:{path:'node_modules'},exclude:{path:'node_modules'}}),out=typeof result.output==='string'?JSON.parse(result.output):result.output;
 assert.ok(out.modules.some(m=>m.source===reader&&m.dependencies.some(d=>!d.couldNotResolve&&resolve(root,d.resolved)===resolve(root,'.github/workflows/ci-admission-baseline.yml'))));
});
test('数据loader只读唯一YAML、不执行内容，成功与拒绝均恢复原cache/extension描述',()=>{
 const directory=mkdtempSync(join(tmpdir(),'ci-publication-yaml-'));try{
  const target=join(directory,'.github/workflows/ci-admission-baseline.yml'),other=join(directory,'other.yml');mkdirSync(dirname(target),{recursive:true});writeFileSync(other,'other: data');
  const text='globalThis.__publicationYamlExecuted=true;';writeFileSync(target,text);const local=createRequire(join(directory,'scripts/ci/__tests__/fixture.mjs'));
  const oldExtension=Object.getOwnPropertyDescriptor(local.extensions,'.yml'),oldCache=Object.getOwnPropertyDescriptor(local.cache,target);
  const sentinel=()=>{throw Error('prior loader must not run');},cached={exports:'prior cached bytes'};
  try{
   Object.defineProperty(local.extensions,'.yml',{value:sentinel,writable:true,enumerable:false,configurable:true});Object.defineProperty(local.cache,target,{value:cached,writable:true,enumerable:false,configurable:true});
   const extension=Object.getOwnPropertyDescriptor(local.extensions,'.yml'),cache=Object.getOwnPropertyDescriptor(local.cache,target);
   assert.equal(readPublicationWorkflowText(local),text);assert.equal(globalThis.__publicationYamlExecuted,undefined);
   assert.deepEqual(Object.getOwnPropertyDescriptor(local.extensions,'.yml'),extension);assert.deepEqual(Object.getOwnPropertyDescriptor(local.cache,target),cache);
   const redirected=()=>local(other);Object.assign(redirected,{resolve:local.resolve,extensions:local.extensions,cache:local.cache});
   assert.throws(()=>readPublicationWorkflowText(redirected),/YAML_DATA_TARGET/);
   assert.deepEqual(Object.getOwnPropertyDescriptor(local.extensions,'.yml'),extension);assert.deepEqual(Object.getOwnPropertyDescriptor(local.cache,target),cache);
  }finally{if(oldExtension)Object.defineProperty(local.extensions,'.yml',oldExtension);else delete local.extensions['.yml'];if(oldCache)Object.defineProperty(local.cache,target,oldCache);else delete local.cache[target];delete local.cache[other];delete globalThis.__publicationYamlExecuted;}
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('额外PG回归仅声明verification输入并绑定真实受测生产模块',()=>{
 const rows=JSON.parse(readFileSync(new URL('../../../.implementation-source-relations.json',import.meta.url))).relations;
 for(const[name,owner]of[['builder','ci-admission-builder'],['inputs','ci-admission-inputs'],['skill-cache','implementation-skill-source'],['verification-lease','implementation-pr-gate']]){
  const path=`scripts/ci/__tests__/ci-admission-${name}.pg.test.mjs`,matches=rows.filter(row=>row.path===path);assert.equal(matches.length,1);assert.deepEqual(matches[0],{owner_path:`scripts/ci/${owner}.mjs`,path,role:'verification'});
 }
});
