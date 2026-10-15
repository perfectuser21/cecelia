import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {validateLeadgenTerminal,reapLeadgenTask} from '../leadgen-dispatch.js';
// 来自原104b真实entry+中央原件的脱敏字段投影，来源与原SHA见fixture；非业务模拟通过。
const original=JSON.parse(readFileSync(new URL('./fixtures/leadgen-104-empty-263.json',import.meta.url),'utf8'));
const check=async edit=>{const f=structuredClone(original);edit?.(f);return validateLeadgenTerminal({query:async()=>({rows:f.spans})},f.plan,{state:'terminal',exit_code:0,business_run_id:f.plan.business_run_id,receipt:f.receipt},{getBinding:async()=>f.context});};
describe('原263104空队列原形状收口',()=>{
 it('控制任务明确empty，原中央非PASS不伪造发送验收',async()=>{const got=await check();expect(got.status).toBe('completed');expect(got.business_outcome).toBe('empty');expect(got.outward_sent).toBe(0);expect(got.actual_send_acceptance).toBe(false);expect(got.reconciliation.business_outcome).not.toBe('pass');});
 it('控制task与task_run均显式留empty事实，真实清场后才放锁',async()=>{const f=structuredClone(original),plan={...f.plan,controller_run_id:'wfd-fixture'},finishRun=vi.fn(),finalizeTask=vi.fn(),releaseLock=vi.fn();const got=await reapLeadgenTask({query:async()=>({rows:f.spans})},{id:'task-fixture',run_id:plan.controller_run_id,payload:{leadgen_run:plan}},{probe:async()=>({state:'terminal',exit_code:0,business_run_id:plan.business_run_id,receipt:f.receipt}),getBinding:async()=>f.context,finishRun,finalizeTask,releaseLock});expect(got).toBe('completed');expect(finalizeTask.mock.calls[0][3].mergeResult.leadgen_dispatch.business_outcome).toBe('empty');expect(finishRun.mock.calls[0][0].result.actual_send_acceptance).toBe(false);expect(releaseLock).toHaveBeenCalledTimes(1);});
 it.each([
  f=>{f.receipt.split_result.results[1].result.sent=1;},
  f=>{f.receipt.split_result.results[1].result.reason='unknown';},
  f=>{f.receipt.split_result.results[3].verification.verified=false;},
  f=>{f.spans[0].outcome='fail';},
  f=>{f.spans[0].outcome='unknown';},
  f=>{f.spans[0].run_binding_id='forged';},
  f=>{f.spans=f.spans.filter(s=>s.reference_id!==f.context.workflow.payload.activities[3].reference_id);},
 ])('假空/失败/未知/清场未核不解锁',async edit=>{await expect(check(edit)).rejects.toThrow();});
});
