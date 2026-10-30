import {it,expect} from 'vitest';
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

import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {load,dump} from 'js-yaml';
const root=new URL('../../../../../',import.meta.url);
const currentFile=path=>readFileSync(new URL(path,root));
// 真实官方callee原件仅解析，不执行候选工作流/初始化器。
async function officialPilotBundle(mutate=()=>{},missing=null,{modern=false,changeSource=x=>x,mutateImpact=()=>{}}={}){
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
  if(q.path==='.github/workflows/implementation-impact.yml'){const y=load(currentFile(q.path).toString());mutateImpact(y);return Buffer.from(dump(y,{lineWidth:-1}));}
  return changeSource(currentFile(q.path),q.path);
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
const priorBaseEnv='${{ inputs.base_revision || github.event.pull_request.base.sha || github.event.before }}';
const removeGateToken=y=>delete infraStep(y,'实际变更影响与固定回归').env.GH_TOKEN;
const oldInfraGuard=y=>{
 y.jobs['snapshot-infra'].if=y.jobs['snapshot-infra'].if.replace('inputs.source_baseline_recovery != true && ','');
 y.jobs.gate.env.INFRA_ADMISSION=y.jobs.gate.env.INFRA_ADMISSION.replace('inputs.source_baseline_recovery != true && ','');
 y.jobs.gate.env.BASE=priorBaseEnv;
 removeGateToken(y);
};
it('旧infra封套和新恢复隔离封套均有精确来源证明',async()=>{
 const previous=await modernBundle(()=>{},null,{mutateImpact:oldInfraGuard});
 expect(previous.status,JSON.stringify(previous.gaps)).toBe('verified');
 expect(previous.executable).toBe(false);
 const current=await modernBundle();
 expect(current.status,JSON.stringify(current.gaps)).toBe('verified');
 expect(current.executable).toBe(false);
});
it('新Gate仅接受固定步骤的精确GH_TOKEN来源字节',async()=>{
 const proof=await modernBundle(()=>{},null,{mutateImpact:y=>{infraStep(y,'实际变更影响与固定回归').env.GH_TOKEN='${{ secrets.UNREVIEWED_TOKEN }}';}});
 expect(proof.status).toBe('unknown');
 expect(proof.gaps).toEqual(expect.arrayContaining([expect.objectContaining({code:'CALLEE_INACTIVE_INFRA_UNPROVEN'})]));
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
 const p=await modernBundle(()=>{},null,{mutateImpact:y=>{
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
 const proof=await modernBundle(()=>{},null,{mutateImpact:y=>{
  y.jobs.gate.env.BASE=priorBaseEnv;
  removeGateToken(y);
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
