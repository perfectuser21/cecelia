import {it,expect} from 'vitest';
const proof=await import('./execution-proof.js').catch(()=>({}));
const id='11111111-1111-4111-8111-111111111111';
function database(row){
 const calls=[];const client={query:async(sql)=>{calls.push(sql);return {rows:sql.includes('FROM tasks')?[row]:sql.includes('current_database')?[{name:'cecelia_scratch'}]:[]};},release(){}};
 return {calls,connect:async()=>client};
}
it('readiness仅只读且旧文本回执不自动获新协议资格',async()=>{
 expect(typeof proof.readAuthoringReadiness).toBe('function');
 const db=database({id,payload:{workflow_authoring:true},result:{workflow_authoring:{request:{},outputs:{compose:{definition:{activities:[]}}}}}});
 const result=await proof.readAuthoringReadiness(db,id,{tenantId:'default'});
 expect(result.status).toBe('blocked');expect(result.gaps.map(g=>g.code)).toContain('execution_protocol_required');
 expect(db.calls.some(sql=>/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
 expect(db.calls.some(sql=>sql.includes('statement_timeout'))).toBe(true);
});
it('真列与payload租户冲突、过期deadline不可被当作ready',async()=>{
 const db=database({id,tenant_id:'other',payload:{workflow_authoring:true,tenant_id:'default'},result:{}});
 const mismatch=await proof.readAuthoringReadiness(db,id,{tenantId:'default'});
 expect(mismatch.gaps.map(g=>g.code)).toContain('readiness_identity_mismatch');
 const expired=await proof.readAuthoringReadiness(db,id,{tenantId:'default',deadline:Date.now()-1});
 expect(expired.status).toBe('blocked');expect(expired.gaps.map(g=>g.code)).toContain('readiness_deadline_exceeded');
});
