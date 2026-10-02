import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as storeModule from '../attempt-store.js';
function setup({rollbackFails=false,commitFails=false,queryFails=false,external=false,winner=null}={}){
 const calls=[],input={id:randomUUID(),runId:randomUUID(),hop:1,phase:'generate',role:'generator',provider:'codex',accountId:'team1',machineId:'xian-mac-m1',callbackSecretHash:'a'.repeat(64),bundle:{inputs:{}}};
 const query=async sql=>{
  calls.push(sql);
  if(sql==='ROLLBACK'&&rollbackFails)throw Error('rollback disconnected');
  if(sql==='COMMIT'&&commitFails)throw Error('machine_capacity_contended');
  if(sql.includes('WITH occupied')){
   if(queryFails)throw Error('machine_capacity_contended');
   return {rows:[commitFails?{attempt:{id:input.id},machine_capacity_contended:false}:{attempt:null,machine_capacity_contended:true}]};
  }
  if(sql.includes('SELECT attempt.*'))return {rows:winner?[winner]:[]};
  return {rows:[]};
 };
 const client={query,release(){}},pool={query,connect:async()=>client};
 return {calls,input,store:storeModule.createAttemptStore(external?client:pool,{transactionClient:external})};
}
async function rejection(f){try{await f.store.createAttempt(f.input);}catch(error){return error;}throw Error('expected rejection');}
it('只有明确零attempt容量guard且自持事务ROLLBACK成功才签发身份绑定重选资格',async()=>{
 expect(storeModule.isConfirmedCapacityRollback).toBeTypeOf('function');
 const f=setup(),error=await rejection(f);
 expect(error.message).toBe('machine_capacity_contended');
 expect(storeModule.isConfirmedCapacityRollback(error,f.input)).toBe(true);
 expect(f.calls.at(-1)).toBe('ROLLBACK');
 expect(storeModule.isConfirmedCapacityRollback(Error(error.message),f.input)).toBe(false);
 for(const key of ['id','runId','hop','machineId'])expect(storeModule.isConfirmedCapacityRollback(error,{...f.input,[key]:'changed'})).toBe(false);
});
it.each([{rollbackFails:true},{commitFails:true},{queryFails:true},{external:true}])('未知提交/断线/回滚失败/外部事务不得重选 %#',async options=>{
 expect(storeModule.isConfirmedCapacityRollback).toBeTypeOf('function');
 const f=setup(options),error=await rejection(f);
 expect(storeModule.isConfirmedCapacityRollback(error,f.input)).toBe(false);
 if(options.external)expect(f.calls).not.toContain('ROLLBACK');
});
it('容量guard竞争后同run/hop已有winner，返回旧winner而非重选',async()=>{
 const winner={id:randomUUID(),machine_id:'us-mac-m4'},f=setup({winner});
 await expect(f.store.createAttempt(f.input)).resolves.toEqual(winner);
 expect(f.calls.at(-1)).toBe('COMMIT');expect(f.calls).not.toContain('ROLLBACK');
});
