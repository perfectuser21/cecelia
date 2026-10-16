import {definitionDigest} from '../workflow-authoring/contracts.js';
import {reconcileGapState} from './workflow-assembly-reconcile.js';
const CURSOR='workflow_assembly_reconcile_cursor:v1';
const supported=row=>row.payload?.workflow_authoring===true
  && row.result?.workflow_authoring?.request?.assembly_mode===true
  && row.result?.workflow_authoring?.request?.registration_protocol==='definition-freeze-v1'
  && row.result?.workflow_authoring?.request?.execution_protocol==='workflow-authoring-execution-v1';
const tenant=row=>row.tenant_id ?? row.payload?.tenant_id ?? 'default';
const deadlineError=()=>Object.assign(Error('assembly_reconcile_budget'),{code:'assembly_reconcile_budget'});

async function defaultReadiness(pool,id,options){
  const service=await import('../workflow-authoring/execution-proof.js');
  return service.readAuthoringReadiness(pool,id,options);
}

/** 专用连接持会话锁，直到真实handler结束；外层Promise.race超时不会解锁旧轮。 */
export async function runWorkflowAssemblyReconcile(pool,options={}){
  const now=options.now ?? Date.now,budget=Math.max(1,Math.min(20000,options.budgetMs ?? 20000));
  const deadline=now()+budget,check=()=>{if(now()>=deadline)throw deadlineError();};
  const connection=await pool.connect();let locked=false,transaction=false,lockKey,destroy;
  // 原生statement_timeout覆盖事务前读取与锁等待，query_timeout防失联；不靠外层race宣称已停。
  const client={query:async(text,values)=>{
    check();let remaining=Math.max(1,deadline-now());
    await connection.query({text:"SELECT set_config('statement_timeout',$1,false)",values:[String(remaining)],query_timeout:remaining+250});
    check();remaining=Math.max(1,deadline-now());
    return connection.query({text,values,query_timeout:remaining+250});
  }};
  const rollback=()=>connection.query({text:'ROLLBACK',query_timeout:5000});
  const report={checked:0,skipped_objects:0,errors:0};
  const cursor=async id=>{
    check();await client.query(`INSERT INTO working_memory(key,value_json,updated_at) VALUES($1,$2,NOW())
      ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=NOW()`,[CURSOR,{last_id:id}]);check();
  };
  try{
    check();const identity=(await client.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];check();
    lockKey=`workflow-assembly-reconcile:${identity.database}:${identity.schema}`;
    locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,6)) AS locked',[lockKey])).rows[0]?.locked===true;
    if(!locked)return {skipped:'locked'};
    check();const last=(await client.query('SELECT value_json FROM working_memory WHERE key=$1',[CURSOR])).rows[0]?.value_json?.last_id ?? null;
    const scan=async after=>(await client.query(`SELECT * FROM tasks WHERE payload->>'workflow_authoring'='true'
      AND result#>>'{workflow_authoring,request,assembly_mode}'='true'
      AND result#>>'{workflow_authoring,request,registration_protocol}'='definition-freeze-v1'
      AND result#>>'{workflow_authoring,request,execution_protocol}'='workflow-authoring-execution-v1'
      AND ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2`,[after,Math.max(1,Math.min(20,options.limit ?? 5))])).rows;
    check();let rows=await scan(last);check();
    if(!rows.length && last){rows=await scan(null);check();}
    check();if(!rows.length){await cursor(null);return report;}
    for(const row of rows){
      check();if(!supported(row)){report.skipped_objects++;await cursor(row.id);continue;}
      const prior=row.result?.workflow_assembly_reconcile;
      const definition=row.result?.workflow_authoring?.outputs?.compose?.definition;
      if(!definition){report.skipped_objects++;await cursor(row.id);continue;}
      const digest=definitionDigest(definition),target=`candidate:${digest}`,tenantId=tenant(row);
      if(prior?.target_version===target && prior.next_check_at>now()){report.skipped_objects++;await cursor(row.id);continue;}
      let readiness;
      const tenantConflict=row.tenant_id!=null && row.payload?.tenant_id!=null && row.tenant_id!==row.payload.tenant_id;
      try{
        readiness=tenantConflict?{}:await (options.readReadiness ?? defaultReadiness)(pool,row.id,{tenantId,deadline,signal:options.signal});
        check();
      }catch(error){
        check();readiness={status:'blocked',resource_condition:'unknown',gaps:[{code:'readiness_unavailable'}]};
      }
      check();
      if(readiness.protocol!=='workflow-authoring-execution-v1' || readiness.tenant_id!==tenantId
        || readiness.definition_sha256!==digest || readiness.target_version!==target){
        readiness={protocol:'workflow-authoring-execution-v1',status:'blocked',resource_condition:'unknown',gaps:[{code:'readiness_identity_mismatch'}]};
      }
      const observation={...readiness,tenant_id:tenantId,object_id:row.id,target_version:target,definition_sha256:digest};
      try{
        check();await client.query('BEGIN');transaction=true;
        await client.query("SELECT set_config('statement_timeout',$1,true)",[String(Math.max(1,deadline-now()))]);check();
        const fresh=(await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[row.id])).rows[0];check();
        if(!fresh || !supported(fresh) || tenant(fresh)!==tenantId
          || definitionDigest(fresh.result?.workflow_authoring?.outputs?.compose?.definition)!==digest){
          await rollback();transaction=false;report.skipped_objects++;await cursor(row.id);continue;
        }
        const state=reconcileGapState(fresh.result?.workflow_assembly_reconcile,observation,{now:now()});
        check();await client.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb,updated_at=NOW() WHERE id=$1",[row.id,{workflow_assembly_reconcile:state}]);
        check();await cursor(row.id);check();await client.query('COMMIT');transaction=false;report.checked++;
      }catch(error){
        if(transaction){await rollback();transaction=false;}
        if(error.code==='assembly_reconcile_budget')throw error;
        report.errors++;check();await cursor(row.id);
      }
    }
    return report;
  }catch(error){
    if(error.code==='assembly_reconcile_budget' || error.code==='57014' || error.message==='Query read timeout')return {...report,stopped:'budget'};
    throw error;
  }finally{
    try{
      if(transaction)await rollback();
      await connection.query({text:'RESET statement_timeout',query_timeout:5000});
      if(locked)await connection.query({text:'SELECT pg_advisory_unlock(hashtextextended($1,6))',values:[lockKey],query_timeout:5000});
    }catch(error){destroy=error;}finally{connection.release(destroy);}
  }
}
