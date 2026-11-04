import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {callbackFixture,pool} from './helpers/http-callback-fixture.js';
import {setBillingPause as boundarySetter} from '../executor.js';
let actual;
beforeAll(async()=>{
 vi.doMock('../platform-utils.js',async()=>({...await vi.importActual('../platform-utils.js'),calculatePhysicalCapacity:()=>4,getAvailableMemoryMB:()=>8000}));
 actual=await vi.importActual('../executor.js');
});
beforeEach(()=>{vi.clearAllMocks();actual.clearBillingPause();boundarySetter.mockImplementation(actual.setBillingPause);});
afterEach(()=>actual.clearBillingPause());

it('当前真实HTTP quota回调必须到真实pause状态及独立审计事件，不需要session start',async()=>{
 const reset=new Date(Date.now()+60000).toISOString();
 const f=await callbackFixture({task_type:'research'});
 const response=await f.invoke({status:'AI Quota Exhausted',result:{quota_reset_at:reset}});
 expect(response.status).toBe(200);expect(response.body.success).toBe(true);
 expect(boundarySetter).toHaveBeenCalledWith(reset,'quota_exhausted',pool);
 expect(actual.getBillingPause()).toMatchObject({active:true,resetTime:reset,reason:'quota_exhausted'});
 const writes=pool.query.mock.calls.filter(([sql])=>sql.includes("VALUES ('billing_pause_set'"));
 expect(writes).toHaveLength(1);
 expect(JSON.parse(writes[0][1][0])).toMatchObject({reset_at:reset,reason:'quota_exhausted'});
 expect(pool.query.mock.calls.some(([sql])=>sql.includes("VALUES ('session_end'"))).toBe(false);
 expect(f.client.query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'))[0][1][1]).toBe('quota_exhausted');
});
