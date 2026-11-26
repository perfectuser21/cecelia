import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {dockerFixture} from './helpers/brain-candidate-docker.fixture.mjs';
const root=resolve(import.meta.dirname,'../../..');

function fixture(t,fault='',context='mac-studio'){
 const dir=mkdtempSync(join(tmpdir(),'build-timing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const p of ['bin','state','hooks','repo/scripts/lib','repo/packages/brain','repo/logs'])mkdirSync(join(dir,p),{recursive:true});
 const repo=join(dir,'repo');
 for(const p of ['brain-build.sh','lib/brain-candidate-docker.sh'])copyFileSync(join(root,'scripts',p),join(repo,'scripts',p));
 writeFileSync(join(dir,'bin/docker'),`#!${process.execPath}\n${dockerFixture}`,{mode:0o755});
 writeFileSync(join(repo,'packages/brain/package.json'),' {"version":"1.0.0"}\n');
 writeFileSync(join(repo,'packages/brain/Dockerfile'),'FROM scratch\n');
 writeFileSync(join(repo,'marker.txt'),'frozen-source');
 writeFileSync(join(repo,'.gitignore'),'.brain-build-tmp/\nlogs/\n');
 const git=(...args)=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q','-b','main');git('config','core.hooksPath',join(dir,'hooks'));
 git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
 git('add','.');git('commit','-qm','test: build timing fixture');
 const sha=git('rev-parse','HEAD');git('init','-q','--bare',join(dir,'origin.git'));
 git('remote','add','origin',join(dir,'origin.git'));git('push','-q','origin','main');
 for(const host of ['local','mac-studio'])writeFileSync(join(dir,'state',host+'.json'),JSON.stringify({images:{},tags:{},containers:{},network:null}));
 const env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,STATE_DIR:join(dir,'state'),DOCKER_LOG:join(dir,'docker.jsonl'),
  IMAGE:'sha256:'+'b'.repeat(64),OLD_IMAGE:'sha256:'+'d'.repeat(64),EXPECTED_SHA:sha,FAULT:fault,
  BRAIN_CANDIDATE_DOCKER_CONTEXT:context,BRAIN_CANDIDATE_DOCKER_HOST:'',EXPECTED_CANDIDATE_HOST:context||'local',RECEIPT:join(repo,'logs/receipt.json')};
 const result=spawnSync('bash',['scripts/brain-build.sh'],{cwd:repo,env,encoding:'utf8',timeout:30000});
 const events=result.stdout.split('\n').filter(line=>line.startsWith('BUILD_TIMING ')).map(line=>JSON.parse(line.slice('BUILD_TIMING '.length)));
 const commands=readFileSync(env.DOCKER_LOG,'utf8').trim().split('\n').map(JSON.parse);
 return {result,events,sha,commands};
}
function validate(events,sha){
 for(const event of events){assert.equal(event.sha,sha);assert.ok(['image_build','image_transfer'].includes(event.phase));
  if(event.event==='completed')assert.ok(Number.isInteger(event.duration_seconds)&&event.duration_seconds>=0);
  else assert.equal(event.event,'begin');}
}
test('真实候选build和save/load组合按序记录SHA与非负耗时',t=>{
 const f=fixture(t);assert.equal(f.result.status,0,f.result.stderr+f.result.stdout);validate(f.events,f.sha);
 assert.deepEqual(f.events.map(x=>[x.phase,x.event]),[['image_build','begin'],['image_build','completed'],['image_transfer','begin'],['image_transfer','completed']]);
 assert.ok(f.commands.some(x=>x.includes('save')));assert.ok(f.commands.some(x=>x.includes('load')));
});
test('本地真实build只记录构建阶段，不虚构镜像搬运',t=>{
 const f=fixture(t,'','');assert.equal(f.result.status,0,f.result.stderr+f.result.stdout);validate(f.events,f.sha);
 assert.deepEqual(f.events.map(x=>[x.phase,x.event]),[['image_build','begin'],['image_build','completed']]);
});
for(const fault of ['build','partial-build','save','load','remote-sha','local-sha'])test(`真实${fault}失败不能记录对应成功阶段`,t=>{
 const f=fixture(t,fault);assert.notEqual(f.result.status,0,f.result.stderr+f.result.stdout);validate(f.events,f.sha);
 const phase=['build','partial-build','remote-sha'].includes(fault)?'image_build':'image_transfer';
 assert.ok(f.events.some(x=>x.phase===phase&&x.event==='begin'),'失败阶段必须可定位');
 assert.equal(f.events.some(x=>x.phase===phase&&x.event==='completed'),false);
 assert.equal(f.result.stdout.includes('=== Build complete ==='),false);
});
