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
async function officialPilotBundle(mutate=()=>{},missing=null){
 const input=source(),repo=input.workspace.repo,files=new Map();
 for(const [name,job,readerName] of [['implementation-impact','impact','implementation-impact'],['pilot-release-verification','verify','pilot-release']]){
  const reader=`scripts/ci/__tests__/${readerName}-workflow.test.mjs`;
  files.set(`${repo}:${reader}`,Buffer.from(`import {test} from 'node:test';import {readFileSync,existsSync} from 'node:fs';import YAML from 'yaml';const file=new URL('../../../.github/workflows/${name}.yml',import.meta.url);function config(){if(!existsSync(file))throw Error('missing');return YAML.parse(readFileSync(file,'utf8'));}test('actual-reader',()=>{config();});`));
  files.set(`${repo}:.github/workflows/${name}.yml`,Buffer.from(`on: {push: {branches: [main]}}\njobs:\n  caller-contract:\n    steps:\n      - run: node --test ${reader}\n  ${job}:\n    needs: caller-contract\n    uses: perfectuser21/cecelia/.github/workflows/${name}.yml@${input.brain.revision}\n    with:\n      source_repo: ${repo}\n      scope: zenithjoy\n      head_revision: \${{ github.sha }}\n      tooling_revision: ${input.brain.revision}\n${name==='implementation-impact'?'      base_revision: ${{ github.event.before }}\n      mode: main\n':''}`));
 }
 const path='.github/workflows/pilot-release-verification.yml',callee=load(currentFile(path).toString());mutate(callee);
 return extractWorkspaceCiSourceBundle({...input,readSource:async q=>{
  if(q.path===missing)throw Error('missing');
  if(q.repo===repo)return files.get(`${repo}:${q.path}`);
  if(q.path===path)return Buffer.from(dump(callee,{lineWidth:-1}));
  return currentFile(q.path);
 }});
}
it('官方Pilot固定初始化器及直接依赖均进入真实来源集合',async()=>{
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
