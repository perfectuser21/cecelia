import {expect,test,vi} from 'vitest';
import {reconcileCommanderTask} from '../commander-v2-control.js';
test('旧V2没有已绑定核验child时停放父运行并说明缺原生权限，不继续造旧OpenClaw单',async()=>{
 const control={phase:'awaiting_verify',envelope:{task_id:'parent',run_id:'old-run',workflow_key:'report',attempt:1,definition:{snapshot_sha256:'old-definition'}},delivery:{outputs:{},evidence:[],cleanup:{},effects:[]}};
 const task={id:'parent',status:'in_progress',payload:{commander_protocol:'commander-v2'},result:{workflow_control:control}};
 const createVerify=vi.fn(async()=>({task:{id:'new-child'}}));
 const pool={connect:async()=>({...pool,release(){}}),query:async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM tasks'))return {rows:args[0]==='parent'?[task]:[]};
  if(sql.startsWith('UPDATE tasks SET result'))task.result.workflow_control=JSON.parse(args[1]);
  return {rows:[],rowCount:0};
 }};
 await reconcileCommanderTask(pool,'parent',{createVerify});
 expect(createVerify).not.toHaveBeenCalled();
 expect(task.result.workflow_control).toMatchObject({phase:'blocked',needs_review:true,resume_condition:'native_agent_verification_binding_required'});
 expect(task.result.workflow_control.envelope.run_id).toBe('old-run');
 expect(task.result.workflow_control.verify_task_id).toBeUndefined();
});
