import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {commandsFor} from '../run-basic-check.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const aggregate='src/__tests__/integration/workflow-common-terminal.pg.integration.test.js';
const lease='src/__tests__/integration/task-lease-device-pool.pg.integration.test.js';
const imports=parse(readFileSync(root+'packages/brain/'+aggregate,'utf8'),{ecmaVersion:'latest',sourceType:'module'}).body
 .filter(node=>node.type==='ImportDeclaration'&&node.source.value.endsWith('.test.js'))
 .map(node=>'src/__tests__/integration/'+node.source.value.slice(2));

const callbackUnit='src/__tests__/callback-processor-pr-gate.test.js';
const inspectionCache=new Map();
function inspect(mode){
 if(inspectionCache.has(mode))return inspectionCache.get(mode);
 const selected=mode==='leaves'?imports:mode==='callback-unit'?[callbackUnit]:[aggregate,lease];
 const program=`
 import {createVitest} from './packages/brain/node_modules/vitest/dist/node.js';
 import brain from './packages/brain/vitest.config.js';
 const opts={root:${JSON.stringify(root+'packages/brain')},watch:false,reporters:[],testNamePattern:'^__COLLECT_ONLY_DO_NOT_RUN__$'};
 const ctx=await createVitest('test',${JSON.stringify(mode)}==='leaves'
   ?{...brain.test,...opts,config:false,include:${JSON.stringify(imports)},exclude:['**/node_modules/**']}
   :{...opts,config:${JSON.stringify(mode==='unit-glob'||mode==='callback-unit'?root+'packages/brain/vitest.config.js':root+'scripts/ci/deep-integration.config.mjs')}});
 try{
  const files=(await ctx.globTestFiles()).map(([,file])=>file);
  let tasks=[];
  if(!['glob','unit-glob'].includes(${JSON.stringify(mode)})){
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
 const result=JSON.parse(receipt.slice('ONCE_RESULT='.length));inspectionCache.set(mode,result);return result;
}

test('PR原PG入口与新增用户交办仍可选；汇总六叶在deep只登记一次',()=>{
 const {files}=inspect('glob');
 const pr=commandsFor('brain-integration').find(step=>step.ciScratchDatabase).args.filter(arg=>arg.endsWith('.test.js'));
 assert.equal(pr.length,21);
 assert.equal(pr.filter(file=>file==='src/__tests__/integration/directory-projection.pg.integration.test.js').length,1,'目录临时空间回归必须由必需CI执行一次');
 assert.equal(pr.filter(file=>file==='src/__tests__/integration/task-intake.pg.integration.test.js').length,1,'真实用户交办PG回归必须由必需CI执行一次');
 assert.equal(pr.filter(file=>file==='src/__tests__/integration/workflow-authoring-freeze.pg.integration.test.js').length,1,'历史固定地图回归必须由必需CI执行一次');
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
test('纯mock回调保留十二项真实收集，只由unit owner登记一次',()=>{
 const unit=inspect('unit-glob').files,deep=inspect('glob').files;
 const file=root+'packages/brain/'+callbackUnit;
 assert.ok(unit.includes(file));
 assert.ok(!deep.includes(file));
 assert.ok(!deep.includes(root+'packages/brain/src/__tests__/integration/callback-processor.integration.test.js'),'同一回调合同不得再由deep独立发现');
 const cases=inspect('callback-unit').tasks.filter(task=>task.file===file);
 assert.equal(cases.length,12,'原回调状态/幂等/鉴权十二项不能因搬迁丢失');
});
test('默认unit不登记休眠开启态或PG专属；deep保PG，Ops保Python实际owner',()=>{
 const unit=inspect('unit-glob').files,deep=inspect('glob').files;
 const pg=root+'packages/brain/src/__tests__/migration-370-gp-governance-decisions.test.js';
 const asleep=root+'packages/brain/src/__tests__/consciousness-loop-timeout-lock.test.js';
 assert.ok(!unit.includes(asleep));assert.ok(!deep.includes(asleep));
 assert.ok(unit.includes(root+'packages/brain/src/__tests__/consciousness-loop-disabled.test.js'));
 assert.ok(!unit.includes(pg));assert.ok(deep.includes(pg));
 assert.ok(!unit.includes(root+'packages/brain/src/__tests__/opc-company-kr.test.js'));
 assert.ok(commandsFor('ops').some(step=>step.command==='bash'&&step.args.includes('scripts/ops/__tests__/opc_company_kr.test.sh')),'Python真实Ops owner不能随重复wrapper清退');
});
