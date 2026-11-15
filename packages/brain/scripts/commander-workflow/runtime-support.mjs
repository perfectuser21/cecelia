import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {DBOSClient} from '@dbos-inc/dbos-sdk';
import {normalizeCommanderRun} from '../../src/orchestrator/commander-decision.js';
export function isMainModule(url,entry=process.argv[1]){
 if(!entry)return false;try{return fs.realpathSync(entry)===fs.realpathSync(fileURLToPath(url));}catch{return false;}
}
export const ownerKey=runId=>BigInt.asIntN(64,BigInt('0x'+createHash('sha256').update('commander-foundation:'+runId).digest('hex').slice(0,16))).toString();
export function databaseConfig(url,{schema,applicationName}={}){
 const connection=new URL(url);
 if(schema){if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('commander_schema_invalid');connection.searchParams.set('options',`${connection.searchParams.get('options')??''} -c search_path=${schema}`.trim());}
 return {connectionString:connection.href,application_name:applicationName,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,keepAlive:true};
}
/** 此客户端只读取/取消已有workflow，不启动执行器，也不执行迁移。 */
export async function withWorkflowClient(url,schema,fn){
 const pool=new pg.Pool({...databaseConfig(url),max:2});let client;
 try{
  const exists=(await pool.query('SELECT to_regclass($1) AS relation',[schema+'.workflow_status'])).rows[0].relation;
  if(!exists)return await fn(null);
  client=await DBOSClient.create({systemDatabasePool:pool,systemDatabaseSchemaName:schema});return await fn(client);
 }finally{if(client)await client.destroy();else await pool.end();}
}
export async function assertStoredRun(client,run){
 if(!client)return null;
 const workflow=await client.getWorkflow(`commander-foundation:${run.run_id}`);
 if(!workflow)return null;
 const original=workflow.input?.[0];
 if(!original||normalizeCommanderRun(original).definition_sha256!==run.definition_sha256)throw Error('commander_identity_conflict');
 return workflow;
}
