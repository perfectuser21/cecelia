import {it,expect} from 'vitest';
import {hasGpuExecutionRequest,assertGpuExecutionSupported} from '../gpu-execution-contract.js';
it('只读结构化声明，不把文字中 GPU 识别为执行授权请求',()=>{
 for(const payload of [null,{}, {cmd:'echo GPU',description:'GPU 调研'}, {runtime_resources:{node_deps:'none'}}]){
  expect(hasGpuExecutionRequest(payload)).toBe(false);expect(()=>assertGpuExecutionSupported(payload)).not.toThrow();
 }
});
it('未知 GPU 契约字段即使空值也明确拒绝，错误不回显载荷',()=>{
 for(const value of [null,false,0,{},'private']){
  expect(()=>assertGpuExecutionSupported({runtime_resources:{gpu:value}})).toThrow(/GPU/);
  try{assertGpuExecutionSupported({gpu:value});}catch(e){expect(e.code).toBe('gpu_execution_unsupported');expect(e.message).not.toContain('private');}
 }
});
