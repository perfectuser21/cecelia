const fs=require('node:fs');
const path=require('node:path');
const {createWorkflowRunner}=require('../workflow-runner.cjs');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const r=createWorkflowRunner({...config,assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:()=>({onEvent:async e=>fs.appendFileSync(path.join(config.stateRoot,'events'),JSON.stringify(e)+'\n'),recordValidation:async()=>{},finalize:async()=>{},flush:async()=>({pending:0,blocked:0})})});
process.on('message',async m=>{try{process.send(await r[m.action](m.id));}catch(e){process.send({error:e.message});}});
