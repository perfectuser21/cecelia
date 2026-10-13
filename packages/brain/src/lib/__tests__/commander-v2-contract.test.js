import { it, expect } from 'vitest';
import { makeEnvelope, validateReady, validateDelivery } from '../commander-v2-contract.js';
const task={id:'task',payload:{commander_protocol:'commander-v2',workflow_key:'report',workflow_input:{text:'中文\n'}}};
const contract={input_schema:{type:'object'},resources:{},recovery:{max_attempts:2,total_timeout_sec:60,cleanup_timeout_sec:30}};
it('重试诊断定向保留旧断言、证据及摘要，不延长预算',()=>{
 const first=makeEnvelope(task,{},contract,null,new Date('2026-10-13T00:00:00Z'));
 const previous={envelope:first,failure:{reason:'verification_failed'},verification:{verdict:'FAIL',assertions:[{name:'csv',pass:false}],evidence:['source:readback']}};
 const next=makeEnvelope(task,{},contract,first,new Date('2026-10-13T00:00:10Z'),previous);
 expect(next.deadline_at).toBe(first.deadline_at);expect(next.cleanup_deadline_at).toBe(first.cleanup_deadline_at);
 expect(next.recovery.previous_attempt).toMatchObject({run_id:first.run_id,verification:{assertions:[{name:'csv',pass:false}],evidence:['source:readback']}});
});
it('ready必须匹配实际发布及运行端摘要，不能以ready=true掩盖漂移',()=>{
 const definition={release_id:'r',snapshot_sha256:'s',runtime_snapshot_sha256:'runtime'};
 expect(()=>validateReady({protocol:'commander-v2',ready:true,...definition,runtime_snapshot_sha256:'old'},definition)).toThrow('部署漂移');
});
it('completed输出schema无效给专用错误，身份冲突不能被降级为普通输出失败',()=>{
 const e=makeEnvelope(task,{}, {...contract,output_schema:{type:'object',required:['artifact']}},null);
 const d={...e,status:'completed',outputs:{},effects:[],evidence:[],cleanup:{completed:true,evidence:[]}};
 try{validateDelivery(d,e);throw Error('expected rejection');}catch(err){expect(err.code).toBe('COMMANDER_OUTPUT_CONTRACT_INVALID');}
 expect(()=>validateDelivery({...d,run_id:'other'},e)).toThrow('身份不符');
});
it('巨大诊断保留有界断言摘要和完整内容hash，不使安全恢复超信封预算',()=>{
 const first=makeEnvelope(task,{},contract,null);
 const previous={envelope:first,failure:{reason:'failed'},verification:{verdict:'FAIL',assertions:Array.from({length:40},()=>Object.fromEntries(Array.from({length:20},(_,i)=>[`field_${i}`,'大'.repeat(4000)]))),evidence:['source:full']}};
 const next=makeEnvelope(task,{},contract,first,new Date(),previous);
 expect(Buffer.byteLength(JSON.stringify(next.recovery.previous_attempt))).toBeLessThanOrEqual(30000);
 expect(next.recovery.previous_attempt.diagnostic_sha256).toMatch(/^[0-9a-f]{64}$/);
});
