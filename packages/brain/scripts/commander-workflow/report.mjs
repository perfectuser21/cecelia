#!/usr/bin/env node
// 只读入口：不启动DBOS执行器，不迁移，不恢复或重发业务动作。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {DBOSClient} from '@dbos-inc/dbos-sdk';
import {readRunLedger} from '../../src/orchestrator/commander-usage-ledger.js';
import {buildCommanderRunReport} from '../../src/orchestrator/commander-run-report.js';
export async function queryCommanderReport({manifestPath,resultPath,clientFactory=options=>DBOSClient.create(options),databaseFactory=options=>new pg.Client(options)}){
 const {run,profile}=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(!run?.task_id||!run.run_id||!path.isAbsolute(profile?.cwd??''))throw Error('report_manifest_invalid');
 const schema=process.env.COMMANDER_DATABASE_SCHEMA??'public',dbosSchema=process.env.COMMANDER_DBOS_SCHEMA??'commander_workflow_dbos';
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema)||!/^[a-z][a-z0-9_]{0,62}$/.test(dbosSchema)||schema===dbosSchema)throw Error('commander_schema_invalid');
 const url=process.env.COMMANDER_DATABASE_URL;if(!url)throw Error('commander_database_required');
 const root=fs.realpathSync(profile.cwd),controlRoot=path.resolve(root,profile.skill_runtime?.control_dir??'control');
 if(!controlRoot.startsWith(root+path.sep)||!/^[a-zA-Z0-9_-]+$/.test(run.run_id))throw Error('commander_control_path_invalid');
 const identity={task_id:run.task_id,run_id:run.run_id};let observedLedger=null,ledgerUnavailable=null;
 try{observedLedger=readRunLedger({directory:path.join(controlRoot,run.run_id,'ledger'),identity});}
 catch(error){if(error.code!=='ENOENT')throw error;ledgerUnavailable='local_journal_missing';}
 let supervision=null;
 if(resultPath&&fs.existsSync(resultPath+'.supervisor.json')){
  supervision=JSON.parse(fs.readFileSync(resultPath+'.supervisor.json','utf8'));
  if(supervision.identity?.task_id!==identity.task_id||supervision.identity?.run_id!==identity.run_id)throw Error('report_identity_mismatch');
 }
 let client;const db=databaseFactory({connectionString:url,options:`-c search_path=${schema} -c default_transaction_read_only=on`,application_name:'commander-report-readonly'});
 try{
  client=await clientFactory({systemDatabaseUrl:url,systemDatabaseSchemaName:dbosSchema});await db.connect();
  const workflowID=`commander-foundation:${run.run_id}`;
  const [workflow,steps,actions]=await Promise.all([client.getWorkflow(workflowID),client.listWorkflowSteps(workflowID),
   db.query('SELECT action_id,activity_key,identity,state,result,deadline_ms FROM commander_activity_actions WHERE run_id=$1 ORDER BY activity_key',[run.run_id])]);
  if(!workflow)throw Error('commander_workflow_not_found');
  return buildCommanderRunReport({run,workflow,steps:steps??[],actions:actions.rows,observedLedger,supervision,ledgerUnavailable});
 }finally{await Promise.all([client?.destroy(),db.end()]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(![2,4].includes(args.length)||args[0]!=='--manifest'||(args.length===4&&args[2]!=='--result'))throw Error('usage: report.mjs --manifest FILE [--result FILE]');
 console.log(JSON.stringify(await queryCommanderReport({manifestPath:path.resolve(args[1]),resultPath:args[3]?path.resolve(args[3]):undefined}),null,2));
}
