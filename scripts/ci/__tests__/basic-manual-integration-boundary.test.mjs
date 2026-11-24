import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const previews=[
 ['INVOCATION_BROWSER_PREVIEW','invocation-browser-preview.test.js'],
 ['AUTHORING_BROWSER_PREVIEW','authoring-browser-preview.pg.integration.test.js'],
 ['META_NATIVE_BROWSER','workflow-assembly-native-browser.pg.integration.test.js'],
];
const mixed=['workflow-authoring-execution.pg.integration.test.js','invocations.pg.integration.test.js'];
const realNames=['固定Git纯Skill经实际Codex与默认HTTPdriver完成资格，真实目录调用回读ABC','Activity单调和Workflow整调经真实Codex进程产生结构化输出'];
const ordinaryNames=['实际HTTP compose入口自动冻结候选并幂等排队，无需人工提交build或抄验证任务ID','按同请求键并发只建一个原生路由任务，异输入409，原键可查'];
const flags=[...previews.map(([flag])=>flag),'AUTHORING_REAL_CODEX','INVOCATION_REAL_CODEX'];
function inspect(mode, enabled={}){
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
  NODE_ENV:'test',CI:'true',POSTGRES_INTEGRATION:'1',DB_NAME:'cecelia_scratch',DB_HOST:'127.0.0.1',DB_PORT:'1',
  ...Object.fromEntries(flags.map(flag=>[flag,'0'])),...enabled};
 const program=`
  import {createVitest} from './packages/brain/node_modules/vitest/dist/node.js';
  const ctx=await createVitest('test',{root:${JSON.stringify(root+'packages/brain')},config:${JSON.stringify(root+'scripts/ci/deep-integration.config.mjs')},watch:false,reporters:[],
   testNamePattern:'^__CI_COLLECTION_ONLY_NO_EXECUTION__$'});
  try{
   const files=(await ctx.globTestFiles()).map(([,file])=>file);
   let names=[];
   if(${JSON.stringify(mode)}==='collect'){
    await ctx.start(${JSON.stringify(mixed)});
    const visit=task=>{if(task.type==='test')names.push(task.name);for(const child of task.tasks??[])visit(child);};
    ctx.state.getFiles().forEach(visit);
    const errors=ctx.state.getUnhandledErrors();if(errors.length)throw Error(errors.map(e=>e.message).join(';'));
   }
   console.log('BOUNDARY_RESULT='+JSON.stringify({files,names}));
  }finally{await ctx.close();}
 `;
 const output=execFileSync(process.execPath,['--input-type=module','-e',program],{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 const result=output.split('\n').find(line=>line.startsWith('BOUNDARY_RESULT='));
 assert.ok(result,'真实Vitest必须返回发现/收集结果');
 return JSON.parse(result.slice('BOUNDARY_RESULT='.length));
}

test('默认deep发现排除长驻preview和退役radius专项，保留现役PG合同',()=>{
 const {files}=inspect('glob');
 for(const [,name] of previews)assert.ok(!files.some(file=>file.endsWith('/'+name)),`默认不应发现长驻服务 ${name}`);
 assert.ok(!files.some(file=>file.endsWith('/rerun-gate-radius.integration.test.js')),'退役radius专项不再进入deep');
 for(const name of mixed)assert.ok(files.some(file=>file.endsWith('/'+name)),`保留普通PG合同 ${name}`);
});
for(const [flag,name] of previews)test(`${flag}=1时真实Vitest仍能发现原preview入口`,()=>{
 const {files}=inspect('glob',{[flag]:'1'});
 for(const [,other] of previews)assert.equal(files.some(file=>file.endsWith('/'+other)),other===name,`独立开关 ${other}`);
});
test('未授权的真实Codex用例不登记，普通PG合同仍真实收集',()=>{
 const {names}=inspect('collect');
 for(const name of realNames)assert.ok(!names.includes(name),`默认不能把opt-in用例记为skip：${name}`);
 for(const name of ordinaryNames)assert.ok(names.includes(name),`真实收集普通PG合同：${name}`);
});
test('显式授权后能收集原真实Codex用例，不执行模型或PG hooks',()=>{
 const {names}=inspect('collect',{AUTHORING_REAL_CODEX:'1',INVOCATION_REAL_CODEX:'1'});
 for(const name of [...realNames,...ordinaryNames])assert.ok(names.includes(name),`收集原入口：${name}`);
});
test('退役radius私有入口移除，现役联动报告API保留',async()=>{
 const cascade=await import('../../../packages/brain/src/cascade-list.js');
 assert.equal(typeof cascade.getCascadeList,'undefined');
 assert.equal(cascade.isRunnable('tests/live.test.js'),true);
 assert.equal(cascade.buildCascadeReport([{assertion_ref:'tests/live.test.js'}]).runnable_count,1);
 for(const file of ['packages/brain/src/lib/radius-client.js','packages/brain/src/lib/radius-client.test.js','packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js'])assert.equal(existsSync(root+file),false,file);
});
