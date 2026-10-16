import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {authoringExecutionDatabase,startPureAuthoring,settleInvocation} from '../fixtures/authoring-execution-db.test.js';
import {createInvocationsRouter} from '../../routes/invocations.js';
import {readCapabilitySystem} from '../../lib/capability-system.js';
import {invocationTaskPrompt} from '../../invocations/runtime.js';
it.runIf(process.env.AUTHORING_BROWSER_PREVIEW==='1')('真实登记目录受控浏览器夹具及实际Bridge调用',async()=>{
 if(process.env.DB_NAME!=='cecelia_scratch'||process.env.DB_HOST!=='/tmp')throw Error('actual_scratch_required');
 const f=await authoringExecutionDatabase(),directory=mkdtempSync(join(tmpdir(),'authoring-browser-fixed-'));
 const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const codeHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 expect(execFileSync('git',['status','--porcelain=v1','--untracked-files=no'],{encoding:'utf8'}).trim()).toBe('');
 mkdirSync(join(directory,'skills/pure'),{recursive:true});mkdirSync(join(directory,'contracts'));
 writeFileSync(join(directory,'skills/pure/SKILL.md'),f.content);
 writeFileSync(join(directory,'contracts/pure.json'),JSON.stringify(Object.fromEntries(Object.entries(f.definition).filter(([key])=>key!=='source'))));
 git(['init','-b','cp-authoring-browser']);git(['config','user.name','Authoring browser']);git(['config','user.email','fixture@example.invalid']);git(['add','.']);git(['commit','-m','test: fixed browser skill']);
 f.definition.source.revision=git(['rev-parse','HEAD']);f.reader=source=>git(['show',`${source.revision}:${source.path}`]);
 const run=await startPureAuthoring(f),{executeCodex}=createRequire(import.meta.url)('../../../scripts/codex-bridge/codex-bridge.cjs');
 const actual=async(task,runId)=>(await executeCodex(process.env.CODEX_HOME,invocationTaskPrompt(task,runId),{workDir:directory,sandbox:'read-only',timeoutMs:180000})).output;
 for(let index=0;index<2;index++){
  const task=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows[0];
  await settleInvocation(f,task.id,actual);const advanced=await run.post('/advance',{});expect(advanced.body.status).toBe(index===0?'awaiting_execution':'completed');
 }
 for(const table of ['areas','enabler_calls','journey_features'])await f.pool.query(`CREATE TABLE ${f.schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
 const app=run.app;app.use('/api/brain/invocations',createInvocationsRouter({db:f.pool,readFile:f.reader,probeRuntime:async()=>({ready:true})}));
 app.get('/api/brain/map/registry',async(_req,res)=>{try{res.json(await readCapabilitySystem(f.pool));}catch(error){res.status(500).json({error:error.code??error.message});}});
 let running=false;
 app.post('/__fixture/drive/:id',async(req,res)=>{
  if(!process.env.CECELIA_INTERNAL_TOKEN||req.get('x-internal-token')!==process.env.CECELIA_INTERNAL_TOKEN)return res.sendStatus(401);
  if(running)return res.sendStatus(409);running=true;
  try{const task=(await f.pool.query('SELECT payload FROM tasks WHERE id=$1',[req.params.id])).rows[0];
   if(task?.payload?.invocation?.envelope.authoring_task_id!==run.id)return res.sendStatus(404);
   res.json({actual_process:true,task_id:req.params.id,run_id:await settleInvocation(f,req.params.id,actual)});
  }catch(error){res.status(409).json({error:error.message});}finally{running=false;}
 });
 const registry=await readCapabilitySystem(f.pool);expect(registry.workflows).toHaveLength(1);expect(registry.workflows[0].activities[0].usage.slot_key).toBe('uppercase');
 const server=await new Promise(resolve=>{const value=app.listen(Number(process.env.AUTHORING_PREVIEW_PORT??15284),'127.0.0.1',()=>resolve(value));});
 process.stdout.write(JSON.stringify({preview:true,code_head:codeHead,port:server.address().port,authoring_task_id:run.id,
  workflow_id:registry.workflows[0].id,activity_id:registry.activities[0].id,slot_key:'uppercase',compose_sha256:run.compose.state.outputs.compose.definition_sha256,
  skill_git_revision:f.definition.source.revision,readFile:'fixed-local-git-show',runtime_probe:'controlled-preview-ready',execution:'actual-Codex-Bridge-executeCodex',schema:f.schema})+'\n');
 await new Promise(resolve=>{for(const signal of ['SIGINT','SIGTERM','SIGUSR2'])process.once(signal,resolve);});
 await new Promise(resolve=>server.close(resolve));await f.close();rmSync(directory,{recursive:true,force:true});
},900000);
