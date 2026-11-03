import {test} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createWorkflowRunner,profileDigest}=require('./workflow-runner.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'common-runner-'));
 const code=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);const fs=await import('node:fs');fs.appendFileSync('effects','x');console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:42},metrics:{},evidence:[{path:'effects'}]}));`;
 const validator=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s),fs=await import('node:fs');const observed=x.phase==='start'?fs.existsSync('work.mjs'):x.receipt.outputs.answer;console.log(JSON.stringify({verdict:(x.phase==='start'?observed:observed===42)?'pass':'fail',acceptance_ref:x.acceptance.ref,evidence:[{observed}]}));`;
 fs.writeFileSync(path.join(root,'work.mjs'),code);fs.writeFileSync(path.join(root,'check.mjs'),validator);
 const profile={cwd:root,files:{'work.mjs':hash(code),'check.mjs':hash(validator)},contract:{workflow:'demo',activities:[{key:'work',order:1,budget:{max_duration_s:5,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{protocol:'json-stdio-v1',phase:'source',entry:'work.mjs'}}]},metadata:{work:{activity_id:randomUUID(),executor_kind:'code',questions:{}}},validators:{workflow:{entry:'check.mjs',acceptance:{ref:'demo-dod@1',description:'answer is 42'}}}};
 const id={run_id:randomUUID(),task_id:randomUUID(),profile:'demo',input:{run_tag:'demo'},mode:'exploration',profile_sha256:profileDigest(profile)};
 return {root,profile,id};
}
async function terminal(r,id){for(let i=0;i<150;i++){const s=await r.inspect(id);if(!['running','starting','validating'].includes(s.status))return s;await new Promise(r=>setTimeout(r,20));}throw Error('not terminal');}
function recorder(){return {onEvent:async()=>{},recordValidation:async()=>{},finalize:async()=>{},flush:async()=>({pending:0}),inspect:()=>({pending:0})};}
test('real activity + independent validator, duplicate start has one effect',async()=>{
 const f=fixture();try{
 const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});
 await r.start(f.id);await r.start(f.id);const s=await terminal(r,f.id);
 assert.equal(s.status,'completed');assert.equal(s.validation.workflow.verdict,'pass');assert.equal(s.validation.activities.work.verdict,'unknown');
 assert.equal(fs.readFileSync(path.join(f.root,'effects'),'utf8'),'x');
 await assert.rejects(r.start({...f.id,input:{run_tag:'changed'}}),/identity_conflict/);
 const next=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});
 await next.start(f.id);assert.equal(fs.readFileSync(path.join(f.root,'effects'),'utf8'),'x');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('rejects unpinned source before effects and formal incomplete identity',async()=>{
 const f=fixture();try{const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});
 await assert.rejects(r.start({...f.id,mode:'formal'}),/formal_identity_required/);
 fs.appendFileSync(path.join(f.root,'work.mjs'),'\n//changed');await assert.rejects(r.start(f.id),/source_mismatch/);assert.equal(fs.existsSync(path.join(f.root,'effects')),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('restart while running quarantines identity rather than restarting side effects',async()=>{
 const f=fixture();try{fs.mkdirSync(path.join(f.root,'state'),{recursive:true});fs.writeFileSync(path.join(f.root,'state',f.id.run_id+'.json'),JSON.stringify({identity:f.id,status:'running',machine_id:'test'}));
 const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});
 assert.equal((await r.start(f.id)).status,'unknown');assert.equal(fs.existsSync(path.join(f.root,'effects')),false);
 assert.equal((await r.maintenance()).pending,1);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('agent adapter receives only its pinned skill, and missing skill prevents launch',async()=>{
 const f=fixture();try{
 const source=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);if(x.skill?.content!=='Return forty two'||x.skill.version!=='v1')process.exit(2);console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:42},metrics:{},evidence:[{observed:'skill loaded'}]}));`;
 fs.writeFileSync(path.join(f.root,'work.mjs'),source);fs.writeFileSync(path.join(f.root,'skill.md'),'Return forty two');f.profile.files['work.mjs']=hash(source);f.profile.files['skill.md']=hash('Return forty two');f.profile.metadata.work.executor_kind='agent';f.profile.metadata.work.skill={entry:'skill.md',version:'v1'};f.id.profile_sha256=profileDigest(f.profile);
 const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});await r.start(f.id);assert.equal((await terminal(r,f.id)).status,'completed');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('activity cannot replace a pinned validator and obtain pass',async()=>{
 const f=fixture();try{const code=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.writeFileSync('check.mjs',"console.log(JSON.stringify({verdict:'pass',acceptance_ref:'demo-dod@1',evidence:[{}]}))");console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:42},metrics:{},evidence:[]}));`;fs.writeFileSync(path.join(f.root,'work.mjs'),code);f.profile.files['work.mjs']=hash(code);f.id.profile_sha256=profileDigest(f.profile);
 const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});await r.start(f.id);assert.equal((await terminal(r,f.id)).status,'unknown');assert.equal((await r.maintenance()).pending,1);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('formal profile reuses fixed versions but binds each run separately',async()=>{
 const f=fixture();try{
 const m=f.profile.metadata.work;const uid=()=>randomUUID();
 m.questions=Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1'].map(q=>[q,{ref:q==='A4'?'demo-dod@1':q+'@1',version:'1',declared:{value:q}}]));
 m.identity={identity_protocol:2,workflow_id:uid(),reference_id:uid(),workflow_definition_version_id:uid(),activity_definition_version_id:uid()};f.profile.validators.work=f.profile.validators.workflow;f.profile.preconditions={work:{entry:'check.mjs',acceptance:{ref:'A2@1'}}};
 f.id.mode='formal';f.id.profile_sha256=profileDigest(f.profile);
 const binding=()=>({run_binding_id:uid(),workflow_id:m.identity.workflow_id,workflow_definition_version_id:m.identity.workflow_definition_version_id,attempt_key:uid(),activities:{work:{activity_id:m.activity_id,reference_id:m.identity.reference_id,activity_definition_version_id:m.identity.activity_definition_version_id}}});
 const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});
 const one={...f.id,run_binding:binding()};await r.start(one);assert.equal((await terminal(r,one)).status,'completed');
 const two={...f.id,run_id:uid(),run_binding:binding()};await r.start(two);assert.equal((await terminal(r,two)).status,'completed');assert.equal(fs.readFileSync(path.join(f.root,'effects'),'utf8'),'xx');
 assert.notEqual(JSON.parse(fs.readFileSync(path.join(f.root,'state',one.run_id+'.json'))).profile.metadata.work.identity.run_binding_id,JSON.parse(fs.readFileSync(path.join(f.root,'state',two.run_id+'.json'))).profile.metadata.work.identity.run_binding_id);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('automatic retry requires an explicit safety declaration; budget is bounded',async()=>{
 const f=fixture();try{const a=f.profile.contract.activities[0];a.runtime.max_attempts=2;f.id.profile_sha256=profileDigest(f.profile);const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});
 await assert.rejects(r.start(f.id),/retry_safety_required/);assert.equal(fs.existsSync(path.join(f.root,'effects')),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('resource refusal confirms no launch, allowing the same run after capacity returns',async()=>{
 const f=fixture();let blocked=true;try{const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{if(blocked)throw Error('worker_draining');},assertLocalResources:async()=>{},createRecorder:recorder});
 const wait=await r.start(f.id);assert.equal(wait.status,'waiting_resources');assert.equal(wait.execution_state,'not_started');assert.equal(fs.existsSync(path.join(f.root,'effects')),false);
 blocked=false;await r.start(f.id);assert.equal((await terminal(r,f.id)).status,'completed');assert.equal(fs.readFileSync(path.join(f.root,'effects'),'utf8'),'x');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('cancel before acceptance leaves a durable tombstone against late start',async()=>{
 const f=fixture();try{const opts={stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder};const r=createWorkflowRunner(opts);
 assert.equal((await r.cancel(f.id)).status,'cancelled_before_start');await r.start(f.id);assert.equal(fs.existsSync(path.join(f.root,'effects')),false);r.close();const restarted=createWorkflowRunner(opts);await restarted.start(f.id);assert.equal(fs.existsSync(path.join(f.root,'effects')),false);restarted.close();
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('cancel during recorder preparation cannot be lost before controller registration',async()=>{
 const f=fixture();let release,entered;const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);try{
 const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:async()=>{entered();await hold;return recorder();}});
 const starting=r.start(f.id);await ready;await r.cancel(f.id);release();await starting;const final=await terminal(r,f.id);assert.equal(final.status,'unknown');assert.equal(fs.existsSync(path.join(f.root,'effects')),false);r.close();
 }finally{release?.();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('concurrent different runs that race the launch lock can wait and progress safely',async()=>{
 const f=fixture();try{const r=createWorkflowRunner({stateRoot:path.join(f.root,'state'),machineId:'test',profiles:{demo:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:recorder});const two={...f.id,run_id:randomUUID()};
 const results=await Promise.all([r.start(f.id),r.start(two)]);const waitingIndex=results.findIndex(s=>s.status==='waiting_resources');assert.notEqual(waitingIndex,-1);const accepted=waitingIndex===0?two:f.id,waiting=waitingIndex===0?f.id:two;
 assert.equal(results[waitingIndex].execution_state,'not_started');await terminal(r,accepted);await r.start(waiting);assert.equal((await terminal(r,waiting)).status,'completed');assert.equal(fs.readFileSync(path.join(f.root,'effects'),'utf8'),'xx');r.close();
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('formal定义只有A2声明而无独立preconditions时拒绝启动',async()=>{
 const f=fixture();try{const m=f.profile.metadata.work,uid=()=>randomUUID();m.questions=Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1'].map(q=>[q,{ref:q==='A4'?'demo-dod@1':q+'@1',version:'1',declared:{value:q}}]));m.identity={identity_protocol:2,workflow_id:uid(),reference_id:uid(),workflow_definition_version_id:uid(),activity_definition_version_id:uid()};f.profile.validators.work=f.profile.validators.workflow;
 const {assertProfile}=require('./workflow-profile.cjs');assert.throws(()=>assertProfile(f.profile,'formal'),/formal_precondition_required/);assert.equal(fs.existsSync(path.join(f.root,'effects')),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('免清场只能由显式无资源且无finalize的固定profile声明',()=>{
 const f=fixture();try{const {assertProfile}=require('./workflow-profile.cjs');f.profile.cleanup_required=false;assert.throws(()=>assertProfile(f.profile,'exploration'),/cleanup_obligation_invalid/);f.profile.resources=[];assert.doesNotThrow(()=>assertProfile(f.profile,'exploration'));f.profile.resources=['phone'];assert.throws(()=>assertProfile(f.profile,'exploration'),/cleanup_obligation_invalid/);f.profile.resources=[];f.profile.contract.activities[0].runtime.phase='finalize';assert.throws(()=>assertProfile(f.profile,'exploration'),/cleanup_obligation_invalid/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
