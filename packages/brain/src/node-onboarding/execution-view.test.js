import {it,expect} from 'vitest';
import {withLinuxExecution} from './execution-view.js';
const view={steps:[],capabilities:{monitoring:true,execution:false}};
it('续验、撤销与失败不显示执行就绪，明确执行证据才完成',()=>{
 for(const phase of ['renew_revoke','renew_wait','renewal','identity','revoked']){
  const result=withLinuxExecution(view,{phase,execution:false});
  expect(result.capabilities.execution).toBe(false);expect(result.status).not.toBe('completed');
  expect(result.automatic).toBe(phase!=='revoked');
 }
 const failed=withLinuxExecution(view,{phase:'script_canary',error:'secret internal detail'});
 expect(failed.status).toBe('failed');expect(failed.error).not.toContain('secret');
 expect(withLinuxExecution(view,{phase:'active',execution:true})).toMatchObject({status:'completed',capabilities:{execution:true,monitoring:true}});
});
