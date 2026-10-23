import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const {resolvePrBaseline}=await import('../implementation-pr-baseline.mjs');
const repo='perfectuser21/cecelia',hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'pr-baseline-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');git('remote','add','origin','https://github.com/'+repo+'.git');
 const commit=(path,text)=>{writeFileSync(join(root,path),text);git('add',path);git('-c','core.hooksPath=/dev/null','commit','-qm','fixture');return git('rev-parse','HEAD');};
 const first=commit('A','one'),middle=commit('A','two'),base=commit('B','three'),head=commit('C','four');
 const event={number:42,pull_request:{number:42,base:{sha:base,ref:'main',repo:{full_name:repo}},head:{sha:head,repo:{full_name:repo}}}};
 const official=new Map(),calls=[];
 const add=revision=>{const bytes=Buffer.from(JSON.stringify({revision,scopes:['cecelia-kr','cecelia-factory']}));const a={id:official.size+1,name:'implementation-snapshot-'+revision,expired:false,digest:'sha256:'+hash(bytes),size_in_bytes:bytes.length,created_at:'2026-10-21T09:12:04Z',workflow_run:{id:7,head_sha:revision,head_branch:'main',repository_id:99,head_repository_id:99}};official.set(revision,{artifact:a,bytes});return a;};
 const api=async path=>{
  calls.push(path);
  if(path.endsWith('/pulls/42'))return structuredClone(event.pull_request);
  if(path.includes('/artifacts?')){const name=new URL('https://fixture.invalid/'+path).searchParams.get('name');const entry=[...official.values()].find(v=>v.artifact.name===name);return {total_count:entry?1:0,artifacts:entry?[structuredClone(entry.artifact)]:[]};}
  if(/\/artifacts\/\d+$/.test(path))return structuredClone([...official.values()].find(v=>v.artifact.id===Number(path.split('/').at(-1))).artifact);
  if(path.endsWith('/runs/7')){const a=[...official.values()].find(v=>v.artifact.id===lastArtifact)?.artifact;return {id:7,run_attempt:1,head_sha:a.workflow_run.head_sha,head_branch:'main',event:'push',path:'.github/workflows/implementation-impact.yml',repository:{full_name:repo,id:99},head_repository:{full_name:repo,id:99}};}
  if(path.endsWith('/attempts/1/jobs?per_page=100'))return {total_count:1,jobs:[{id:8,name:'snapshot-main',run_id:7,run_attempt:1,status:'completed',conclusion:'success',started_at:'2026-10-21T09:11:00Z',completed_at:'2026-10-21T09:13:00Z'}]};
  throw Error('unexpected endpoint '+path);
 };
 let lastArtifact;
 const wrapped=async path=>{const r=await api(path);if(/\/artifacts\/\d+$/.test(path))lastArtifact=r.id;return r;};
 const deps={api:wrapped,download:async path=>[...official.values()].find(v=>v.artifact.id===Number(path.split('/').at(-2))).bytes,
  unpack:bytes=>JSON.parse(bytes),validateBundle:body=>{assert.deepEqual(body.scopes,['cecelia-kr','cecelia-factory']);return {snapshot_sha256:'a'.repeat(64),scope_hashes:{'cecelia-kr':'b'.repeat(64),'cecelia-factory':'c'.repeat(64)},revision:body.revision};},
  git:(path,...args)=>path==='tooling'?base:git(...args)};
 const options={repoRoot:root,toolingRoot:'tooling',repository:repo,eventName:'pull_request',event,toolingRevision:base};
 return {root,git,first,middle,base,head,event,official,add,calls,deps,options,run:()=>resolvePrBaseline(options,deps)};
}
test('精确官方基线优先，不回退、不改tooling身份',async t=>{const f=fixture(t);f.add(f.first);f.add(f.base);const r=await f.run();assert.equal(r.resolution.effective_base_revision,f.base);assert.equal(r.resolution.tooling_revision,f.base);assert.equal(r.resolution.chain.length,1);});
test('沿第一父链取最近完整官方祖先，报告真实累计差分而非仅PR差分',async t=>{const f=fixture(t);f.add(f.first);const r=await f.run();assert.equal(r.resolution.effective_base_revision,f.first);assert.deepEqual(r.resolution.chain.map(x=>x.revision),[f.base,f.middle,f.first]);assert.deepEqual(r.resolution.changed_files,['A','B','C']);assert.equal(r.resolution.original_pr_base_revision,f.base);assert.equal(r.body.revision,f.first);});
test('中间祖先存在则不得跳到更老基线',async t=>{const f=fixture(t);f.add(f.first);f.add(f.middle);assert.equal((await f.run()).resolution.effective_base_revision,f.middle);});
for(const mode of ['digest','origin','scope','provider','api','pagination'])test('现存不可信证据/请求故障必须失败，不降级：'+mode,async t=>{
 const f=fixture(t);f.add(f.first);const a=f.add(f.base);const old=f.deps.api;
 if(mode==='digest')a.digest='sha256:'+'0'.repeat(64);
 if(mode==='origin')a.workflow_run.head_sha=f.first;
 if(mode==='scope')f.deps.validateBundle=()=>{throw Error('bad scope');};
 if(mode==='provider')f.deps.api=async p=>p.includes('/jobs?')?{total_count:0,jobs:[]}:old(p);
 if(mode==='api')f.deps.api=async()=>{throw Error('403');};
 if(mode==='pagination')f.deps.api=async p=>p.includes('/artifacts?')?{total_count:2,artifacts:[a]}:old(p);
 await assert.rejects(f.run());assert.equal(f.calls.some(p=>p.includes('implementation-snapshot-'+f.first)),false);
});
for(const mode of ['event','tooling','head','api-head','depth'])test('冻结事件/工具/候选与有界搜索拒绝：'+mode,async t=>{
 const f=fixture(t);f.add(f.first);
 if(mode==='event')f.options.eventName='workflow_dispatch';if(mode==='tooling')f.options.toolingRevision=f.first;
 if(mode==='head')f.event.pull_request.head.sha=f.first;
 if(mode==='api-head'){const api=f.deps.api;f.deps.api=async p=>p.endsWith('/pulls/42')?{...f.event.pull_request,head:{sha:f.first,repo:{full_name:repo}}}:api(p);}
 if(mode==='depth')f.options.maxDepth=1;
 await assert.rejects(f.run());
});
