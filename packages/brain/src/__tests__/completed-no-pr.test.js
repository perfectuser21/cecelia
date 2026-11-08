import {describe,it,expect,vi,beforeEach} from 'vitest';
import {callbackFixture,pool} from './helpers/http-callback-fixture.js';
const PR='https://github.com/perfectuser21/cecelia/pull/1';
beforeEach(()=>vi.clearAllMocks());
describe('真实HTTP callback的无PR判定和有界重排',()=>{
  it.each([
    ['dev',{},null,'completed_no_pr',true],
    ['dev',{},PR,'completed',false],
    ['research',{},null,'completed',false],
    ['dev',{decomposition:'true'},null,'completed',false],
    ['dev',{decomposition:'known'},null,'completed_no_pr',true],
    ['dev',{decomposition:'false'},null,'completed_no_pr',true],
    ['dev',{harness_mode:'false'},null,'completed_no_pr',true],
    ['dev',{next_action:'decompose'},null,'completed_no_pr',true],
    ['dev',{decomposition:'known'},PR,'completed',false],
    ['dev',{harness_mode:true},null,'completed',false],
  ])('%s payload=%j pr=%s → %s',async(task_type,payload,pr_url,status,reschedule)=>{
    const f=await callbackFixture({task_type,payload});
    const response=await f.invoke({pr_url});
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const updates=f.client.query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'));
    expect(updates).toHaveLength(1);
    expect(updates[0][1][1]).toBe(status);
    const queued=pool.query.mock.calls.filter(([sql])=>sql.includes("SET status = 'queued'"));
    expect(queued).toHaveLength(reschedule?1:0);
    if(reschedule){
      expect(queued[0][0]).toContain('retry_count = retry_count + 1');
      expect(queued[0][0]).toContain('completed_at = NULL');
      expect(queued[0][1][0]).toBe(f.task.id);
      expect(new Date(queued[0][1][1]).getTime()-Date.now()).toBeGreaterThan(290000);
      expect(new Date(queued[0][1][1]).getTime()-Date.now()).toBeLessThanOrEqual(300000);
    }
  });
  it.each([2,3,4])('retry_count=%i在真实callback以3为界',async(retry_count)=>{
    const f=await callbackFixture({task_type:'dev',retry_count});
    expect((await f.invoke({})).status).toBe(200);
    expect(pool.query.mock.calls.some(([sql])=>sql.includes('SELECT retry_count'))).toBe(true);
    expect(pool.query.mock.calls.filter(([sql])=>sql.includes("SET status = 'queued'"))).toHaveLength(retry_count<3?1:0);
  });
  it('失败回执不会被无PR逻辑转成成功或重排',async()=>{
    const f=await callbackFixture({task_type:'dev'});
    expect((await f.invoke({status:'AI Failed',result:{error:'fixture'}})).status).toBe(200);
    expect(f.client.query.mock.calls.find(([sql])=>sql.includes('UPDATE tasks'))[1][1]).toBe('failed');
    expect(pool.query.mock.calls.some(([sql])=>sql.includes('SELECT retry_count'))).toBe(false);
  });
});
