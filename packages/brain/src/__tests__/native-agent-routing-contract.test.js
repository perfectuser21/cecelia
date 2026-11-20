import {expect,test} from 'vitest';
import {resolveDispatchRoute} from '../lib/dispatch-route.js';
import {getTaskType} from '../lib/task-type-registry.js';
import {JOBS} from '../scheduler-jobs.js';
test('qiumi派发合同是真native入口，任务surface不能仍声明OpenClaw',()=>{
 expect(resolveDispatchRoute({task_type:'qiumi_task',payload:{executor:'codex'}})).toMatchObject({route:'native-agent',available:true,executor:'native-agent'});
 expect(getTaskType('qiumi_task')).toMatchObject({surface:'native-agent',watchdog:'external-worker'});
});
test('原生持久run有独立真实收割入口，不靠旧OpenClaw exit文件',()=>{
 expect(JOBS.find(x=>x.name==='native-agent-reaper')).toMatchObject({needsPool:true,cadence:{everySec:30}});
});
