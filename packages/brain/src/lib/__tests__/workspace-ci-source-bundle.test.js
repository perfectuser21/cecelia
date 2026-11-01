import {it,expect,afterAll} from 'vitest';
import {extractWorkspaceCiSourceBundle,F3_IDENTITY} from '../workspace-ci-source-bundle.js';

const source=()=>({workspace:{repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)},brain:{repo:'perfectuser21/cecelia',revision:'b'.repeat(40)},identity:{...F3_IDENTITY}});
it('错误既有F3身份不能偷偷创建另一Activity，且不读取任何源码',async()=>{
 let reads=0;const options=source();options.identity.activity_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const result=await extractWorkspaceCiSourceBundle({...options,readSource:async()=>{reads++;throw Error('unexpected_source_read');}});
 expect(result.status).toBe('unknown');expect(result.gaps).toEqual(expect.arrayContaining([expect.objectContaining({code:'F3_IDENTITY_MISMATCH'})]));
 expect(result.executable).toBe(false);expect(reads).toBe(0);
});
it('未固定source SHA不读任何源码，保持unknown且不可执行',async()=>{
 let reads=0;const options=source();options.workspace.revision='main';
 const result=await extractWorkspaceCiSourceBundle({...options,readSource:async()=>{reads++;throw Error('unexpected_source_read');}});
 expect(result.status).toBe('unknown');expect(result.gaps).toEqual(expect.arrayContaining([expect.objectContaining({code:'SOURCE_IDENTITY_INVALID'})]));
 expect(result.executable).toBe(false);expect(reads).toBe(0);
});

import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {load,dump} from 'js-yaml';
import {execFileSync} from 'node:child_process';
import {futureCiAdmissionImpactWorkflow} from '../../../../../scripts/ci/__tests__/fixtures/ci-admission-impact-workflow.mjs';
import {readFixedLocalGitBlob} from '../../../../../scripts/ci/fixed-local-git.mjs';
const root=new URL('../../../../../',import.meta.url);
// 未来协议只读已审原始数据；旧Core CI阶段的实际路由保持固定main原件。
const currentFile=path=>path==='.github/workflows/implementation-impact.yml'?Buffer.from(futureCiAdmissionImpactWorkflow):readFileSync(new URL(path,root));
const PUBLISHED='b217cd52336767b9637410ef921397a0e9297f2b';
const require=createRequire(import.meta.url);
const publishedObjects=require('./helpers/published-workspace-ci-git.json');
function createPublishedGit(){
 const directory=mkdtempSync(join(tmpdir(),'workspace-published-git-'));
 const close=()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:20});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 Object.assign(env,{GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:''});
 const command=(args,input)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','maintenance.auto=false','-c','gc.auto=0',...args],{cwd:directory,env,input,stdio:['pipe','pipe','pipe']});
 const git=(...args)=>command(args);
 try{
  expect(publishedObjects.schema_version).toBe(1);expect(publishedObjects.revision).toBe(PUBLISHED);
  expect(publishedObjects.objects).toHaveLength(8);
  expect(publishedObjects.files).toEqual([
   {path:'.github/workflows/implementation-impact.yml',sha1:'5a43bfd48709018ee641952747b15f3c949099f2'},
   {path:'scripts/ci/implementation-skill-source.mjs',sha1:'2351ae6a69b066a7e15dbb17e2e6babc13a31305'},
  ]);
  git('init','--quiet');
  for(const object of publishedObjects.objects){
   expect(['commit','tree','blob']).toContain(object.type);const bytes=Buffer.from(object.content_base64,'base64');
   expect(createHash('sha1').update(`${object.type} ${bytes.length}\0`).update(bytes).digest('hex')).toBe(object.sha1);
   expect(command(['hash-object','-w','-t',object.type,'--stdin'],bytes).toString().trim()).toBe(object.sha1);
  }
  expect(git('rev-parse',PUBLISHED+'^{tree}').toString().trim()).toBe(publishedObjects.tree);
  return {directory,git,env,close};
 }catch(error){close();throw error;}
}
const published=createPublishedGit();afterAll(()=>published.close());
const publishedFile=(path,gitRoot=published.directory)=>readFixedLocalGitBlob(gitRoot,{revision:PUBLISHED,path});
function isolatedPublishedGit(consume){const fixture=createPublishedGit();try{return consume(fixture);}finally{fixture.close();}}
const expectPublishedHelper=bytes=>expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe('2351ae6a69b066a7e15dbb17e2e6babc13a31305');
it('固定published夹具自包含真实commit/tree与两blob，不依赖当前仓历史或远端',()=>{
 isolatedPublishedGit(({directory,git})=>{
  expect(existsSync(join(directory,'.git/objects/info/alternates'))).toBe(false);
  expect(()=>git('remote','get-url','origin')).toThrow();
  expectPublishedHelper(publishedFile('scripts/ci/implementation-skill-source.mjs',directory));
  const workflow=publishedFile('.github/workflows/implementation-impact.yml',directory);
  expect(createHash('sha1').update(`blob ${workflow.length}\0`).update(workflow).digest('hex')).toBe('5a43bfd48709018ee641952747b15f3c949099f2');
 });
});
it('历史原件读取禁用真实refs/replace，不把被替换缺文件当canonical缺失',()=>{
 isolatedPublishedGit(({directory,git,env})=>{
  const tree=execFileSync('git',['mktree'],{cwd:directory,env,input:''}).toString().trim();
  const forged=execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-p',PUBLISHED],{cwd:directory,env,input:'isolated replacement\n'}).toString().trim();
  git('replace',PUBLISHED,forged);
  expect(()=>execFileSync('git',['show',PUBLISHED+':scripts/ci/implementation-skill-source.mjs'],{cwd:directory,env,stdio:'pipe'})).toThrow();
  expectPublishedHelper(publishedFile('scripts/ci/implementation-skill-source.mjs',directory));
 });
});
it('历史原件读取隔离继承的GIT_DIR与GIT_WORK_TREE，仍返回同一固定Git blob',()=>{
 isolatedPublishedGit(({directory})=>{
  const prior=Object.fromEntries(['GIT_DIR','GIT_WORK_TREE','GIT_OBJECT_DIRECTORY'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,{GIT_DIR:join(directory,'.git'),GIT_WORK_TREE:directory});
  try{
   // 该私有仓库故意没有工作树文件，调用仍须读取canonical固定对象。
   process.env.GIT_OBJECT_DIRECTORY=join(directory,'unavailable-objects');
   expectPublishedHelper(publishedFile('scripts/ci/implementation-skill-source.mjs'));
  }finally{
   for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
 });
});
// 真实官方callee原件仅解析，不执行候选工作流/初始化器。
async function officialPilotBundle(mutate=()=>{},missing=null,{modern=false,changeSource=x=>x,mutateImpact=()=>{},historical=false,impactText=null,helperBytes=null}={}){
 const input=source(),repo=input.workspace.repo,files=new Map();
 for(const [name,job,readerName] of [['implementation-impact','impact','implementation-impact'],['pilot-release-verification','verify','pilot-release']]){
  const reader=`scripts/ci/__tests__/${readerName}-workflow.test.mjs`;
  files.set(`${repo}:${reader}`,Buffer.from(`import {test} from 'node:test';import {readFileSync,existsSync} from 'node:fs';import YAML from 'yaml';const file=new URL('../../../.github/workflows/${name}.yml',import.meta.url);function config(){if(!existsSync(file))throw Error('missing');return YAML.parse(readFileSync(file,'utf8'));}test('actual-reader',()=>{config();});`));
  files.set(`${repo}:.github/workflows/${name}.yml`,Buffer.from(`on: {push: {branches: [main]}}\njobs:\n  caller-contract:\n    steps:\n      - run: node --test ${reader}\n  ${job}:\n    needs: caller-contract\n    uses: perfectuser21/cecelia/.github/workflows/${name}.yml@${input.brain.revision}\n    with:\n      source_repo: ${repo}\n      scope: zenithjoy\n      head_revision: \${{ github.sha }}\n      tooling_revision: ${input.brain.revision}\n${name==='implementation-impact'?'      base_revision: ${{ github.event.before }}\n      mode: main\n':''}`));
 }
 const path='.github/workflows/pilot-release-verification.yml',callee=load(currentFile(path).toString());
 if(!modern){const step=callee.jobs.verify.steps.find(s=>String(s.run||'').includes('tooling/scripts/ci/implementation-skill-source.mjs'));step.run='set -euo pipefail\nnode tooling/scripts/ci/prepare-fixed-skill-cache.mjs --repo-root "$PWD/source" --snapshot "$PWD/snapshot/head.json"\n';}
 mutate(callee);
 return extractWorkspaceCiSourceBundle({...input,readSource:async q=>{
  if(q.path===missing)throw Error('missing');
  if(q.repo===repo)return files.get(`${repo}:${q.path}`);
  if(q.path===path)return Buffer.from(dump(callee,{lineWidth:-1}));
  if(q.path==='.github/workflows/implementation-impact.yml'){const y=load((impactText??(historical?publishedFile(q.path):currentFile(q.path))).toString());mutateImpact(y);return Buffer.from(dump(y,{lineWidth:-1}));}
  return changeSource(q.path==='scripts/ci/implementation-skill-source.mjs'?(helperBytes??(historical?publishedFile(q.path):currentFile(q.path))):currentFile(q.path),q.path);
 }});
}
it('旧官方Pilot固定初始化器及直接依赖均进入真实来源集合',async()=>{
 const proof=await officialPilotBundle();expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
 for(const path of ['scripts/ci/prepare-fixed-skill-cache.mjs','scripts/ci/fixed-local-git.mjs','packages/brain/src/lib/implementation-ci-snapshot.js'])expect(proof.consumer.bindings).toContainEqual(expect.objectContaining({repo:'perfectuser21/cecelia',revision:'b'.repeat(40),path,content_sha256:createHash('sha256').update(currentFile(path)).digest('hex')}));
});
const initStep=y=>y.jobs.verify.steps.find(s=>String(s.run||'').includes('tooling/scripts/ci/prepare-fixed-skill-cache.mjs'));
it.each([
 ['unknown runner',y=>y.jobs.verify.steps.push({run:'node tooling/scripts/ci/unreviewed.mjs'})],
 ['changed command',y=>initStep(y).run+='echo unsafe\n'],
 ['wrong secret',y=>initStep(y).env.SKILLS_SOURCE_SSH_KEY='${{ secrets.FOREIGN_KEY }}'],
 ['extra env',y=>initStep(y).env.GIT_SSH_COMMAND='unsafe'],
 ['conditional',y=>initStep(y).if='always()'],
 ['continue on error',y=>initStep(y)['continue-on-error']=true],
 ['working directory',y=>initStep(y)['working-directory']='candidate'],
 ['job defaults',y=>y.jobs.verify.defaults={run:{'working-directory':'candidate'}}],
 ['missing secret declaration',y=>delete y.on.workflow_call.secrets.SKILLS_SOURCE_SSH_KEY],
 ['changed secret contract',y=>y.on.workflow_call.secrets.SKILLS_SOURCE_SSH_KEY.required=true],
 ['source shallow',y=>y.jobs.verify.steps.find(s=>s.with?.path==='source').with['fetch-depth']=1],
 ['source wrong ref',y=>y.jobs.verify.steps.find(s=>s.with?.path==='source').with.ref='main'],
 ['source wrong repo',y=>y.jobs.verify.steps.find(s=>s.with?.path==='source').with.repository='foreign/repo'],
 ['source credentials',y=>y.jobs.verify.steps.find(s=>s.with?.path==='source').with['persist-credentials']=true],
 ['snapshot wrong path',y=>y.jobs.verify.steps.find(s=>s.uses?.startsWith('actions/download-artifact@')).with.path='foreign'],
 ['snapshot wrong name',y=>y.jobs.verify.steps.find(s=>s.uses?.startsWith('actions/download-artifact@')).with.name='latest'],
 ['initializer after runner',y=>{const steps=y.jobs.verify.steps,i=steps.indexOf(initStep(y));steps.push(...steps.splice(i,1));}],
 ['duplicate initializer',y=>y.jobs.verify.steps.push(structuredClone(initStep(y)))],
])('初始化器%s必须拒绝',async(_name,mutate)=>{const proof=await officialPilotBundle(mutate);expect(proof.status).toBe('unknown');expect(proof.executable).toBe(false);});
it.each(['scripts/ci/prepare-fixed-skill-cache.mjs','scripts/ci/fixed-local-git.mjs','packages/brain/src/lib/implementation-ci-snapshot.js'])('缺固定初始化依赖%s保持unknown',async path=>{const proof=await officialPilotBundle(()=>{},path);expect(proof.status).toBe('unknown');});

const MODERN='scripts/ci/implementation-skill-source.mjs';
const modernInputs=[MODERN,'scripts/ci/fixed-local-git.mjs','packages/brain/src/lib/implementation-ci-snapshot.js','packages/brain/src/lib/device-patrol-admission.js'];
const modernStep=(y,job='verify')=>y.jobs[job].steps.find(s=>String(s.run||'').includes('tooling/'+MODERN));
const modernBundle=(mutate=()=>{},missing=null,options={})=>officialPilotBundle(mutate,missing,{...options,modern:true});
it('真实现代Pilot与Impact完整缓存封套及三直接imports冻结，来源证明仍非执行或main信任',async()=>{
 const proof=await modernBundle();expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
 expect(proof.admission.status).toBe('unknown');expect(proof.executable).toBe(false);
 for(const name of ['pilot-release-verification','implementation-impact'])for(const path of modernInputs)expect(proof.consumer.input_relations).toContainEqual(expect.objectContaining({consumer:expect.objectContaining({path:`.github/workflows/${name}.yml`}),input:expect.objectContaining({path}),kind:'fixed_job_node_source'}));
 for(const path of modernInputs){expect(proof.consumer.bindings).toContainEqual(expect.objectContaining({repo:'perfectuser21/cecelia',revision:'b'.repeat(40),path,content_sha256:createHash('sha256').update(currentFile(path)).digest('hex')}));
 }

});
it.each(modernInputs)('现代缓存缺真实固定输入%s必须unknown',async path=>{const proof=await modernBundle(()=>{},path);expect(proof.status).toBe('unknown');expect(proof.executable).toBe(false);});
const modernMutations=[
 ['remove initializer',y=>{const s=modernStep(y);y.jobs.verify.steps.splice(y.jobs.verify.steps.indexOf(s),1);}],
 ['changed shell',y=>modernStep(y).run+='echo unsafe\n'],
 ['commented initializer',y=>modernStep(y).run=modernStep(y).run.split('\n').map(x=>'#'+x).join('\n')],
 ['wrong secret',y=>modernStep(y).env.SKILLS_SOURCE_SSH_KEY='${{ secrets.FOREIGN_KEY }}'],
 ['secret leaked to runner',y=>y.jobs.verify.steps.find(s=>String(s.run||'').includes('tooling/scripts/ci/pilot-release-verification.mjs')).env.SKILLS_SOURCE_SSH_KEY='${{ secrets.SKILLS_SOURCE_SSH_KEY }}'],
 ['aliased runner secret',y=>y.jobs.verify.steps.find(s=>String(s.run||'').includes('tooling/scripts/ci/pilot-release-verification.mjs')).env.OTHER_KEY='${{ secrets.SKILLS_SOURCE_SSH_KEY }}'],
 ['job NODE_OPTIONS',y=>y.jobs.verify.env.NODE_OPTIONS='--import ./candidate.mjs'],
 ['global NODE_OPTIONS',y=>y.env={NODE_OPTIONS:'--import ./candidate.mjs'}],
 ['job secret',y=>y.jobs.verify.env.SKILLS_SOURCE_SSH_KEY='${{ secrets.SKILLS_SOURCE_SSH_KEY }}'],
 ['extra env',y=>modernStep(y).env.GIT_SSH_COMMAND='unsafe'],
 ['conditional',y=>modernStep(y).if='always()'],
 ['continue on error',y=>modernStep(y)['continue-on-error']=true],
 ['working directory',y=>modernStep(y)['working-directory']='candidate'],
 ['shell override',y=>modernStep(y).shell='bash'],
 ['job defaults',y=>y.jobs.verify.defaults={run:{shell:'bash'}}],
 ['wrong repo env',y=>y.jobs.verify.env.SOURCE_REPO='foreign/repo'],
 ['wrong head env',y=>y.jobs.verify.env.HEAD='main'],
 ['missing secret declaration',y=>delete y.on.workflow_call.secrets.SKILLS_SOURCE_SSH_KEY],
 ['shallow source',y=>y.jobs.verify.steps.find(s=>s.with?.path==='source').with['fetch-depth']=1],
 ['wrong artifact',y=>y.jobs.verify.steps.find(s=>s.uses?.startsWith('actions/download-artifact@')).with.name='latest'],
 ['initializer before snapshot',y=>{const a=y.jobs.verify.steps,i=a.indexOf(modernStep(y));a.unshift(...a.splice(i,1));}],
 ['initializer after runner',y=>{const a=y.jobs.verify.steps,i=a.indexOf(modernStep(y));a.push(...a.splice(i,1));}],
 ['duplicate initializer',y=>y.jobs.verify.steps.push(structuredClone(modernStep(y)))],
 ['mixed old initializer',y=>y.jobs.verify.steps.push({run:'node tooling/scripts/ci/prepare-fixed-skill-cache.mjs --repo-root source'})],
 ['wrong cache output',y=>modernStep(y).run=modernStep(y).run.replace('IMPLEMENTATION_SKILLS_SOURCE_DIR','SKILLS_SOURCE_DIR')],
 ['untrusted loader',y=>modernStep(y).run=modernStep(y).run.replace('node tooling/'+MODERN,'python3 source/scripts/skills-source.py')],
];
it.each(modernMutations)('现代Pilot%s必须unknown',async(_name,mutate)=>{const p=await modernBundle(mutate);expect(p.status).toBe('unknown');expect(p.executable).toBe(false);});
it.each([
 ['missing initializer',y=>{const s=modernStep(y,'gate');y.jobs.gate.steps.splice(y.jobs.gate.steps.indexOf(s),1);}],
 ['changed shell',y=>modernStep(y,'gate').run+='echo unsafe\n'],
 ['download replaced',y=>y.jobs.gate.steps.find(s=>String(s.run||'').includes('implementation-baseline-$HEAD')).run='echo implementation-baseline-$HEAD'],
 ['download wrong run',y=>y.jobs.gate.steps.find(s=>String(s.run||'').includes('implementation-baseline-$HEAD')).env.RUN_ID='other'],
 ['download after initializer',y=>{const a=y.jobs.gate.steps,i=a.findIndex(s=>String(s.run||'').includes('implementation-baseline-$HEAD'));a.push(...a.splice(i,1));}],
 ['job NODE_OPTIONS',y=>y.jobs.gate.env.NODE_OPTIONS='--import ./candidate.mjs'],
 ['wrong base',y=>y.jobs.gate.env.BASE='main'],
 ['wrong mode',y=>y.jobs.gate.env.MODE='pr'],
 ['wrong head',y=>y.jobs.gate.env.HEAD='main'],
 ['wrong source',y=>y.jobs.gate.env.SOURCE_REPO='foreign/repo'],
 ['wrong tooling',y=>y.jobs.gate.env.TOOLING_REVISION='main'],
 ['native override',y=>modernStep(y,'gate').env.NATIVE_PR='true'],
 ['unconditional runner key',y=>y.jobs.gate.steps.find(s=>s.name==='实际变更影响与固定回归').env.SKILLS_SOURCE_SSH_KEY='${{ secrets.SKILLS_SOURCE_SSH_KEY }}'],
 ['duplicate initializer',y=>y.jobs.gate.steps.push(structuredClone(modernStep(y,'gate')))],
 ['after runner',y=>{const a=y.jobs.gate.steps,i=a.indexOf(modernStep(y,'gate'));a.push(...a.splice(i,1));}],
])('现代Impact%s必须unknown',async(_name,mutate)=>{const p=await modernBundle(()=>{},null,{mutateImpact:mutate});expect(p.status).toBe('unknown');});
it.each([
 ['deadline',s=>s.replace('Date.now()+60000','Date.now()+600000')],
 ['metadata limit',s=>s.replace('4*1024*1024','40*1024*1024')],
 ['history source',s=>s.replace('business.add(row.source_commit)','business.add(revisions.at(-1))')],
 ['HEAD materialize',s=>s.replace('materializeImplementationSkills(realpathSync(root),revisions.at(-1)','materializeImplementationSkills(realpathSync(root),revisions[0]')],
 ['extra import',s=>s+"\nimport './unreviewed.mjs';\n"],
])('现代helper%s漂移不能冒已审源码封套',async(_name,change)=>{const p=await modernBundle(()=>{},null,{changeSource:(bytes,path)=>path===MODERN?Buffer.from(change(bytes.toString())):bytes});expect(p.status).toBe('unknown');});

const infraStep=(y,name)=>y.jobs.gate.steps.find(s=>s.name===name);
const sourceNodeStep=y=>infraStep(y,'来源机制完整单元回归');
const nativeSourceOnly="github.repository == 'perfectuser21/cecelia' && (!inputs.source_repo || inputs.source_repo == github.repository)";
it('真实四Node入口仅在Cecelia源码checkout执行，跨仓完整封套证明其不可达',async()=>{
 const workflow=load(currentFile('.github/workflows/implementation-impact.yml').toString());
 expect(sourceNodeStep(workflow).if).toBe(nativeSourceOnly);
 const proof=await modernBundle();expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
 expect(proof.consumer.bindings.some(b=>b.path==='scripts/ci/__tests__/implementation-main-snapshot.test.mjs')).toBe(false);
 expect(proof.executable).toBe(false);expect(proof.admission.status).toBe('unknown');
});
it.each([
 ['缺条件',y=>{delete sourceNodeStep(y).if;}],['恒真',y=>{sourceNodeStep(y).if='true';}],
 ['恒假',y=>{sourceNodeStep(y).if='false';}],['假source条件',y=>{sourceNodeStep(y).if="inputs.source_repo == 'perfectuser21/cecelia'";}],
 ['放宽source条件',y=>{sourceNodeStep(y).if="github.repository == 'perfectuser21/cecelia'";}],
 ['替换命令',y=>{sourceNodeStep(y).run+=' --test-only';}],['错cwd',y=>{sourceNodeStep(y)['working-directory']='tooling';}],
 ['注入env',y=>{sourceNodeStep(y).env={NODE_OPTIONS:'--import ./fake.mjs'};}],
 ['容错',y=>{sourceNodeStep(y)['continue-on-error']=true;}],['shell覆盖',y=>{sourceNodeStep(y).shell='bash';}],
 ['错位置',y=>{const steps=y.jobs.gate.steps;steps.push(...steps.splice(steps.indexOf(sourceNodeStep(y)),1));}],
])('四Node跨仓隔离%s不能借新封套取得来源资格',async(_name,mutateImpact)=>{
 const proof=await modernBundle(()=>{},null,{mutateImpact});
 expect(proof.status).toBe('unknown');expect(proof.workflow_coverage.verified_reference_ids).toEqual([]);expect(proof.executable).toBe(false);
});
const priorBaseEnv='${{ inputs.base_revision || github.event.pull_request.base.sha || github.event.before }}';
const priorSourceNode=y=>{y.jobs.gate.steps=y.jobs.gate.steps.filter(s=>s.name!=='来源机制完整单元回归');};
const oldInfraGuard=y=>{
 priorSourceNode(y);
 y.jobs['snapshot-infra'].if=y.jobs['snapshot-infra'].if.replace('inputs.source_baseline_recovery != true && ','');
 y.jobs.gate.env.INFRA_ADMISSION=y.jobs.gate.env.INFRA_ADMISSION.replace('inputs.source_baseline_recovery != true && ','');
 y.jobs.gate.env.BASE=priorBaseEnv;
};
it('旧infra封套和新恢复隔离封套均有精确来源证明',async()=>{
 const previous=await modernBundle(()=>{},null,{mutateImpact:oldInfraGuard,historical:true});
 expect(previous.status,JSON.stringify(previous.gaps)).toBe('verified');
 expect(previous.executable).toBe(false);
 const current=await modernBundle();
 expect(current.status,JSON.stringify(current.gaps)).toBe('verified');
 expect(current.executable).toBe(false);
});
it.each([
 ['旧gate配新provider',y=>{y.jobs.gate.env.INFRA_ADMISSION=y.jobs.gate.env.INFRA_ADMISSION.replace('inputs.source_baseline_recovery != true && ','');}],
 ['新gate配旧provider',y=>{y.jobs['snapshot-infra'].if=y.jobs['snapshot-infra'].if.replace('inputs.source_baseline_recovery != true && ','');}],
])('%s不能拼接成已审infra封套',async(_name,mutateImpact)=>{
 const proof=await modernBundle(()=>{},null,{mutateImpact});
 expect(proof.status).toBe('unknown');
 expect(proof.gaps).toEqual(expect.arrayContaining([expect.objectContaining({code:'CALLEE_INACTIVE_INFRA_UNPROVEN'})]));
});
it('infra默认关闭的真实跨仓callee完整提取，第三来源不冒执行或main信任',async()=>{
 const p=await modernBundle();expect(p.status,JSON.stringify(p.gaps)).toBe('verified');
 expect(p.consumer.status).toBe('verified');expect(p.executable).toBe(false);expect(p.admission.status).toBe('unknown');
 expect(p.consumer.bindings.some(b=>b.path==='scripts/ci/implementation-infra-inputs.mjs')).toBe(false);
});
it.each([
 ['missing dependency',y=>y.jobs.gate.needs=['snapshot-main']],
 ['unknown dependency',y=>y.jobs.gate.needs=['snapshot-main','foreign']],
 ['third dependency',y=>y.jobs.gate.needs.push('foreign')],
 ['missing provider',y=>delete y.jobs['snapshot-infra']],
 ['wrong provider repo',y=>y.jobs['snapshot-infra'].steps.find(s=>s.uses==='actions/checkout@v4').with.repository='foreign/repo'],
 ['unrestricted provider',y=>y.jobs['snapshot-infra'].if='always()'],
 ['forced switch',y=>y.jobs.gate.env.INFRA_ADMISSION='true'],
 ['missing switch',y=>delete y.jobs.gate.env.INFRA_ADMISSION],
 ['wrong switch repo',y=>y.jobs.gate.env.INFRA_ADMISSION=y.jobs.gate.env.INFRA_ADMISSION.replace('perfectuser21/cecelia','perfectuser21/zenithjoy-workspace')],
 ['cache mutation',y=>modernStep(y,'gate').run+='echo changed\n'],
 ['unconditional input',y=>delete infraStep(y,'独立infra固定来源加入联合输入').if],
 ['changed input',y=>infraStep(y,'独立infra固定来源加入联合输入').run+='echo changed\n'],
 ['missing joint guard',y=>y.jobs.gate.steps.splice(y.jobs.gate.steps.indexOf(infraStep(y,'三来源联合门真实PG与回归退出码守卫')),1)],
 ['unconditional joint guard',y=>delete infraStep(y,'三来源联合门真实PG与回归退出码守卫').if],
 ['scope override',y=>infraStep(y,'完整联合scope清单加入infra').run+='echo changed\n'],
])('infra跨仓精确形态%s保持unknown',async(_name,mutateImpact)=>{
 const p=await modernBundle(()=>{},null,{mutateImpact});expect(p.status).toBe('unknown');expect(p.executable).toBe(false);
});

it('保留原双scope单needs与旧cache完整封套',async()=>{
 const p=await modernBundle(()=>{},null,{historical:true,mutateImpact:y=>{
  priorSourceNode(y);
  y.jobs.gate.env.BASE=priorBaseEnv;
  delete y.jobs['snapshot-infra'];delete y.on.workflow_dispatch.inputs.export_infra_baseline;
  y.jobs.gate.needs=['snapshot-main'];delete y.jobs.gate.env.INFRA_ADMISSION;
  y.jobs.gate.steps=y.jobs.gate.steps.filter(s=>!['三来源联合门真实PG与回归退出码守卫','独立infra固定来源加入联合输入','完整联合scope清单加入infra'].includes(s.name));
  const init=modernStep(y,'gate');
  init.run=init.run.replace("IMPLEMENTATION_MAIN_SCOPES='' node",'IMPLEMENTATION_MAIN_SCOPES= node').replace('  if [[ "$INFRA_ADMISSION" == true ]]; then\n    args+=(--snapshot "$RUNNER_TEMP/implementation-input/base/base-cecelia-infra.json" --snapshot "$RUNNER_TEMP/implementation-input/head/head-cecelia-infra.json")\n  fi\n','');
  expect(createHash('sha256').update(init.run).digest('hex')).toBe('0c63a85850a5c2f0b78206b08737ff1b459c14bfbcdb7f9485aa854920287d36');
 }});expect(p.status,JSON.stringify(p.gaps)).toBe('verified');expect(p.executable).toBe(false);
});

const baselineDownload=y=>y.jobs.gate.steps.find(s=>String(s.run||'').includes('implementation-baseline-$HEAD'));
it('旧精确下载封套仍可证明外部调用，原生祖先恢复不改变workspace分支',async()=>{
 const proof=await modernBundle(()=>{},null,{historical:true,mutateImpact:y=>{
  priorSourceNode(y);
  y.jobs.gate.env.BASE=priorBaseEnv;
  const step=baselineDownload(y),start=step.run.indexOf('  if [[ "${NATIVE_PR_BASELINE:-false}" == true ]]; then\n'),end=step.run.indexOf('  else\n',start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  step.run=step.run.slice(0,start)+step.run.slice(end+7);
  step.run=step.run.replace('  fi\n  if [[ -n "${ADMISSION_SCOPES:-}" ]]','  if [[ -n "${ADMISSION_SCOPES:-}" ]]');
  expect(createHash('sha256').update(step.run).digest('hex')).toBe('51c728cdec33a877e94b11bfbd88eecb472ba24221ccf23d1b0d2c90a1fc2ca7');
  delete step.env.NATIVE_PR_BASELINE;
 }});
 expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');expect(proof.executable).toBe(false);
});
it.each([
 ['强开原生分支',y=>baselineDownload(y).env.NATIVE_PR_BASELINE='true'],
 ['缺原生边界',y=>delete baselineDownload(y).env.NATIVE_PR_BASELINE],
 ['放宽来源输入',y=>baselineDownload(y).env.NATIVE_PR_BASELINE=baselineDownload(y).env.NATIVE_PR_BASELINE.replace(' && !inputs.source_repo','')],
 ['替换祖先选择器',y=>baselineDownload(y).run=baselineDownload(y).run.replace('node source/scripts/ci/implementation-pr-baseline.mjs','node source/foreign.mjs')],
])('原生基线封套%s必须保持unknown',async(_name,mutateImpact)=>{
 const proof=await modernBundle(()=>{},null,{mutateImpact});expect(proof.status).toBe('unknown');expect(proof.executable).toBe(false);
});
it('未来完整typed gate与新共享helper仅证明foreign legacy分支，旧main新helper单独兼容',async()=>{
 for(const impactText of [null,publishedFile('.github/workflows/implementation-impact.yml')]){
  const proof=await modernBundle(()=>{},null,{impactText});expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
  expect(proof.executable).toBe(false);expect(proof.admission.status).toBe('unknown');
  expect(proof.consumer.bindings.some(b=>b.path==='scripts/ci/ci-admission-inputs.mjs')).toBe(false);
 }
});
it('已审第六native-only封套和旧helper继续整组接受',async()=>{
 const doc=load(publishedFile('.github/workflows/implementation-impact.yml').toString()),steps=doc.jobs.gate.steps;
 const at=steps.findIndex(s=>s.run==='npm ci --ignore-scripts'&&s['working-directory']==='source');
 steps.splice(at+1,0,structuredClone(load(currentFile('.github/workflows/implementation-impact.yml').toString()).jobs.gate.steps.find(s=>s.name==='来源机制完整单元回归')));
 const proof=await modernBundle(()=>{},null,{impactText:dump(doc),helperBytes:publishedFile(MODERN)});
 expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
});
it.each([
 ['未来gate混旧helper',{helperBytes:publishedFile(MODERN)}],
 ['新helper混非当前旧gate',{impactText:publishedFile('.github/workflows/implementation-impact.yml'),mutateImpact:oldInfraGuard}],
 ['强开foreign typed环境',{mutateImpact:y=>{y.jobs.gate.env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR='/fake';}}],
 ['新增credential入口',{mutateImpact:y=>{modernStep(y,'gate').env.GH_TOKEN='${{ secrets.FOREIGN_TOKEN }}';}}],
 ['未知helper AST',{changeSource:(b,p)=>p===MODERN?Buffer.from(b+'\nexport const unknown=true;'):b}],
])('新tuple拒绝%s',async(_name,options)=>{
 const proof=await modernBundle(()=>{},null,options);expect(proof.status).toBe('unknown');expect(proof.executable).toBe(false);
});
it('Pilot新helper必须绑定完整已审job，不能用额外GITHUB_ENV步骤解锁typed分支',async()=>{
 const proof=await modernBundle(y=>{y.jobs.verify.steps.unshift({run:'echo IMPLEMENTATION_CI_ADMISSION_INPUT_DIR=/fake >> "$GITHUB_ENV"'});});
 expect(proof.status).toBe('unknown');expect(proof.executable).toBe(false);
});
