import {test,expect} from 'vitest';
import {createCommanderBridge} from '../runner-commander-bridge.js';

test('Commander不可达只留不可达事件，观察不会抛错或捏造状态',async()=>{
 const events=[];
 const bridge=createCommanderBridge({run_id:'r',onEvent:async e=>events.push(e),transport:async()=>{throw Error('offline');}});
 await bridge.wake();
 expect(await bridge.notify('work',{type:'progress'},{executor_kind:'agent'})).toEqual({action:'none'});
 expect(bridge.status).toBe('unavailable');
 expect(events.some(e=>e.event_type==='COMMANDER_UNAVAILABLE')).toBe(true);
 expect(bridge.isAborted('work')).toBe(false);
 await bridge.sleep();
});

test('纠偏进入下个agent回合，状态字段无权改变结果，code只被观察',async()=>{
 const events=[];
 const bridge=createCommanderBridge({run_id:'r',budget:{max_steers:2},onEvent:async e=>events.push(e),transport:async q=>q.phase==='event'?{action:'steer',text:'按A4补证据',status:'done'}:{action:'none'}});
 await bridge.wake();
 expect(await bridge.notify('code',{type:'progress'},{executor_kind:'code'})).toEqual({action:'none'});
 expect(bridge.takeGuidance('code')).toEqual([]);
 expect(await bridge.notify('agent',{type:'question'},{executor_kind:'agent'})).toEqual({action:'steer',text:'按A4补证据'});
 expect(bridge.takeGuidance('agent')).toEqual(['按A4补证据']);
 expect(bridge.takeGuidance('agent')).toEqual([]);
 expect(bridge.interventions('agent')).toBe(1);
 expect(events.some(e=>e.event_type==='COMMANDER_EXCHANGE'&&e.action?.action==='steer')).toBe(true);
});

test('每Activity只给一个恢复回合，预算耗尽不再调用Commander',async()=>{
 let calls=0;
 const bridge=createCommanderBridge({run_id:'r',budget:{max_steers:1,max_recovery_turns:1},transport:async q=>{calls++;return q.phase==='recovery'?{action:'steer',text:'修正一次'}:{action:'none'};}});
 await bridge.wake();
 expect((await bridge.recovery('a',{verdict:'fail'},{executor_kind:'agent'})).action).toBe('steer');
 expect(await bridge.recovery('a',{verdict:'fail'},{executor_kind:'agent'})).toEqual({action:'none'});
 expect(calls).toBe(2);
 expect(bridge.takeGuidance('a')).toEqual(['修正一次']);
});

test('abort只标记指定agent中止，旧版retry及外部批准动作不被执行',async()=>{
 let reply={action:'retry',status:'completed'};
 const bridge=createCommanderBridge({run_id:'r',transport:async q=>q.phase==='event'?reply:{action:'none'}});
 await bridge.wake();
 expect(await bridge.notify('a',{}, {executor_kind:'agent'})).toEqual({action:'none'});
 reply={action:'abort',reason:'证据不足，交主理人复核'};
 await bridge.notify('a',{}, {executor_kind:'agent'});
 expect(bridge.isAborted('a')).toBe(true);
 expect(bridge.isAborted('other')).toBe(false);
});

test('调用前按最大费用预留额度，超限不发起新的观察调用',async()=>{
 let calls=0;
 const bridge=createCommanderBridge({run_id:'r',budget:{max_cost:0.2,max_call_cost:0.1,max_calls:10},transport:async()=>{calls++;return {action:'none'};}});
 await bridge.wake();await bridge.notify('a',{}, {executor_kind:'agent'});await bridge.notify('a',{}, {executor_kind:'agent'});
 expect(calls).toBe(2);
});

test('Commander无响应受到独立超时限制，睡眠后不再发起观察',async()=>{
 const events=[];let calls=0;
 const bridge=createCommanderBridge({run_id:'r',budget:{timeout_ms:10,max_calls:2},onEvent:async e=>events.push(e),transport:async()=>{calls++;return new Promise(()=>{});}});
 await bridge.wake();await bridge.sleep();
 expect(await bridge.notify('agent',{type:'question'},{executor_kind:'agent'})).toEqual({action:'none'});
 expect(calls).toBe(1);
 expect(events.filter(e=>e.event_type==='COMMANDER_UNAVAILABLE')).toHaveLength(2);
 expect(events.at(-1).event_type).toBe('COMMANDER_SLEEP');
});

test('恢复预算超过一次、或费用没有调用上限时拒绝配置',()=>{
 expect(()=>createCommanderBridge({budget:{max_recovery_turns:2}})).toThrow(/budget_invalid/);
 expect(()=>createCommanderBridge({budget:{max_cost:1}})).toThrow(/budget_invalid/);
});
test('同run不可达后后续观察不再重复调用未知Commander回合',async()=>{
 let calls=0;const c=createCommanderBridge({run_id:'review',transport:async()=>{calls++;throw Error('offline');}});await c.wake();await c.notify('work',{type:'check_result'},{executor_kind:'code'});await c.sleep();expect(calls).toBe(1);expect(c.status).toBe('unavailable');
});

test('已证明旧Commander终止后允许接回，原调用预算不重置',async()=>{
 let calls=0;
 const c=createCommanderBridge({run_id:'reconnect',budget:{max_calls:2},transport:async()=>{
  calls++;if(calls===1)throw Object.assign(Error('commander_exited'),{commanderExecutionStopped:true});
  return {action:'answer',text:'继续原任务'};
 }});
 await c.wake();
 expect(await c.notify('work',{}, {executor_kind:'agent'})).toEqual({action:'answer',text:'继续原任务'});
 await c.notify('work',{}, {executor_kind:'agent'});
 expect(calls).toBe(2);expect(c.status).toBe('available');
});
test('未知旧回合只读核验终态后才接回',async()=>{
 let calls=0,stopped=false,reads=0;
 const transport=async()=>{calls++;if(calls===1)throw Error('connection_lost');return {action:'answer',text:'new-context'};};
 transport.reconcile=async()=>{reads++;return {execution_stopped:stopped};};
 const c=createCommanderBridge({run_id:'reconnect',transport});await c.wake();
 expect(await c.notify('work',{}, {executor_kind:'agent'})).toEqual({action:'none'});
 expect(calls).toBe(1);stopped=true;
 expect(await c.notify('work',{}, {executor_kind:'agent'})).toEqual({action:'answer',text:'new-context'});
 expect(calls).toBe(2);expect(reads).toBe(2);
});
