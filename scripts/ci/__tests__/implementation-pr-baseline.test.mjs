import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdirSync,symlinkSync,unlinkSync} from 'node:fs';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import yaml from 'js-yaml';
import {stepSha256} from '../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {EXISTING_OPS_IDENTITIES as identities} from '../../../packages/brain/src/lib/existing-ops-source.js';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const {resolvePrBaseline,unpackOfficialBaselineArchive}=await import('../implementation-pr-baseline.mjs');
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
  git:(path,...args)=>path==='tooling'?(args[0]==='status'?'':base):git(...args)};
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

test('过期精确artifact属于缺失，可沿链寻找官方祖先',async t=>{const f=fixture(t);f.add(f.first);f.add(f.base).expired=true;const r=await f.run();assert.equal(r.resolution.effective_base_revision,f.first);assert.equal(r.resolution.chain[0].status,'missing');});
test('第二父分支虽为祖先也不能用作基线',async t=>{
 const f=fixture(t);f.git('checkout','-qb','side',f.first);writeFileSync(join(f.root,'D'),'side');f.git('add','D');f.git('-c','core.hooksPath=/dev/null','commit','-qm','side');const side=f.git('rev-parse','HEAD');
 f.git('checkout','-q','-B','main',f.base);f.git('-c','core.hooksPath=/dev/null','merge','--no-ff','-qm','merge','side');const base=f.git('rev-parse','HEAD');
 writeFileSync(join(f.root,'E'),'candidate');f.git('add','E');f.git('-c','core.hooksPath=/dev/null','commit','-qm','candidate');const head=f.git('rev-parse','HEAD');
 f.event.pull_request.base.sha=base;f.event.pull_request.head.sha=head;f.options.toolingRevision=base;f.deps.git=(path,...args)=>path==='tooling'?(args[0]==='status'?'':base):f.git(...args);
 f.add(side);await assert.rejects(f.run(),{code:'PR_BASELINE_ANCESTOR_NOT_FOUND'});assert.equal(f.calls.some(p=>p.includes('implementation-snapshot-'+side)),false);
});
for(const mode of ['normal','duplicate','traversal','symlink'])test('官方ZIP成员严格核验：'+mode,()=>{
 const bytes=execFileSync('python3',['-I','-c',`import io,zipfile,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('head.json','{"fixture":true}')
 if sys.argv[1]=='duplicate': z.writestr('head.json','{}')
 if sys.argv[1]=='traversal': z.writestr('../outside','x')
 if sys.argv[1]=='symlink':
  i=zipfile.ZipInfo('link');i.external_attr=0o120777<<16;z.writestr(i,'target')
sys.stdout.buffer.write(b.getvalue())`,mode],{stdio:['ignore','pipe','pipe']});
 if(mode==='normal')assert.deepEqual(unpackOfficialBaselineArchive(bytes),{fixture:true});else assert.throws(()=>unpackOfficialBaselineArchive(bytes),{code:'PR_BASELINE_ARCHIVE_INVALID'});
});

// 与正式snapshot schema同形的双scope夹具；下列resolver测试不替换解包或校验函数。
const seal=(body,key='snapshot_sha256')=>({...body,[key]:stepSha256(body)});
function bundle(revision,{parentMissing=false,childMissing=false,parentGaps=null,parentManifest=null}={}){
 const registry={workflows:[],references:[],activities:[],steps:[],capabilities:[],value_streams:[{id:'aaaaaaaa-f0f0-4000-8000-000000000001'}]};
 const definitions={workflows:[],activities:[]};
 for(const i of identities){
  registry.workflows.push({id:i.workflow_id,key:i.workflow_key,capability_id:i.capability_id});
  registry.capabilities.push({id:i.capability_id,parent_journey_id:registry.value_streams[0].id});
  for(const [n,id] of [i.reference_id,...i.unverified_reference_ids].entries()){
   const activity_id=n===0?i.activity_id:id;
   registry.references.push({id,workflow_id:i.workflow_id,activity_id,slot_key:`step_${n+1}`,sequence_no:n+1,active:true});registry.activities.push({id:activity_id});
  }
 }
 const frozen=seal(registry,'registry_sha256');
 for(const i of identities){
  const common={definition_scope:'consumer_evidence',source_scope:'cecelia-factory',registration_sha256:frozen.registry_sha256,contract:{key:i.workflow_key,executable:false,definition_scope:'consumer_evidence',source_basis:'fixed_git_tree'}};
  const source={repo,path:'fixed-fixture.json',commit:revision};
  const activity={id:i.activity_id,activity_id:i.activity_id,source_repo:repo,source_path:source.path,source_commit:revision,payload:{...common,implementation_bindings:[]}};
  activity.payload_sha256=stepSha256({source,payload:activity.payload});definitions.activities.push(activity);
  const workflow={id:i.workflow_id,workflow_id:i.workflow_id,source_repo:repo,source_path:source.path,source_commit:revision,payload:{...common,capability_id:i.capability_id,coverage:{status:'unknown',verified_reference_ids:[i.reference_id],unverified_reference_ids:i.unverified_reference_ids},activities:[{reference_id:i.reference_id,activity_id:i.activity_id,activity_version_id:activity.id}]}};
  workflow.payload_sha256=stepSha256({source,payload:workflow.payload});definitions.workflows.push(workflow);
 }
 const child=seal({schema_version:1,scope:'cecelia-factory',repo,revision,status:childMissing?'unknown':'verified',gaps:childMissing?[{code:'definition_snapshot_missing'},{code:'scope_manifest_missing'}]:[],snapshot_scope:'consumer_evidence',execution_status:'unknown',consumer_registry:frozen,unverified_reference_ids:identities.flatMap(i=>i.unverified_reference_ids),canonical:{...registry,journeys:[]},definitions:childMissing?{workflows:[],activities:[]}:definitions,map:{},assertions:[]});
 const companion=seal({schema_version:1,purpose:'admission_only',scope:child.scope,repo,revision,snapshot:child},'companion_sha256');
 return {snapshot:seal({schema_version:1,scope:'cecelia-kr',repo,revision,status:parentMissing?'unknown':'verified',gaps:parentMissing?(parentGaps??[{code:'definition_snapshot_missing'}]):[],map:{manifest:parentManifest},canonical:{workflows:[],journeys:[]},definitions:{workflows:[],activities:[]},admission_companion:companion})};
}

for(const mode of ['complete','missing-companion','bad-digest','duplicate','traversal'])test('正式resolver真实ZIP及可信校验路径：'+mode,async t=>{
 const f=fixture(t),artifact=f.add(f.base),entry=f.official.get(f.base);const body=bundle(f.base);
 if(mode==='missing-companion'){const {admission_companion,snapshot_sha256,...rest}=body.snapshot;body.snapshot=seal(rest);}
 entry.bytes=execFileSync('python3',['-I','-c',`import io,zipfile,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('head.json',sys.stdin.buffer.read())
 if sys.argv[1]=='duplicate':z.writestr('head.json','{}')
 if sys.argv[1]=='traversal':z.writestr('../outside','x')
sys.stdout.buffer.write(b.getvalue())`,mode],{input:JSON.stringify(body),stdio:['pipe','pipe','pipe']});
 artifact.size_in_bytes=entry.bytes.length;artifact.digest='sha256:'+(mode==='bad-digest'?'0'.repeat(64):hash(entry.bytes));
 delete f.deps.unpack;delete f.deps.validateBundle;
 const tooling=fileURLToPath(new URL('../../../',import.meta.url));f.options.toolingRoot=tooling;
 f.deps.git=(path,...args)=>path===tooling?(args[0]==='status'?'':f.base):f.git(...args);
 if(mode==='complete'){const r=await f.run();assert.equal(r.resolution.effective_base_revision,f.base);assert.deepEqual(Object.keys(r.resolution.scope_hashes),['cecelia-kr','cecelia-factory']);}
 else await assert.rejects(f.run(),{code:mode==='missing-companion'?'PR_BASELINE_SNAPSHOT_INVALID':mode==='bad-digest'?'PR_BASELINE_DIGEST_MISMATCH':'PR_BASELINE_ARCHIVE_INVALID'});
});

test('正式PR入口执行selector且原双scope/固定工具/Skill缓存保留，永久CI加载本测试',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),text=readFileSync(join(root,'.github/workflows/implementation-impact.yml'),'utf8');
 const workflow=yaml.load(text),steps=workflow.jobs.gate.steps,download=steps.find(s=>s.name==='下载固定SHA中央bundle（PR无中央写凭据）');
 assert.match(download.env.NATIVE_PR_BASELINE,/github.event_name == 'pull_request'/);assert.match(download.env.NATIVE_PR_BASELINE,/!inputs.base_revision/);assert.match(download.env.NATIVE_PR_BASELINE,/!inputs.tooling_revision/);
 assert.match(download.run,/node source\/scripts\/ci\/implementation-pr-baseline.mjs/);assert.match(download.run,/BASE=%s/);assert.doesNotMatch(download.run,/TOOLING_REVISION=/);
 const gate=steps.find(s=>s.name==='实际变更影响与固定回归');assert.match(gate.run,/node tooling\/scripts\/ci\/implementation-multi-pr-gate.mjs/);assert.match(gate.run,/--base "\$BASE" --head "\$HEAD"/);
 assert.match(steps.find(s=>s.id==='skill-cache').run,/--prepare-ci-cache "\$GITHUB_WORKSPACE\/source" "\$SOURCE_REPO" "\$BASE" "\$HEAD"/);
 assert.match(readFileSync(join(root,'scripts/ci/__tests__/implementation-main-snapshot.test.mjs'),'utf8'),/import '\.\/implementation-pr-baseline.test.mjs'/);
 const ci=yaml.load(readFileSync(join(root,'.github/workflows/ci.yml'),'utf8'));assert.ok(Object.values(ci.jobs).some(job=>job.steps?.some(s=>s.run?.includes('node --test scripts/ci/__tests__/implementation-main-snapshot.test.mjs'))));
});

// 完整已审consumer仅作为数据；不执行YAML，也不依赖可删除分支的Git对象。
function reviewedConsumers(){
 const require=createRequire(import.meta.url),target=require.resolve('./fixtures/reviewed-impact-consumers.json.gz');
 const extension=Object.getOwnPropertyDescriptor(require.extensions,'.gz'),cache=Object.getOwnPropertyDescriptor(require.cache,target);
 try{
  Object.defineProperty(require.extensions,'.gz',{configurable:true,writable:true,value:(module,filename)=>{
   assert.equal(filename,target);module.exports=readFileSync(filename);
  }});delete require.cache[target];
  const bytes=require('./fixtures/reviewed-impact-consumers.json.gz');
  assert.equal(hash(bytes),'334ed61e5bb1006803f994c257289761ea4adb148bcac79622d8f38b6ca3de2e');
  const data=JSON.parse(gunzipSync(bytes));assert.equal(data.schema_version,1);
  for(const row of [data.legacy,data.typed])assert.equal(hash(row.text),row.sha256);
  assert.equal(data.legacy.sha256,'4e59206bd6dd08b77ea3a59e0feb44a2371ffc0fa9139b81f67e64a0169a9cf9');
  assert.equal(data.typed.sha256,'17d29709a4990f9a0b4c2bbc63ad2dbcb7ce4f2b635a5d1fb416e8239d30f3b6');return data;
 }finally{
  if(extension)Object.defineProperty(require.extensions,'.gz',extension);else delete require.extensions['.gz'];
  if(cache)Object.defineProperty(require.cache,target,cache);else delete require.cache[target];
 }
}
function consumerPair(t,{source='legacy',tooling='legacy',kind='regular'}={}){
 const f=fixture(t),data=reviewedConsumers(),path='.github/workflows/implementation-impact.yml';
 f.git('checkout','--quiet','--detach',f.base);mkdirSync(join(f.root,'.github/workflows'),{recursive:true});
 writeFileSync(join(f.root,path),data[tooling==='changed'?'legacy':tooling].text+(tooling==='changed'?'\n# unreviewed tooling':''));
 f.git('add',path);f.git('-c','core.hooksPath=/dev/null','commit','-qm','fixed tooling consumer');const base=f.git('rev-parse','HEAD');
 const tool=join(f.root,'tooling-checkout');f.git('worktree','add','--quiet','--detach',tool,base);
 if(kind==='symlink'){unlinkSync(join(f.root,path));symlinkSync('missing-workflow',join(f.root,path));}
 else if(kind==='missing')unlinkSync(join(f.root,path));
 else writeFileSync(join(f.root,path),data[source==='changed'?'legacy':source].text+(source==='changed'?'\n# unreviewed source':''));
 writeFileSync(join(f.root,'candidate-change'),'real PR delta');f.git('add','--',path,'candidate-change');f.git('-c','core.hooksPath=/dev/null','commit','-qm','candidate consumer');const head=f.git('rev-parse','HEAD');
 f.event.pull_request.base.sha=base;f.event.pull_request.head.sha=head;f.options.toolingRoot=tool;f.options.toolingRevision=base;
 f.deps.git=(directory,...args)=>execFileSync('git',['--no-replace-objects','-C',directory,...args],{encoding:'utf8'}).trim();
 f.add(base);const api=f.deps.api;
 // 当前namespace有坏CI证据：旧consumer不能消费这种格式，新consumer必须拒绝而不能降级。
 f.deps.api=async path=>path.includes('/artifacts?name=implementation-ci-admission-baseline-')
  ?(f.calls.push(path),{total_count:1,artifacts:[{id:900,name:new URL('https://fixture.invalid/'+path).searchParams.get('name'),expired:false,created_at:'2026-11-01T00:00:00Z'}]})
  :api(path);
 return f;
}
test('完整旧4e source/tooling配对显式选择legacy格式，不把不支持的CI凭据交给旧consumer',async t=>{
 const f=consumerPair(t),r=await f.run();assert.equal(r.resolution.baseline_kind,'legacy_snapshot');assert.equal(r.resolution.consumer_profile,'impact_4e592_v1');
 assert.equal(r.resolution.effective_base_revision,f.event.pull_request.base.sha);assert.equal(r.ciAdmission,undefined);
 assert.equal(f.calls.some(p=>p.includes('implementation-ci-admission-baseline-')),false);
 assert.ok(f.calls.some(p=>p.includes('implementation-snapshot-')));
});
for(const options of [{source:'typed'},{source:'changed'},{tooling:'changed'},{tooling:'typed'},{kind:'symlink'},{kind:'missing'}])test('非完整旧consumer配对仍CI-first且坏CI证据致命：'+JSON.stringify(options),async t=>{
 const f=consumerPair(t,options);await assert.rejects(f.run(),/CI_ADMISSION_/);
 assert.ok(f.calls.some(p=>p.includes('implementation-ci-admission-baseline-')));
 assert.equal(f.calls.some(p=>p.includes('/artifacts?name=implementation-snapshot-')),false);
});
test('环境与未声明的程序参数不能把新consumer改成legacy；CLI不接受格式覆盖开关',async t=>{
 const f=consumerPair(t,{source:'typed'});f.options.baselineFormat='legacy_snapshot';
 const previous=process.env.IMPLEMENTATION_BASELINE_FORMAT;process.env.IMPLEMENTATION_BASELINE_FORMAT='legacy_snapshot';
 try{await assert.rejects(f.run(),/CI_ADMISSION_/);}finally{if(previous===undefined)delete process.env.IMPLEMENTATION_BASELINE_FORMAT;else process.env.IMPLEMENTATION_BASELINE_FORMAT=previous;}
 assert.equal(f.calls.some(p=>p.includes('/artifacts?name=implementation-snapshot-')),false);
 assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('../implementation-pr-baseline.mjs',import.meta.url)),'--baseline-format','legacy_snapshot'],{stdio:['ignore','pipe','pipe']}),error=>error.status===1&&error.stderr.toString().includes('PR_BASELINE_ARGUMENT_INVALID'));
});
