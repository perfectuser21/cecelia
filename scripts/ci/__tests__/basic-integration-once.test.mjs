import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {commandsFor} from '../run-basic-check.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const aggregate='src/__tests__/integration/workflow-common-terminal.pg.integration.test.js';
const lease='src/__tests__/integration/task-lease-device-pool.pg.integration.test.js';
const imports=parse(readFileSync(root+'packages/brain/'+aggregate,'utf8'),{ecmaVersion:'latest',sourceType:'module'}).body
 .filter(node=>node.type==='ImportDeclaration'&&node.source.value.endsWith('.test.js'))
 .map(node=>'src/__tests__/integration/'+node.source.value.slice(2));

function inspect(mode){
 const selected=mode==='leaves'?imports:[aggregate,lease];
 const program=`
 import {createVitest} from './packages/brain/node_modules/vitest/dist/node.js';
 import brain from './packages/brain/vitest.config.js';
 const opts={root:${JSON.stringify(root+'packages/brain')},watch:false,reporters:[],testNamePattern:'^__COLLECT_ONLY_DO_NOT_RUN__$'};
 const ctx=await createVitest('test',${JSON.stringify(mode)}==='leaves'
   ?{...brain.test,...opts,config:false,include:${JSON.stringify(imports)},exclude:['**/node_modules/**']}
   :{...opts,config:${JSON.stringify(root+'scripts/ci/deep-integration.config.mjs')}});
 try{
  const files=(await ctx.globTestFiles()).map(([,file])=>file);
  let tasks=[];
  if(${JSON.stringify(mode)}!=='glob'){
   await ctx.start(${JSON.stringify(selected)});
   const visit=(task,parents=[])=>{if(task.type==='test')tasks.push({file:task.file.filepath,name:[...parents,task.name].join(' > ')});
    else for(const child of task.tasks??[])visit(child,task.type==='suite'?[...parents,task.name]:parents);};
   ctx.state.getFiles().forEach(file=>{for(const task of file.tasks??[])visit(task);});
   const errors=ctx.state.getUnhandledErrors();if(errors.length)throw Error(errors.map(e=>e.message).join(';'));
  }
  console.log('ONCE_RESULT='+JSON.stringify({files,tasks}));
 }finally{await ctx.close();}
 `;
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'test',CI:'true',
  POSTGRES_INTEGRATION:'1',DB_NAME:'cecelia_scratch',DB_HOST:'127.0.0.1',DB_PORT:'1'};
 const output=execFileSync(process.execPath,['--input-type=module','-e',program],{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 const receipt=output.split('\n').find(line=>line.startsWith('ONCE_RESULT='));assert.ok(receipt,'必须有真实Vitest收据');
 return JSON.parse(receipt.slice('ONCE_RESULT='.length));
}

test('PR固定18入口仍可选；汇总六叶在deep只由汇总登记一次',()=>{
 const {files}=inspect('glob');
 const pr=commandsFor('brain-integration').find(step=>step.ciScratchDatabase).args.filter(arg=>arg.endsWith('.test.js'));
 assert.equal(pr.length,18);
 for(const file of pr)assert.ok(files.includes(root+'packages/brain/'+file),`PR不能丢合同 ${file}`);
 assert.equal(imports.length,6,'保留原六份叶合同');
 for(const file of imports)assert.ok(!files.includes(root+'packages/brain/'+file),`叶合同不得重复独立发现：${file}`);
});
test('真实收集汇总保留六叶全部用例各一次，另保留14个中央终态合同',()=>{
 const actual=inspect('aggregate').tasks,expected=inspect('leaves').tasks;
 const aggregateCases=actual.filter(task=>task.file.endsWith('/'+aggregate)).map(task=>task.name);
 assert.ok(expected.length>0);
 for(const task of expected)assert.equal(aggregateCases.filter(name=>name===task.name).length,1,`真实收集不得丢失或重复：${task.name}`);
 assert.equal(aggregateCases.length,expected.length+14);
 const leases=actual.filter(task=>task.file.endsWith('/'+lease)).map(task=>task.name);
 assert.ok(leases.some(name=>name.includes('显式 start 原子启动')));
 assert.ok(leases.some(name=>name.includes('059 迁移在私有 schema 建真实 task_runs')));
 assert.ok(!leases.some(name=>name.startsWith('设备池：')),'退休选台用例不再登记');
});
test('无消费者的设备池helper退出，历史表迁移和租约锁实现仍在',()=>{
 assert.equal(existsSync(root+'packages/brain/src/lib/device-pool.js'),false);
 for(const file of ['packages/brain/src/lib/task-lease.js','packages/brain/src/device-lock-helpers.js','packages/brain/migrations/553_task_leases_device_pools.sql']){
  assert.ok(existsSync(root+file),`保留现役安全/历史台账：${file}`);
 }
});
