#!/usr/bin/env node
// 同源码在不同scope的事实投影；业务身份仍来自规范UUID，不复用旧登记的空source_repo。
import {readFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const pilots=JSON.parse(readFileSync(new URL('../../packages/brain/config/map-manifests/brain-pilot-bindings.json',import.meta.url),'utf8'));
const sourceRepos={cecelia:'perfectuser21/cecelia','zenithjoy-workspace':'perfectuser21/zenithjoy-workspace'};
export async function pilotGraphTargets(db,{repo,root}){
  const sourceRepo=sourceRepos[repo];if(!sourceRepo)return [];
  const result=[];
  for(const spec of Object.values(pilots)){
    if(spec.source_repo!==sourceRepo)continue;
    const {rows}=await db.query(`SELECT repo FROM map_scope_repositories WHERE scope_key=$1 AND repo=$2 AND adapter_config->>'source_repo'=$3`,[spec.scope_key,spec.registry_repo,sourceRepo]);
    if(!rows.length)continue; // 未登记的试点不产生假事实；正式初始化后下一批自动接入。
    const remote=execFileSync('git',['-C',root,'remote','get-url','origin'],{encoding:'utf8'}).trim();
    if(![`https://github.com/${sourceRepo}`,`https://github.com/${sourceRepo}.git`,`git@github.com:${sourceRepo}.git`,`ssh://git@github.com/${sourceRepo}.git`].includes(remote))throw Error(`pilot source repo mismatch: ${spec.registry_repo}`);
    if(/[|\r\n]/.test(root))throw Error('invalid pilot root');
    result.push({repo:spec.registry_repo,root,scope:spec.scope_key});
  }
  return result;
}
async function main(){
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL||'postgresql://localhost/cecelia'});
  try{for(const t of await pilotGraphTargets(pool,{repo:process.argv[2],root:process.argv[3]}))process.stdout.write(`${t.repo}|${t.root}|${t.scope}\n`);}
  finally{await pool.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1]))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
