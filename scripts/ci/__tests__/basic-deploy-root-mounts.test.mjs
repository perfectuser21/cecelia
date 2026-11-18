import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(import.meta.url);
const root=new URL('../../../',import.meta.url);
const compose=require('js-yaml').load(readFileSync(new URL('docker-compose.us-vps.yml',root),'utf8'));
const service=compose.services['node-brain'];
const deployRoot=service.environment.find(x=>x.startsWith('REPO_ROOT=')).slice('REPO_ROOT='.length);
const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0'));
function mount(value){
 if(typeof value!=='string')return {source:value.source,target:value.target,readonly:!!value.read_only};
 const [source,target,options='']=value.split(':');return {source,target,readonly:options.split(',').includes('ro')};
}
function assertDeployRootMounts(volumes){
 const mounts=volumes.map(mount);
 assert.ok(mounts.some(m=>m.source===deployRoot&&m.target===deployRoot&&!m.readonly),'Git部署根必须保持父目录rw挂载');
 const blocked=mounts.filter(m=>m.target?.startsWith(deployRoot+'/')&&tracked.has(m.target.slice(deployRoot.length+1)));
 assert.deepEqual(blocked,[],'部署根内Git管理的普通文件不能单独挂载，否则checkout unlink会EBUSY');
}
test('真实US compose允许Git更新部署根，worker配置继续由父目录rw挂载提供',()=>{
 assertDeployRootMounts(service.volumes);
 assert.ok(tracked.has('packages/workflows/staff/workers.config.json'));
});
test('恢复tracked单文件子挂载或把部署根改只读都必须拒绝',()=>{
 const clean=service.volumes.filter(v=>mount(v).target!==deployRoot+'/packages/workflows/staff/workers.config.json');
 assert.throws(()=>assertDeployRootMounts([...clean,deployRoot+'/packages/workflows/staff/workers.config.json:'+deployRoot+'/packages/workflows/staff/workers.config.json:rw']));
 const readonly=clean.map(v=>mount(v).target===deployRoot?{type:'bind',source:deployRoot,target:deployRoot,read_only:true}:v);
 assert.throws(()=>assertDeployRootMounts(readonly));
});
