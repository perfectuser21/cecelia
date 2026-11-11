const fs=require('node:fs'),path=require('node:path');
const state=require('../../../src/orchestrator/activity-supervisor-state.cjs');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const saved=state.protectedRead(path.join(config.stateRoot,process.argv[3]+'.json'));
const spool=path.join(config.stateRoot,saved.identity.run_id,'activity-supervisor');
const manifest=state.protectedRead(path.join(spool,'manifest.json'),3),originalSame=state.sameProcess;
let triggered=false;
state.sameProcess=(pid,birth)=>{
 if(triggered||pid!==manifest.pid)return originalSame(pid,birth);
 triggered=true;const resultFile=path.join(spool,'result.json'),result_before=fs.existsSync(resultFile);
 fs.writeFileSync(path.join(saved.profile.cwd,'release'),'yes',{mode:0o600});
 const until=Date.now()+5000;while(Date.now()<until&&originalSame(pid,birth))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 const same_process=originalSame(pid,birth);
 fs.writeFileSync(path.join(config.stateRoot,'startup-probe.json'),JSON.stringify({result_before,same_process,result_after:fs.existsSync(resultFile)}),{mode:0o600});
 return same_process;
};
require('./cold-recovery-worker.cjs');
