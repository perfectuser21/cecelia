import fs from 'node:fs';
import path from 'node:path';
let text='';for await(const chunk of process.stdin)text+=chunk;
const input=JSON.parse(text), key=process.argv[2];
fs.writeFileSync(path.join(input.root,`${key}.pid`),String(process.pid));
const outputs=key==='prepare'?{base:21}:{answer:input.base*2};
const result={schema_version:1,run_tag:input.run_tag,status:'completed',outputs,metrics:{produced:1},evidence:[`${key}.json`]};
fs.appendFileSync(path.join(input.root,`${key}.effects`),'x');
fs.writeFileSync(path.join(input.root,`${key}.json`),JSON.stringify({identity:input.action_identity,result}));
if(['effect-window','unknown-readback'].includes(input.scenario)&&key==='prepare'&&!fs.existsSync(path.join(input.root,'fault-window'))){
  fs.writeFileSync(path.join(input.root,'fault-window'),'effect-committed-before-receipt');
  await new Promise(()=>setInterval(()=>{},1000));
}
if(input.scenario==='auto-supervise'&&key==='prepare'){fs.writeFileSync(path.join(input.root,'fault-window'),'supervised-effect-committed');await new Promise(r=>setTimeout(r,2500));}
console.log(JSON.stringify(result));
