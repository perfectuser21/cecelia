const fs=require('node:fs');
const path=require('node:path');
const {createWorkflowRunner}=require('../workflow-runner.cjs');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
(async()=>{
const {createWorkflowRecorder}=await import('../../../src/orchestrator/workflow-recorder.js');
const r=createWorkflowRunner({...config,assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:s=>{
 const real=process.argv.includes('real-recorder')?createWorkflowRecorder({root:path.join(config.stateRoot,s.identity.run_id),runId:s.identity.run_id,taskId:s.identity.task_id,machineId:config.machineId,profileDigest:s.identity.profile_sha256,mode:s.identity.mode,metadata:s.profile.metadata}):null;
 return {onEvent:async(e,receipt)=>{await real?.onEvent(e,receipt);fs.appendFileSync(path.join(config.stateRoot,'events'),JSON.stringify(e)+'\n');if(process.argv.includes('crash-heartbeat')&&e.event_type==='ACTIVITY_HEARTBEAT')process.kill(process.pid,'SIGKILL');},recordValidation:async(...args)=>real?.recordValidation(...args),finalize:async(...args)=>real?.finalize(...args),flush:async()=>({pending:0,blocked:0})};
}});
process.on('message',async m=>{try{process.send(await r[m.action](m.id));}catch(e){process.send({error:e.message});}});
})();
