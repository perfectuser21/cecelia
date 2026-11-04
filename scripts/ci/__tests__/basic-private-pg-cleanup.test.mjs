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
for(const failure of ['report','admin'])test(`真实runner控制流遇到${failure}失败仍关闭backend`,t=>{
 const dir=fixture(t),events=join(dir,'events');
 const runner=write(dir,'scripts/ci/run-debt-pg.mjs',readFileSync(join(root,'scripts/ci/run-debt-pg.mjs')));
 write(dir,'packages/brain/package.json','{"type":"module"}');
 write(dir,'node_modules/pg/index.js',`exports.Pool=class{async query(){} async end(){require('node:fs').appendFileSync(${JSON.stringify(events)},'admin-end\\n');${failure==='admin'?"throw Error('ADMIN_END_FAILURE');":''}}};`);
 write(dir,'scripts/ci/private-pg-backend.mjs',`import{writeFileSync,appendFileSync}from'node:fs';
 export const cleanProcessEnv=()=>({});
 export const startPrivatePg=async()=>({directory:${JSON.stringify(dir)},config:{},owner:'ci-debt-0123456789abcdef',password:'fixture',port:6543,inspectOwner(){},close(){appendFileSync(${JSON.stringify(events)},'backend-close\\n');}});
 export function checked(command,args){writeFileSync(args[args.indexOf('--outputFile')+1],JSON.stringify({success:true}));}
 `);
 write(dir,'scripts/ci/private-pg-contract.mjs',`export const verifyPrivatePg=async()=>({});export const assertVitestReport=()=>1;export const dropOwnedScratch=async()=>{};export const restoreDump=()=>{};`);
 write(dir,'scripts/ci/debt-pg-tests.json',JSON.stringify({schema_version:1,tests:[{path:'packages/brain/src/review.test.js',mode:'empty',status:'ready'}]}));
 write(dir,'packages/brain/src/review.test.js','// no external execution; checked() is the subprocess boundary');
 const obstruction=write(dir,'not-directory','x'),output=failure==='report'?join(obstruction,'report.json'):join(dir,'report.json');
 const run=spawnSync(process.execPath,[runner,'--output',output],{encoding:'utf8'});
 assert.equal(run.status,1,run.stderr);assert.match(run.stderr,failure==='admin'?/ADMIN_END_FAILURE/:/ENOTDIR|EEXIST/);
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
 const run=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:temporary}});
 assert.equal(run.status,1);assert.match(run.stderr,/IMAGE_PULL_FAILED_REVIEW/,'cleanup不得用missing inspect掩盖启动原错');
 assert.deepEqual(readdirSync(temporary),[],'没有容器时本人临时目录仍应回收');
});
