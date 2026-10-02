import {randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const conflict=message=>Object.assign(Error(message),{statusCode:409});
export async function headedOwner(pool,taskId){
 return (await pool.query('SELECT * FROM headed_task_takeovers WHERE task_id=$1',[taskId])).rows[0]??null;
}
export async function assertAutomaticTaskOwner(pool,taskId){
 const task=(await pool.query("SELECT payload->'headed_takeover' AS headed_takeover FROM tasks WHERE id=$1",[taskId])).rows[0];
 if(task?.headed_takeover)throw conflict('headed_task_owned');
}
export async function takeOverHeadedTask(pool,input){
 const {taskId,requestId,sessionId,expectedRowVersion,expectedExecutorKind,expectedCurrentRunId}=input;
 if(!UUID.test(taskId??'')||!UUID.test(requestId??'')||!/^[-a-zA-Z0-9_:]{1,128}$/.test(sessionId??'')
  ||!Number.isInteger(expectedRowVersion)||expectedRowVersion<0||expectedExecutorKind!=='bridge'
  ||!(expectedCurrentRunId===null||typeof expectedCurrentRunId==='string'))throw Object.assign(Error('headed_takeover_input_invalid'),{statusCode:400});
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const gate=(await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended('headed_task_owner:'||$1::text,0)) AS acquired",[taskId])).rows[0];
  if(gate?.acquired!==true)throw conflict('headed_task_owner_busy');
  const task=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE NOWAIT',[taskId])).rows[0];
  if(!task)throw Object.assign(Error('task_not_found'),{statusCode:404});
  const previous=await headedOwner(db,taskId);
  if(previous){
   if(previous.request_id!==requestId||previous.session_id!==sessionId||previous.previous_run_id!==expectedCurrentRunId||previous.previous_owner?.row_version!==expectedRowVersion)throw conflict('headed_takeover_conflict');
   await db.query('COMMIT');return previous;
  }
  if(task.status!=='queued'||task.claimed_by!==null||task.claimed_at!==null||task.executor_kind!=='bridge'
   ||task.row_version!==expectedRowVersion||(task.payload?.current_run_id??null)!==expectedCurrentRunId)throw conflict('headed_takeover_conflict');
  const receipt=(await db.query('SELECT * FROM work_routing_receipts WHERE id=$1 AND task_id=$2',[task.payload?.routing_receipt_id,taskId])).rows[0];
  if(!receipt||receipt.canonical_task_type!==task.task_type||!['coding_mutation','coding_review'].includes(receipt.work_kind)
   ||receipt.work_kind!==task.payload?.work_kind)throw conflict('headed_takeover_route_ineligible');
  const active=(await db.query(`SELECT
   EXISTS(SELECT 1 FROM task_runs WHERE (task_id=$1 OR run_id=$2) AND (ended_at IS NULL OR status NOT IN ('success','failed','timeout','cancelled')))
   OR EXISTS(SELECT 1 FROM initiative_runs WHERE (current_task_id=$1 OR id::text=$2) AND phase NOT IN ('done','failed'))
   OR EXISTS(SELECT 1 FROM kernel_controller_sessions WHERE task_id=$1 AND status='active')
   OR EXISTS(SELECT 1 FROM harness_attempts a JOIN initiative_runs r ON r.id=a.run_id
     WHERE (r.current_task_id=$1 OR r.id::text=$2) AND a.status NOT IN ('completed','completed_with_concerns','failed','cancelled'))
   OR EXISTS(SELECT 1 FROM harness_attempt_cleanup_outbox c JOIN initiative_runs r ON r.id=c.run_id
     WHERE (r.current_task_id=$1 OR r.id::text=$2) AND c.status<>'confirmed')
   OR EXISTS(SELECT 1 FROM capacity_reservations WHERE task_id=$1 AND status<>'released')
   OR EXISTS(SELECT 1 FROM device_locks WHERE locked_by=$1::text)
   OR EXISTS(SELECT 1 FROM callback_queue WHERE (task_id=$1 OR run_id=$2) AND processed_at IS NULL)
   OR EXISTS(SELECT 1 FROM harness_gaps WHERE source_task_id=$1 AND status<>'resolved')
   OR EXISTS(SELECT 1 FROM harness_gap_dependencies WHERE source_task_id=$1 AND status='pending')
   OR EXISTS(SELECT 1 FROM task_dependencies WHERE from_task_id=$1 AND edge_type='hard' AND status='pending') AS active`,[taskId,expectedCurrentRunId])).rows[0];
  if(active?.active!==false)throw conflict('headed_takeover_active_execution');
  const generation=randomUUID();
  const prior={executor_kind:task.executor_kind,claimed_by:task.claimed_by,claimed_at:task.claimed_at,started_at:task.started_at,
   status:task.status,row_version:task.row_version,current_run_id:expectedCurrentRunId,run_status:'unknown',fact:'旧任务级错误不足以证明旧执行已经结束；未修改旧run或资源'};
  const owner=(await db.query(`INSERT INTO headed_task_takeovers(task_id,generation,request_id,session_id,previous_run_id,previous_owner)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[taskId,generation,requestId,sessionId,expectedCurrentRunId,prior])).rows[0];
  await db.query("SELECT set_config('cecelia.headed_owner_generation',$1,true)",[generation]);
  const changed=await db.query(`UPDATE tasks SET status='in_progress',executor_kind='headed-session',claimed_by=$2,
   claimed_at=now(),started_at=now(),updated_at=now(),row_version=row_version+1,
   payload=(COALESCE(payload,'{}'::jsonb)-'current_run_id')||jsonb_build_object('headed_takeover',jsonb_build_object('generation',$5::text,'session_id',$6::text)),
   status_history=COALESCE(status_history,'[]'::jsonb)||jsonb_build_object('from','queued','to','in_progress','changed_at',now(),'source','headed_takeover')
   WHERE id=$1 AND status='queued' AND claimed_by IS NULL AND claimed_at IS NULL AND executor_kind='bridge'
     AND row_version=$3 AND payload->>'current_run_id' IS NOT DISTINCT FROM $4::text RETURNING id`,[taskId,`session:${sessionId}`,expectedRowVersion,expectedCurrentRunId,generation,sessionId]);
  if(changed.rowCount!==1)throw conflict('headed_takeover_conflict');
  await db.query(`INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'headed_task_takeover',$2)`,[taskId,
   {fact:'真实有头会话一次性接管未认领legacy bridge任务',evidence:{generation,request_id:requestId,previous_owner:prior},actor:`session:${sessionId}`}]);
  await db.query('COMMIT');return owner;
 }catch(error){await db.query('ROLLBACK');if(['55P03','40P01'].includes(error.code))error.statusCode=409;throw error;}finally{db.release();}
}
