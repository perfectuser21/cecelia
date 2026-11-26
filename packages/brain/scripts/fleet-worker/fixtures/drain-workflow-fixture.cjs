const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {observeProcess,validResult,protectedRead}=require('../../../src/orchestrator/activity-supervisor-state.cjs');
const closed=new WeakMap();
function trackFixtureWorker(child){
 closed.set(child,new Promise(resolve=>child.once('close',resolve)));
 return child;
}
function stopped(supervisor){
 const state=observeProcess(supervisor.pid,supervisor.birth);
 if(state==='absent'||state==='reused')return true;
 if(state==='matching'&&process.platform==='linux'){
  // 已退出的孤儿可能等待init回收；僵尸不会再执行任何持久写入。
  try{return /\) Z /.test(fs.readFileSync(`/proc/${supervisor.pid}/stat`,'utf8'));}
  catch(error){if(error.code==='ENOENT')return true;throw error;}
 }
 return false;
}
async function drainWorkflowFixture({root,workers=[],supervisor}){
 fs.writeFileSync(path.join(root,'release'),'yes');
 let result;
 try{
  if(supervisor){
   assert(Number.isSafeInteger(supervisor.pid)&&typeof supervisor.birth==='string');
   const limit=supervisor.deadline+((supervisor.cleanup_grace_s??5)+2)*1000;
   while(!stopped(supervisor)){
    assert(Date.now()<limit,'owned supervisor did not finish; keep fixture evidence');
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   result=protectedRead(path.join(supervisor.directory,'result.json'),3);
   assert(validResult(result,supervisor),'owned supervisor final receipt must be durable before removal');
  }
 }finally{
  await Promise.all(workers.filter(Boolean).map(async child=>{
   assert(closed.has(child),'fixture worker must be tracked before launch');
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
   await closed.get(child);
  }));
 }
 fs.rmSync(root,{recursive:true,force:true});
 return result;
}
module.exports={drainWorkflowFixture,trackFixtureWorker};
