import {test,expect,vi} from 'vitest';
import {dispatchTask,pollOnce,releaseOwnLock,superviseFactorySession} from '../factory-dispatcher.js';
function dependencies(){const effect=vi.fn();return {effect,log:vi.fn(),brain:{listQueued:effect,getTask:effect,claim:effect,heartbeat:effect,patch:effect},runSsh:effect,spawnAgent:effect,mkdir:effect,writeFile:effect,readFile:effect,now:()=>new Date('2026-11-03T05:00:00Z')};}
test.each([{}, {dispatchMode:'all'}, {dispatchMode:'verify-only'}])('factory starts require common-runner migration before claim/device/session %j',async options=>{
 const deps=dependencies();const result=await dispatchTask({id:'task',task_type:'skill_factory_run',payload:{factory_dispatch:true}},deps,options);
 expect(result).toMatchObject({outcome:'needs_review',reason:'common_runner_migration_required'});expect(deps.effect).not.toHaveBeenCalled();expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('common_runner_migration_required'));
});
test('default poll never leases a phone or creates a legacy session, including after hours',async()=>{
 const deps=dependencies();const result=await pollOnce(deps);expect(result).toMatchObject({outcome:'needs_review',reason:'common_runner_migration_required'});expect(deps.effect).not.toHaveBeenCalled();
});
test('historical lock cleanup rejects unknown stop and retains ownership',async()=>{
 const effect=vi.fn();const result=await releaseOwnLock({status:effect,release:effect},'old',()=>{}, {execution_stopped:false});
 expect(result).toMatchObject({released:false,reason:'execution_stop_unconfirmed'});expect(effect).not.toHaveBeenCalled();
});

test.each(['completed','lease_lost'])('historical supervision observes %s without creating/killing/releasing a session',async state=>{
 const effect=vi.fn(),deps={now:()=>new Date(),sleep:async()=>{},log:()=>{},readLog:async()=>'',brain:{heartbeat:async()=>({status:state==='lease_lost'?409:200}),getTask:async()=>({status:state}),patch:effect}};
 const result=await superviseFactorySession(deps,{leaseSeconds:10,sessionPollMs:1},{taskId:'old',runId:'old',lock:{release:effect},handle:{kill:effect,isExited:()=>false},logFile:'history'});
 expect(result.kind).toBe(state==='lease_lost'?'lease_lost':'terminal');expect(effect).not.toHaveBeenCalled();
});
test.each([undefined,{}, {execution_stopped:false}])('stop proof %j must retain phone even if old worker claims terminal',async evidence=>{
 const effect=vi.fn();const result=await releaseOwnLock({status:effect,release:effect},'old',()=>{},evidence);expect(result.released).toBe(false);expect(effect).not.toHaveBeenCalled();
});
