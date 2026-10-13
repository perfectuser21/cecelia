#!/usr/bin/env node
// 默认只读；显式 --apply-scratch 也只写 cecelia_scratch，不启动Brain或任何投影消费者。
import pg from 'pg';
import {main as auditSkillSourcesCli} from './audit-skill-git-sources.mjs';
import { pathToFileURL } from 'node:url';
import { auditVersionIdentity,applyScratchIdentityConstraints } from '../src/lib/version-identity-preflight.js';
import {installScratchIdentities} from '../src/lib/runtime-identities.js';
import {installScratchVersionGraph} from '../src/lib/runtime-version-graph.js';

export async function main(args=process.argv.slice(2),env=process.env) {
  const allowed=['--audit-skill-sources','--input','--output','--apply-scratch','--schema','--expected-digest','--install-scratch-identities','--install-scratch-version-graph'];
  let schema='public',expectedDigest,input,output,audit=false,apply=false,install=false,graph=false;
  for(let i=0;i<args.length;i++) {
    if(!allowed.includes(args[i]))throw Error(`不支持的参数：${args[i]}`);
    if(args[i]==='--audit-skill-sources')audit=true;
    else if(args[i]==='--apply-scratch')apply=true;
    else if(args[i]==='--install-scratch-version-graph')graph=true;
    else if(args[i]==='--install-scratch-identities')install=true;
    else {
      const value=args[++i];
      if(!value||value.startsWith('--'))throw Object.assign(Error('参数缺少值'),{code:'INVALID_ARGUMENT'});
      if(args[i-1]==='--schema')schema=value;
      else if(args[i-1]==='--input')input=value;
      else if(args[i-1]==='--output')output=value;
      else expectedDigest=value;
    }
  }
  if([apply,install,graph,audit].filter(Boolean).length>1)throw Error('每次只能执行一个隔离安装动作');
  if(audit) {
    if(!input||!output||schema!=='public'||expectedDigest)throw Object.assign(Error('来源核验参数不完整或混用'),{code:'INVALID_ARGUMENT'});
    return auditSkillSourcesCli(['--input',input,'--output',output]);
  }
  if(input||output)throw Object.assign(Error('input/output仅用于来源核验'),{code:'INVALID_ARGUMENT'});
  if(!env.DB_NAME)throw Error('DB_NAME 必须显式指定；禁止默认连接生产库');
  const pool=new pg.Pool({host:env.DB_HOST||'/tmp',port:Number(env.DB_PORT||5432),database:env.DB_NAME,
    user:env.DB_USER||'administrator',password:env.DB_PASSWORD,max:1,connectionTimeoutMillis:10000});
  let db;
  try {
    db=await pool.connect();
    let result;
    if(graph)result=await installScratchVersionGraph(db,{sourceSchema:schema});
    else if(install)result=await installScratchIdentities(db,{sourceSchema:schema});
    else if(apply)result=await applyScratchIdentityConstraints(db,{schema,expectedDigest});
    else result=await auditVersionIdentity(db,{schema});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return result;
  } finally {db?.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'PREFLIGHT_FAILED',message:error.code==='SCRATCH_REQUIRED'?error.message:'预检或隔离迁移失败'}})+'\n');process.exitCode=1;});
}
