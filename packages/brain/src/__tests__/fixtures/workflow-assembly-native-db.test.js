import {readFileSync} from 'node:fs';
import {authoringExecutionDatabase} from './authoring-execution-db.test.js';
import {nativeSpec as s,prepareNativeSource} from '../../lib/workflow-assembly-native-source.js';
export const readSource=async(_revision,path)=>readFileSync(new URL('../../../../../'+path,import.meta.url),'utf8');
export async function nativeMaintenanceDatabase(){
  const f=await authoringExecutionDatabase();const db=f.pool;
  try{
  await db.query('CREATE TABLE ops_schedule_entries(LIKE public.ops_schedule_entries INCLUDING ALL);CREATE TABLE ops_workflows(LIKE public.ops_workflows INCLUDING ALL);CREATE TABLE working_memory(LIKE public.working_memory INCLUDING ALL);CREATE TABLE run_definition_bindings(LIKE public.run_definition_bindings INCLUDING ALL)');
  await db.query("INSERT INTO capabilities(id,name,parent_journey_id,status) SELECT $1,'系统看护 · 业务线健康巡检',parent_journey_id,'active' FROM capabilities LIMIT 1",[s.capability_id]);
  await db.query("INSERT INTO ops_workflows(id,source,wf_id,name,machine,active) VALUES($1,'scheduler',$2,'真实维护作业','us-vps',false)",[s.schedule.ops_workflow_id,s.schedule.label]);
  await db.query(`INSERT INTO ops_schedule_entries(id,source,host_alias,label,kind,ops_workflow_id,active,enabled,registered_via,ledger_status)
    VALUES($1,'brain','us-vps',$2,'brain_job',$3,true,true,'brain-job','registered')`,[s.schedule.id,s.schedule.label,s.schedule.ops_workflow_id]);
  const source=await prepareNativeSource({revision:'a'.repeat(40),readFile:readSource});
  return {...f,db,source,services:{revision:source.commit,readSource}};
  }catch(error){await f.close();throw error;}
}
