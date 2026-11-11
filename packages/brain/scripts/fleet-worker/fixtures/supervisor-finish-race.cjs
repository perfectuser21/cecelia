const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{fork}=require('node:child_process');
const source=path.resolve(__dirname,'../../../src/orchestrator');
const state=require(path.join(source,'activity-supervisor-state.cjs'));
const binding={run_id:'local-finish-race',task_id:'local-finish-race',activity:'work'};
async function owner(root,deadline){
 const {startSupervisedActivity}=await import(path.join(source,'activity-supervisor.js'));
 const pending=startSupervisedActivity(path.join(root,'spool'),binding,{key:'work',budget:{max_duration_s:15,heartbeat_s:1},runtime:{entry:'work.mjs',cleanup_grace_s:1}},{},{cwd:root},deadline);
 process.send({ready:true});await pending;process.disconnect();
}
async function probe(trigger){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'supervisor-finish-'));
 const spool=path.join(root,'spool'),resultFile=path.join(spool,'result.json'),deadline=Date.now()+15000;
 const trace=[],originalSame=state.sameProcess;let calls=0,child;
 const pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
 state.sameProcess=(pid,birth)=>{
  const row={call:++calls,result_before:fs.existsSync(resultFile)};
  if(calls===trigger){
   fs.writeFileSync(path.join(root,'release'),'yes',{mode:0o600});
   const until=Date.now()+5000;
   while(Date.now()<until&&originalSame(pid,birth))pause(10);
  }
  row.same_process=originalSame(pid,birth);row.result_after=fs.existsSync(resultFile);trace.push(row);
  return row.same_process;
 };
 try{
  fs.writeFileSync(path.join(root,'work.mjs'),`import fs from 'node:fs';for await(const c of process.stdin){}fs.appendFileSync('effects','x');while(!fs.existsSync('release'))await new Promise(r=>setTimeout(r,10));console.log(JSON.stringify({schema_version:1,status:'completed',outputs:{answer:42}}));`,{mode:0o600});
  child=fork(__filename,['--owner',root,String(deadline)],{stdio:['ignore','ignore','inherit','ipc']});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('owner_exited_before_ready_'+code)));});
  const {waitSupervisedActivity}=await import(path.join(source,'activity-supervisor.js'));
  let returned,error;try{returned=await waitSupervisedActivity(spool,binding);}catch(e){error=e.message;}
  const manifest=state.protectedRead(path.join(spool,'manifest.json'),3),result=state.protectedRead(resultFile,3);
  await exited;
  console.log(JSON.stringify({error,returned,trace,result_valid:state.validResult(result,manifest),effects:fs.readFileSync(path.join(root,'effects'),'utf8'),deadline_not_elapsed:Date.now()<deadline,supervisor_exited:!originalSame(manifest.pid,manifest.birth)}));
 }finally{if(child?.exitCode===null){fs.writeFileSync(path.join(root,'release'),'yes',{mode:0o600});await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(root,{recursive:true,force:true});}
}
(process.argv[2]==='--owner'?owner(process.argv[3],Number(process.argv[4])):probe(Number(process.argv[2]))).catch(error=>{console.error(error);process.exitCode=1;});
