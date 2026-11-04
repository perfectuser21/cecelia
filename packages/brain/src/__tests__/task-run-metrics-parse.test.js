import {describe,it,expect,vi,beforeEach} from 'vitest';
import {callbackFixture,pool} from './helpers/http-callback-fixture.js';
beforeEach(()=>vi.clearAllMocks());
async function metrics(result,status='AI Done'){
  const f=await callbackFixture({queued_at:'2026-11-01T00:00:00Z',started_at:'2026-11-01T00:00:02Z'});
  const response=await f.invoke({result,status,duration_ms:3000,iterations:2,run_id:'fixture-run'});
  expect(response.status).toBe(200);expect(response.body.success).toBe(true);
  const calls=pool.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO task_run_metrics'));
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toContain('ON CONFLICT (task_id, run_id) DO UPDATE');
  const args=calls[0][1];expect(args.slice(0,4)).toEqual([f.task.id,'fixture-run',3000,2000]);
  return args;
}
describe('真实HTTP callback→task_run_metrics参数',()=>{
  it('选最高成本主模型并将真实token/cache/cost写到当前INSERT',async()=>{
    const args=await metrics({total_cost_usd:0.7,num_turns:4,usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:300,cache_creation_input_tokens:40},modelUsage:{cheap:{costUSD:0.1},primary:{costUSD:0.6}}});
    expect(args.slice(4,15)).toEqual(['primary',4,100,20,300,40,0.75,0.7,'success',null,2]);
  });
  it('camelCase缓存字段按真实消费者解析并四位舍入',async()=>{
    const args=await metrics({usage:{input_tokens:2,cacheReadInputTokens:1,cacheCreationInputTokens:9}});
    expect(args.slice(6,11)).toEqual([2,null,1,9,0.3333]);
  });
  it('0输入/缓存、缺用量保持当前null合同，不复制解析函数',async()=>{
    const args=await metrics({usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0}});
    expect(args.slice(4,12)).toEqual([null,null,null,null,null,null,null,null]);
  });
  it.each([null,'not-json'])('无结构result=%j仍实际写到metrics',async result=>{
    const args=await metrics(result);expect(args[4]).toBeNull();expect(args[10]).toBeNull();
  });
  it('失败回执的exit_status真实写failed',async()=>{
    expect((await metrics({error:'fixture'},'AI Failed'))[12]).toBe('failed');
  });
});
