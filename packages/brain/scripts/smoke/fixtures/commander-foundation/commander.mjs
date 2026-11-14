import fs from 'node:fs';
import path from 'node:path';
let text='';for await(const chunk of process.stdin)text+=chunk;
const {request,root,scenario}=JSON.parse(text);
fs.writeFileSync(path.join(root,`commander-${request.sequence}.pid`),String(process.pid));
fs.appendFileSync(path.join(root,'decisions.jsonl'),JSON.stringify({sequence:request.sequence,pid:process.pid,run_id:request.run_id})+'\n');
if(scenario==='commander-kill'&&!fs.existsSync(path.join(root,'commander-killed'))){fs.writeFileSync(path.join(root,'commander-killed'),'yes');process.kill(process.pid,'SIGKILL');}
if(scenario==='host-kill'&&request.sequence===2&&!fs.existsSync(path.join(root,'fault-window'))){
  fs.writeFileSync(path.join(root,'fault-window'),'after-first-activity-checkpoint');
  await new Promise(()=>setInterval(()=>{},1000));
}
const {protocol,run_id,definition_sha256,sequence,state_sha256}=request;
console.log(JSON.stringify({protocol,run_id,definition_sha256,sequence,state_sha256,...request.allowed_actions[0],reason:'按固定目标和已验收产物推进'}));
