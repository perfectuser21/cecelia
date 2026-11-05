import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, chmodSync, realpathSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function fixture(t){const dir=realpathSync(mkdtempSync(join(tmpdir(),'private-pg-cleanup-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function write(dir,path,text){const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);return target;}
for(const failure of ['report','admin','drop'])test(`真实runner控制流遇到${failure}失败仍关闭backend`,t=>{
 const dir=fixture(t),events=join(dir,'events');
 const runner=write(dir,'scripts/ci/run-debt-pg.mjs',readFileSync(join(root,'scripts/ci/run-debt-pg.mjs')));
 write(dir,'packages/brain/package.json','{"type":"module"}');
 write(dir,'node_modules/pg/index.js',`exports.Pool=class{async query(){} async end(){require('node:fs').appendFileSync(${JSON.stringify(events)},'admin-end\\n');${failure==='admin'?"throw Error('ADMIN_END_FAILURE');":''}}};`);
 const pg=join(dir,'node_modules/pg/index.js');
 writeFileSync(pg,readFileSync(pg,'utf8')+`exports.Client=class {
 constructor(config){this.admin=config.database==='postgres';}
 async connect(){} async query(){}
 async end(){if(this.admin){require('node:fs').appendFileSync(${JSON.stringify(events)},${JSON.stringify('admin-end\n')});${failure==='admin'?"throw Error('ADMIN_END_FAILURE');":''}}}
 };`);
 write(dir,'scripts/ci/private-pg-backend.mjs',`import{writeFileSync,appendFileSync}from'node:fs';
 export const cleanProcessEnv=()=>({});
 export const startPrivatePg=async()=>({directory:${JSON.stringify(dir)},config:{database:'postgres'},owner:'ci-debt-0123456789abcdef',password:'fixture',port:6543,inspectOwner(){},close(){appendFileSync(${JSON.stringify(events)},'backend-close\\n');}});
 export function checked(command,args){writeFileSync(args[args.indexOf('--outputFile')+1],JSON.stringify({success:true}));}
 `);
 write(dir,'scripts/ci/private-pg-contract.mjs',`export const verifyPrivatePg=async()=>({});export const assertVitestReport=()=>1;export const dropOwnedScratch=async()=>{${failure==='drop'?"throw Error('DROP_FAILURE');":''}};export const restoreDump=()=>{};`);
 write(dir,'scripts/ci/debt-pg-tests.json',JSON.stringify({schema_version:1,tests:[{path:'packages/brain/src/review.test.js',mode:'empty',status:'ready'}]}));
 write(dir,'packages/brain/src/review.test.js','// no external execution; checked() is the subprocess boundary');
 const obstruction=write(dir,'not-directory','x'),output=failure==='report'?join(obstruction,'report.json'):join(dir,'report.json');
 const run=spawnSync(process.execPath,[runner,'--output',output],{encoding:'utf8'});
 assert.doesNotMatch(run.stderr,/SyntaxError|not a constructor|connect is not a function/,'fixture must reach the claimed cleanup branch');
 assert.equal(run.status,1,run.stderr);assert.match(run.stderr,failure==='admin'?/ADMIN_END_FAILURE/:failure==='drop'?/DROP_FAILURE/:/ENOTDIR|EEXIST/);
 assert.match(readFileSync(events,'utf8'),/backend-close/,`backend未清理：${run.stderr}`);
});
test('Docker run未创建容器时保留启动原错且清理本人tmp',t=>{
 const dir=fixture(t),bin=join(dir,'bin'),temporary=join(dir,'tmp');mkdirSync(bin);mkdirSync(temporary);
 const docker=write(dir,'bin/docker',`#!/bin/sh
case "$1" in
run) echo IMAGE_PULL_FAILED_REVIEW >&2; exit 42;;
inspect) echo 'Error: No such object: missing' >&2; exit 1;;
container) exit 0;;
*) exit 2;;
esac
`);chmodSync(docker,0o755);
 const backend=write(dir,'backend.mjs',readFileSync(join(root,'scripts/ci/private-pg-backend.mjs')));
 const code=`Object.defineProperty(process,'platform',{value:'linux'});try{await(await import(${JSON.stringify('file://'+backend)})).startPrivatePg();process.exitCode=2;}catch(error){console.error(error.stack);process.exitCode=1;}`;
 const run=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,PATH:bin,TMPDIR:temporary}});
 assert.equal(run.status,1);assert.match(run.stderr,/IMAGE_PULL_FAILED_REVIEW/,'cleanup不得用missing inspect掩盖启动原错');
 assert.deepEqual(readdirSync(temporary),[],'没有容器时本人临时目录仍应回收');
});

for(const kind of ['owned','foreign','unavailable'])test(`Docker部分启动后的${kind}状态保持精确归属与原始错误`,t=>{
 const dir=fixture(t),bin=join(dir,'bin'),temporary=join(dir,'tmp'),events=join(dir,'events');mkdirSync(bin);mkdirSync(temporary);
 const docker=write(dir,'bin/docker',`#!/bin/sh
case "$1" in
run) echo ORIGINAL_START_FAILURE >&2; exit 42;;
container) ${kind==='unavailable'?"echo DOCKER_LIST_FAILED >&2; exit 1":"echo fixture-container-id; exit 0"};;
inspect) ${kind==='foreign'?"echo foreign-owner":"printf '%s' \"$4\""}; exit 0;;
rm) echo "$*" >> '${events}'; exit 0;;
*) exit 2;;
esac
`);chmodSync(docker,0o755);
 const backend=write(dir,'backend.mjs',readFileSync(join(root,'scripts/ci/private-pg-backend.mjs')));
 const code=`Object.defineProperty(process,'platform',{value:'linux'});try{await(await import(${JSON.stringify('file://'+backend)})).startPrivatePg();process.exitCode=2;}catch(error){console.error(error.stack);process.exitCode=1;}`;
 const run=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,PATH:bin,TMPDIR:temporary}});
 assert.equal(run.status,1);assert.match(run.stderr,/ORIGINAL_START_FAILURE/);
 if(kind==='owned'){
   assert.match(readFileSync(events,'utf8'),/rm -f -v ci-debt-[a-f0-9]{16}/);
   assert.deepEqual(readdirSync(temporary),[]);
 }else{
   assert.equal(readdirSync(dir).includes('events'),false,'未知或他人归属绝不能删除容器');
   assert.match(run.stderr,kind==='foreign'?/owner mismatch/:/DOCKER_LIST_FAILED/);
   assert.equal(readdirSync(temporary).length,1,'归属无法核准时保留本人证据目录');
 }
});
