#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {loadCommanderManifest} from './host.mjs';
import {digest,normalizeCommanderRun} from '../../src/orchestrator/commander-decision.js';
import {durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import processState from '../../src/orchestrator/activity-supervisor-state.cjs';
export function supervisionState(previous,identity,maxStarts){
 if(!Number.isSafeInteger(maxStarts)||maxStarts<1||maxStarts>10)throw Error('commander_supervisor_budget_invalid');
 if(previous){if(digest(previous.identity)!==digest(identity)||previous.max_starts!==maxStarts||!Number.isInteger(previous.starts)||previous.starts<0||previous.starts>maxStarts)throw Error('commander_supervisor_identity_conflict');return previous;}
 return {protocol:'commander-supervisor/v1',identity,max_starts:maxStarts,starts:0,child:null};
}
export function terminalResult(result,identity){
 if(result.run_id!==identity.run_id||result.task_id!==identity.task_id||result.definition_sha256!==identity.definition_sha256)throw Error('commander_supervisor_result_identity_conflict');
 return ['completed','needs_review','failed'].includes(result.status);
}
export async function superviseCommander({manifestPath,resultPath,statePath=resultPath+'.supervisor.json',maxStarts=3}){
 const loaded=loadCommanderManifest(manifestPath),run=normalizeCommanderRun(loaded.run);
 const identity={run_id:run.run_id,task_id:run.task_id,definition_sha256:run.definition_sha256};
 const db=new pg.Client({connectionString:process.env.COMMANDER_DATABASE_URL,application_name:`commander-supervisor-${run.run_id}`,keepAlive:true});
 let held=false,closing=false;
 const revoke=()=>{if(held&&!closing){console.error('commander_supervisor_ownership_lost');process.exit(1);}};
 db.on('error',revoke);db.on('end',revoke);
 try{
  await db.connect();const key=BigInt.asIntN(64,BigInt('0x'+digest({supervisor:run.run_id}).slice(0,16))).toString();
  held=(await db.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired',[key])).rows[0].acquired;
  if(!held)throw Error('commander_supervisor_already_running');
  const state=supervisionState(fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):null,identity,maxStarts);
  while(true){
   await db.query('SELECT 1');loaded.verifySource();
   if(fs.existsSync(resultPath)){const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));if(terminalResult(result,identity)){state.terminal_status=result.status;durableWrite(statePath,state);return result;}}
   if(Date.now()>=(run.cleanup_deadline_ms??run.deadline_ms)+2000)throw Error('commander_supervisor_deadline_exceeded');
   if(!state.child||!processState.sameProcess(state.child.pid,state.child.birth)){
    if(state.starts>=state.max_starts)throw Error('commander_supervisor_budget_exhausted');
    state.starts++;state.child=null;durableWrite(statePath,state);
    const log=fs.openSync(statePath+'.log','a',0o600);
    const child=spawn(process.execPath,[fileURLToPath(new URL('./host.mjs',import.meta.url)),'--manifest',manifestPath,'--result',resultPath],{detached:true,stdio:['ignore',log,log],env:process.env});
    fs.closeSync(log);child.unref();child.on('error',()=>{});
    state.child={pid:child.pid,birth:processState.processBirth(child.pid)};durableWrite(statePath,state);
   }
   await new Promise(resolve=>setTimeout(resolve,250));
  }
 }finally{closing=true;await db.end().catch(()=>{});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--manifest'||args[2]!=='--result')throw Error('usage: supervise.mjs --manifest FILE --result FILE');
 const result=await superviseCommander({manifestPath:path.resolve(args[1]),resultPath:path.resolve(args[3])});
 console.log(JSON.stringify({run_id:result.run_id,status:result.status}));if(result.status!=='completed')process.exitCode=2;
}
