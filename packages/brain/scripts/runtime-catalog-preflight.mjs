#!/usr/bin/env node
// 默认只读；显式 --apply-scratch 也只写 cecelia_scratch，不启动Brain或任何投影消费者。
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { auditVersionIdentity,applyScratchIdentityConstraints } from '../src/lib/version-identity-preflight.js';
import {installScratchIdentities} from '../src/lib/runtime-identities.js';

export async function main(args=process.argv.slice(2),env=process.env) {
  const allowed=['--apply-scratch','--schema','--expected-digest','--install-scratch-identities'];
  let schema='public',expectedDigest,apply=false,install=false;
  for(let i=0;i<args.length;i++) {
    if(!allowed.includes(args[i]))throw Error(`不支持的参数：${args[i]}`);
    if(args[i]==='--apply-scratch')apply=true;
    else if(args[i]==='--install-scratch-identities')install=true;
    else {
      const value=args[++i];
      if(!value||value.startsWith('--'))throw Object.assign(Error('参数缺少值'),{code:'INVALID_ARGUMENT'});
      if(args[i-1]==='--schema')schema=value;
      else expectedDigest=value;
    }
  }
  if(apply&&install)throw Error('每次只能执行一个隔离安装动作');
  if(!env.DB_NAME)throw Error('DB_NAME 必须显式指定；禁止默认连接生产库');
  const pool=new pg.Pool({host:env.DB_HOST||'/tmp',port:Number(env.DB_PORT||5432),database:env.DB_NAME,
    user:env.DB_USER||'administrator',password:env.DB_PASSWORD,max:1,connectionTimeoutMillis:10000});
  let db;
  try {
    db=await pool.connect();
    let result;
    if(install)result=await installScratchIdentities(db,{sourceSchema:schema});
    else if(apply)result=await applyScratchIdentityConstraints(db,{schema,expectedDigest});
    else result=await auditVersionIdentity(db,{schema});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return result;
  } finally {db?.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'PREFLIGHT_FAILED',message:error.code==='SCRATCH_REQUIRED'?error.message:'预检或隔离迁移失败'}})+'\n');process.exitCode=1;});
}
