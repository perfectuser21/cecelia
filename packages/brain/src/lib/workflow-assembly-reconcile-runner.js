import {collectTaskResourceRefs,checkResourcesHealth} from './resource-health.js';
import {ensureAssemblyGapTask} from './workflow-assembly-reconcile-tasks.js';
import {auditAssemblyDerivations} from './workflow-assembly-reconcile-derived.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
import {reconcileGapState} from './workflow-assembly-reconcile.js';
const CURSOR='workflow_assembly_reconcile_cursor:v1';
const supported=row=>row.payload?.workflow_authoring===true
  && row.result?.workflow_authoring?.request?.assembly_mode===true
  && row.result?.workflow_authoring?.request?.registration_protocol==='definition-freeze-v1'
  && row.result?.workflow_authoring?.request?.execution_protocol==='workflow-authoring-execution-v1';
const tenant=row=>row.tenant_id ?? row.payload?.tenant_id ?? 'default';
const deadlineError=()=>Object.assign(Error('assembly_reconcile_budget'),{code:'assembly_reconcile_budget'});

async function defaultAdvance(pool,id,options){
  const service=await import('../workflow-authoring/assembly-driver.js');
  return service.advanceAuthoringAssembly(pool,id,options);
}

async function defaultReadiness(pool,id,options){
  const service=await import('../workflow-authoring/execution-proof.js');
  return service.readAuthoringReadiness(pool,id,options);
}

/** 专用连接持会话锁，直到真实handler结束；外层Promise.race超时不会解锁旧轮。 */
export async function runWorkflowAssemblyReconcile(pool,options={}){
  const now=options.now ?? Date.now,budget=Math.max(1,Math.min(20000,options.budgetMs ?? 20000));
  const deadline=now()+budget,check=()=>{if(options.signal?.aborted)throw Object.assign(Error('assembly_reconcile_cancelled'),{code:'assembly_reconcile_cancelled'});if(now()>=deadline)throw deadlineError();};
  if(options.signal?.aborted)return {stopped:'cancelled'};
  let connection;
  try{
    connection=await new Promise((resolve,reject)=>{
      let settled=false;const fail=()=>{if(!settled){settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(options.signal?.aborted?Object.assign(Error('assembly_reconcile_cancelled'),{code:'assembly_reconcile_cancelled'}):deadlineError());}};
      const abort=()=>fail(),timer=setTimeout(fail,Math.max(1,deadline-now()));
      options.signal?.addEventListener('abort',abort,{once:true});
      Promise.resolve().then(()=>pool.connect()).then(client=>{
        if(settled){client.release();return;}settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);resolve(client);
      },error=>{if(!settled){settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(error);}});
    });
  }catch(error){
    if(error.code==='assembly_reconcile_cancelled' || error.code==='assembly_reconcile_budget')return {stopped:error.code==='assembly_reconcile_cancelled'?'cancelled':'budget'};
    throw error;
  }
  let locked=false,transaction=false,lockKey,destroy;
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
      let phase='definition';
      try{
      check();if(!supported(row)){report.skipped_objects++;await cursor(row.id);continue;}
      const prior=row.result?.workflow_assembly_reconcile;
      const definition=row.result?.workflow_authoring?.outputs?.compose?.definition;
      if(!definition){report.skipped_objects++;await cursor(row.id);continue;}
      const digest=definitionDigest(definition),target=`candidate:${digest}`,tenantId=tenant(row);
      phase='readiness';
      if(prior?.target_version===target && prior.next_check_at>now()){report.skipped_objects++;await cursor(row.id);continue;}
      let readiness;
      const resourceRefs=[...new Map([...collectTaskResourceRefs(row.payload),...(prior?.target_version===target?prior.resource_refs??[]:[])].map(r=>[r.type+'\0'+r.key,r])).values()];
      let resourceCondition='ready';
      try{
        const health=await checkResourcesHealth(client,resourceRefs,{now:now()});check();
        if(health.blocked.length)resourceCondition='safe_stop';
        else if(health.degraded.length || health.stale.length || health.unknown.length)resourceCondition='unknown';
      }catch(error){check();resourceCondition='unknown';}
      let driverError=false;
      const tenantConflict=row.tenant_id!=null && row.payload?.tenant_id!=null && row.tenant_id!==row.payload.tenant_id;
      try{
        if(!tenantConflict && resourceCondition==='ready' && identity.database==='cecelia_scratch'
          && (options.advanceAuthoring || !options.readReadiness)){
          try{check();await (options.advanceAuthoring??defaultAdvance)(pool,row.id,{tenantId,deadline,signal:options.signal});check();}
          catch(error){check();driverError=true;}
        }
        readiness=tenantConflict?{}:resourceCondition!=='ready'
          ?{protocol:'workflow-authoring-execution-v1',tenant_id:tenantId,definition_sha256:digest,target_version:target,status:'blocked',resource_condition:resourceCondition,gaps:[{code:resourceCondition==='safe_stop'?'resource_unavailable':'resource_unknown'}]}
          :await (options.readReadiness ?? defaultReadiness)(pool,row.id,{tenantId,deadline,signal:options.signal});
        check();
      }catch(error){
        check();readiness={protocol:'workflow-authoring-execution-v1',tenant_id:tenantId,definition_sha256:digest,target_version:target,status:'blocked',resource_condition:'unknown',gaps:[{code:error.status===403 || error.status===401?'readiness_authorization_required':'readiness_unavailable'}]};
      }
      check();
      if(readiness.protocol!=='workflow-authoring-execution-v1' || readiness.tenant_id!==tenantId
        || readiness.definition_sha256!==digest || readiness.target_version!==target){
        readiness={protocol:'workflow-authoring-execution-v1',status:'blocked',resource_condition:'unknown',gaps:[{code:'readiness_identity_mismatch'}]};
      }
      if(driverError)readiness={...readiness,status:'blocked',gaps:[...readiness.gaps??[],{code:'driver_unavailable'}]};
      const observation={...readiness,tenant_id:tenantId,object_id:row.id,target_version:target,definition_sha256:digest};
      phase='write';
      try{
        check();await client.query('BEGIN');transaction=true;
        await client.query("SELECT set_config('statement_timeout',$1,true)",[String(Math.max(1,deadline-now()))]);check();
        const fresh=(await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[row.id])).rows[0];check();
        if(!fresh || !supported(fresh) || tenant(fresh)!==tenantId
          || definitionDigest(fresh.result?.workflow_authoring?.outputs?.compose?.definition)!==digest){
          await rollback();transaction=false;report.skipped_objects++;await cursor(row.id);continue;
        }
        const audit=!tenantConflict && fresh.result?.workflow_authoring_candidate
          ? await auditAssemblyDerivations(client,fresh,{transaction:'existing',check,repair:resourceCondition==='ready'}):{gaps:[],detected:[],repaired:[]};
        check();let previous=fresh.result?.workflow_assembly_reconcile;
        if(audit.detected.length){
          previous=reconcileGapState(previous,{...observation,status:'blocked',gaps:audit.detected},{now:now()});
          for(const issue of Object.values(previous.issues)){
            if(audit.repaired.some(g=>g.code===issue.gap.code && (g.activity_key??null)===issue.gap.activity_key))issue.repaired_at=now();
          }
        }
        const finalObservation={...observation,gaps:[...observation.gaps??[],...audit.gaps]};
        const state=reconcileGapState(previous,finalObservation,{now:now()});
        state.resource_refs=resourceRefs;
        state.derivations={checked_at:now(),detected:audit.detected,repaired:audit.repaired};
        if(fresh.result?.workflow_authoring_candidate && observation.resource_condition==='ready'
          && !audit.gaps.some(g=>g.code.startsWith('candidate_') || g.code==='execution_protocol_required')){
          for(const issue of Object.values(state.issues)){
            if(issue.status!=='open' || issue.target_version!==target || issue.definition_sha256!==digest)continue;
            check();const responsibility=await ensureAssemblyGapTask(client,fresh,issue,{check});check();
            if(responsibility){issue.repair_task_id=responsibility.task_id;issue.repair_task_status=responsibility.status;issue.routing_receipt_id=responsibility.routing_receipt_id;}
          }
        }
        check();await client.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb,updated_at=NOW() WHERE id=$1",[row.id,{workflow_assembly_reconcile:state}]);
        check();await cursor(row.id);check();await client.query('COMMIT');transaction=false;report.checked++;
      }catch(error){
        if(transaction){await rollback();transaction=false;}
        throw error;
      }
      }catch(error){
        if(error.code==='assembly_reconcile_cancelled' || error.code==='assembly_reconcile_budget' || error.code==='57014' || error.message==='Query read timeout')throw error;
        report.errors++;check();
        // 结构坏单只留稳定错误码；不记录原异常文本/凭据，不影响同轮后续对象。
        const state={...(row.result?.workflow_assembly_reconcile ?? {}),protocol:'workflow-assembly-reconcile-v1',
          tenant_id:tenant(row),object_id:row.id,status:'blocked',checked_at:now(),
          structural_gaps:[{code:phase==='definition'?'definition_invalid':'reconcile_object_error'}]};
        try{check();await client.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb,updated_at=NOW() WHERE id=$1",[row.id,{workflow_assembly_reconcile:state}]);}
        catch(recordError){check();if(recordError.code==='57014')throw recordError;}
        check();await cursor(row.id);
      }
    }
    return report;
  }catch(error){
    if(error.code==='assembly_reconcile_cancelled' || error.code==='assembly_reconcile_budget' || error.code==='57014' || error.message==='Query read timeout')return {...report,stopped:error.code==='assembly_reconcile_cancelled'?'cancelled':'budget'};
    throw error;
  }finally{
    try{
      if(transaction)await rollback();
      await connection.query({text:'RESET statement_timeout',query_timeout:5000});
      if(locked)await connection.query({text:'SELECT pg_advisory_unlock(hashtextextended($1,6))',values:[lockKey],query_timeout:5000});
    }catch(error){destroy=error;}finally{connection.release(destroy);}
  }
}
