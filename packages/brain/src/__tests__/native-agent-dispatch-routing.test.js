import {expect,test,vi} from 'vitest';
const io=vi.hoisted(()=>({query:vi.fn(),breaker:vi.fn(()=>false)}));
vi.mock('../db.js',()=>({default:{query:(...args)=>io.query(...args)}}));
vi.mock('../circuit-breaker.js',()=>({isAllowed:(...args)=>io.breaker(...args),recordFailure:vi.fn(),recordSuccess:vi.fn()}));
import {dispatchQiumiTask} from '../dispatcher.js';
test('真实dispatcher专用出口不受旧OpenClaw熔断阻挡，不生成旧run_id且持久native设备提示',async()=>{
 const task={id:'10000000-0000-4000-8000-000000000001',task_type:'qiumi_task',status:'queued',tenant_id:'fixture',payload:{qiumi_source:{body:'请整理资料并回填。'}}};
 let patch;
 io.query.mockImplementation(async(sql,args)=>{
  if(sql.includes('SELECT * FROM tasks'))return {rows:[task],rowCount:1};
  if(sql.includes('UPDATE tasks SET payload')){patch=JSON.parse(args[1]);return {rows:[task],rowCount:1};}
  return {rows:[],rowCount:0};
 });
 const result=await dispatchQiumiTask(task,{env:{departments:['main'],deviceKeywords:[]},claimOwner:'fixture'});
 expect(result).toMatchObject({outcome:'proceed'});
 expect(io.breaker).not.toHaveBeenCalled();
 expect(patch).toMatchObject({provider:'native-agent',qiumi_route:{source:'native-agent'}});
 expect(patch).not.toHaveProperty('run_id');
});
