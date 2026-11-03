import {test,expect,vi} from 'vitest';
vi.mock('../../db.js',()=>({default:{query:vi.fn()}}));
vi.mock('../../runtime-safety.js',()=>({assertExternalExecutionAllowed:()=>{}}));
import {createRequire} from 'node:module';
import {resolveDispatchRoute,assertTaskTypeHasExecutor} from '../../lib/dispatch-route.js';
import {spawnSkillRelaySession} from '../../harness-skill-relay.js';
import {createKernelRun} from '../kernel-run-store.js';
import {runKernelMain} from '../run.js';
const require=createRequire(import.meta.url);
const id='11111111-1111-4111-8111-111111111111';

test.each([{}, {executor:'codex',machine:'xian-m4'}])('golden_path_proposal新建必须拒绝退役kernel而非改名冒充迁移 %j',payload=>{
 expect(resolveDispatchRoute({task_type:'golden_path_proposal',payload})).toMatchObject({available:false,route:'retired-harness-kernel'});
 expect(()=>assertTaskTypeHasExecutor({task_type:'golden_path_proposal',payload})).toThrow(/公共Runner|common.runner/i);
});
test.each([{task_type:'golden_path_proposal',payload:{executor:'codex'}},{task_type:'harness_initiative',payload:{executor:'codex',mode:'headed'}},{task_type:'research',payload:{orchestrator:'skill-relay',executor:'codex'}}])('legacy relay各执行分支不创建新会话 %j',async task=>{
 const effects=vi.fn();const result=await spawnSkillRelaySession({id,...task},{pool:{query:effects},execFn:effects,env:{CECELIA_LOCAL_EXECUTION_ENABLED:'true'}});
 expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effects).not.toHaveBeenCalled();
});
test('createKernelRun在触及事务、预检、凭据前拒绝全部新建',async()=>{
 const connect=vi.fn();await expect(createKernelRun({connect},{taskId:id,initiativeId:id,createdSource:'kernel_dispatch'})).rejects.toMatchObject({code:'kernel_runtime_retired'});expect(connect).not.toHaveBeenCalled();
});
test('直接非dry CLI入口不能经完整controller身份重新起kernel，也不终结既有run',async()=>{
 const buildDeps=vi.fn(),runLoopFn=vi.fn(),finalizeRun=vi.fn();await expect(runKernelMain({taskId:id,runId:id,controllerSessionId:id,controllerGeneration:1,dryRun:false},{buildDeps,runLoopFn,finalizeRun})).rejects.toMatchObject({code:'kernel_runtime_retired'});expect(buildDeps).not.toHaveBeenCalled();expect(runLoopFn).not.toHaveBeenCalled();expect(finalizeRun).not.toHaveBeenCalled();
});
test('Fleet orchestrator prepare/start不准备工作区、不spawn，退役无环境开关',async()=>{
 const {createOrchestratorRunner}=require('../../../scripts/fleet-worker/orchestrator-runner.cjs');const effect=vi.fn();const runner=createOrchestratorRunner({workspaceManager:{prepare:effect},spawnFn:effect,resolveMainShaFn:effect,hostname:'test',env:{CECELIA_HARNESS_RUNTIME:'kernel-v1',CECELIA_LOCAL_EXECUTION_ENABLED:'true'}});
 await expect(runner.prepare({run_id:id,task_id:id})).rejects.toMatchObject({statusCode:410,message:'kernel_runtime_retired'});
 await expect(runner.start(id,{controller_session_id:id,controller_generation:1})).rejects.toMatchObject({statusCode:410,message:'kernel_runtime_retired'});
 expect(effect).not.toHaveBeenCalled();expect(runner.maintenance()).toMatchObject({preparing:0,prepared:0,running_processes:0});
});

test('延迟启动重试不得把旧kernel重新排队，也不更改未知在途占用',async()=>{
 const {requeueKernelRunLaunchDeferred}=await import('../kernel-run-store.js');const connect=vi.fn();
 await expect(requeueKernelRunLaunchDeferred({connect},{runId:id,expectedTaskId:id,reason:'timeout'})).rejects.toMatchObject({code:'kernel_runtime_retired'});
 expect(connect).not.toHaveBeenCalled();
});
test('Fleet真实HTTP边界拒绝替代runner启动，但保留历史inspect/terminal',async()=>{
 const {createFleetWorkerServer}=require('../../../scripts/fleet-worker/fleet-worker.cjs');
 const effect=vi.fn();const inspect=vi.fn(async()=>({status:'running'})),terminal=vi.fn(async()=>({status:'done'}));
 const token='retirement-token-at-least-32-bytes';const server=createFleetWorkerServer({attemptToken:token,orchestratorRunner:{prepare:effect,start:effect,inspect,terminal}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const suffix of ['prepare',`${id}/start`]){const res=await fetch(`${base}/harness/orchestrators/${suffix}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'});expect(res.status).toBe(410);expect(await res.json()).toEqual({error:'kernel_runtime_retired'});}
 for(const action of ['inspect','terminal']){const res=await fetch(`${base}/harness/orchestrators/${id}/${action}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'});expect(res.status).toBe(200);}
 expect(effect).not.toHaveBeenCalled();expect(inspect).toHaveBeenCalledOnce();expect(terminal).toHaveBeenCalledOnce();
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('历史live canary不能绕过store直接创建kernel行或远程启动',async()=>{
 const {ensureSyntheticRun,createLiveDispatch}=await import('../../../scripts/smoke/kernel-fleet-three-machine-canary.mjs');
 const effect=vi.fn();await expect(ensureSyntheticRun({query:effect},id)).rejects.toMatchObject({code:'kernel_runtime_retired'});
 await expect(createLiveDispatch({runId:id,env:{},fetchFn:effect})).rejects.toMatchObject({code:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
});
test('新建run的Brain HTTP入口退役，历史router仍挂载',async()=>{
 const express=require('express');const {createHarnessAttemptRunRouter}=await import('../../routes/harness-attempt-run.js');
 const {default:initiativeRouter}=await import('../../routes/initiatives.js');const db=(await import('../../db.js')).default;db.query.mockClear();
 const effect=vi.fn();const app=express();app.use(express.json());const attemptRouter=createHarnessAttemptRunRouter({pool:{query:effect},depsFactory:effect});app.use('/harness',attemptRouter);app.use('/initiatives',initiativeRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{for(const path of ['/harness/attempt-run','/initiatives/relay-runs',`/initiatives/relay-runs/${id}`]){const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({run_id:id,current_task_id:id,initiative_id:id,role:'generator'})});expect(response.status).toBe(410);expect((await response.json()).error).toBe('kernel_runtime_retired');}
 expect(effect).not.toHaveBeenCalled();expect(db.query).not.toHaveBeenCalled();expect(attemptRouter.stack.some(l=>l.route?.path==='/attempt-run/close')).toBe(true);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
