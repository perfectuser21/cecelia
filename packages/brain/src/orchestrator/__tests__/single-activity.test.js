import {test, expect} from 'vitest';
import {runSingleActivity} from '../activity-runtime.js';
const activity = (key, order) => ({key, order, budget:{max_duration_s:2,heartbeat_s:1},
  failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},
  runtime:{phase:'source',protocol:'json-stdio-v1',entry:'work.mjs'}});
const plan = {workflow:'selection',activities:[activity('first',1),activity('second',2)]};
const result = input => ({schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{value:42},metrics:{},evidence:['actual-product']});
test('完整冻结合同中仅执行Commander选中的单Activity，原输入与累计context分离', async () => {
  const contract=structuredClone(plan);contract.activities[1].runtime.input={run_tag:'$input.run_tag',original:'$input.value',previous:'$.value'};
  const calls=[];
  const receipt=await runSingleActivity(contract,{run_tag:'one',value:1},{activityKey:'second',context:{run_tag:'one',value:2},
    executeActivity:async(a,input)=>{calls.push([a.key,input.original,input.previous]);return result(input);},checkActivity:async()=>({verdict:'pass'})});
  expect(calls).toEqual([['second',1,2]]);
  expect(receipt.scope).toBe('activity');expect(receipt.activities.map(x=>x.key)).toEqual(['second']);
});

test('选择finalize确实执行，start检查失败不得绕权',async()=>{const contract=structuredClone(plan);contract.activities[1].runtime.phase='finalize';let calls=0;const options={activityKey:'second',executeActivity:async(_a,i)=>{calls++;return result(i);},checkActivity:async()=>({verdict:'pass'})};expect((await runSingleActivity(contract,{run_tag:'one'},options)).activities.map(a=>a.key)).toEqual(['second']);expect(calls).toBe(1);options.checkActivity=async()=>({verdict:'fail'});expect((await runSingleActivity(contract,{run_tag:'one'},options)).status).not.toBe('completed');expect(calls).toBe(1);});
