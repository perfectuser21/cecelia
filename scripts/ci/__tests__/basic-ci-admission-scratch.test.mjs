import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCiAdmissionScratch} from '../ci-admission-scratch.mjs';
const id='123456781234412381231234567890ab';
test('专属CI schema由原scratch租约受控改名，关闭两侧名称且不写public',async()=>{
 const calls=[];let closed=0;
 const db={query:async sql=>{calls.push(sql);return {rows:[{database:'cecelia_scratch',schema:'ci_admission_'+id}]};}};
 const lease=await createCiAdmissionScratch({openBase:async()=>({db,schema:'implementation_ci_'+id,close:async()=>{closed++;}})});
 assert.equal(lease.schema,'ci_admission_'+id);assert.match(calls[0],/^ALTER SCHEMA implementation_ci_/);
 await lease.close();await lease.close();assert.equal(closed,1);
 assert.ok(calls.some(s=>s===`DROP SCHEMA IF EXISTS ci_admission_${id} CASCADE`));assert.equal(calls.some(s=>/^(INSERT|UPDATE|DELETE|ALTER TABLE).*public/.test(s)),false);
});
test('外来schema租约不能重命名，失败仍关闭原租约',async()=>{
 let writes=0,closed=0;
 await assert.rejects(createCiAdmissionScratch({openBase:async()=>({schema:'public',db:{query:async()=>{writes++;}},close:async()=>{closed++;}})}),/CI_ADMISSION_SCRATCH/);
 assert.equal(writes,0);assert.equal(closed,1);
});
