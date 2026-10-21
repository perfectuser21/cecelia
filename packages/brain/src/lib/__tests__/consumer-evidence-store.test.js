import {expect,it} from 'vitest';
import {appendConsumerEvidence,assertConsumerScratch} from '../consumer-evidence-store.js';
it('执行型payload及未知种类在SQL前拒绝',async()=>{
 let calls=0;const db={query(){calls++;throw Error('unexpected');}};
 for(const kind of ['workflow','activity','other'])await expect(appendConsumerEvidence(db,kind,'id',{definition_scope:'executable',contract:{executable:true}},{})).rejects.toThrow('OPS_HISTORY_INPUT_INVALID');
 expect(calls).toBe(0);
});
it('隔离库名来自实际数据库，不由调用者布尔授权',async()=>{
 await expect(assertConsumerScratch({query:async()=>({rows:[{name:'cecelia'}]})})).rejects.toThrow('OPS_SCRATCH_REQUIRED');
 await expect(assertConsumerScratch({query:async()=>({rows:[{name:'cecelia_scratch'}]})})).resolves.toBeUndefined();
});
