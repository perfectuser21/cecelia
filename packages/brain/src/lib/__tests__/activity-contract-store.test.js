import { it,expect,vi } from 'vitest';
import { storeActivityContracts } from '../activity-contract-store.js';
it('数据库唯一冲突原样上抛、事务回滚且连接归还',async()=>{
  const conflict=Object.assign(new Error('duplicate'),{code:'23505'});
  const workflow={id:'w',source_capability:'cap',capability_id:'c'};
  const client={query:vi.fn(async sql=>{if(sql.includes('FROM workflows')) return {rows:[workflow]}; if(sql.includes('INSERT INTO journey_steps')) throw conflict; return {rows:[]};}),release:vi.fn()};
  await expect(storeActivityContracts({connect:async()=>client},[{workflow,activities:[{activity:{from:'cap',key:'one',name:'一',order:1},sha256:'hash'}]}],'head','repo')).rejects.toBe(conflict);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK'); expect(client.release).toHaveBeenCalled();
  expect(client.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(false);
});
it('已变化的登记快照以精确409冲突拒绝，仍回滚与归还连接',async()=>{
 const client={query:vi.fn(async()=>({rows:[{contract_sync_revision:'2'}]})),release:vi.fn()};
 await expect(storeActivityContracts({connect:async()=>client},[],'head','repo',[{contract_sync_revision:'1'}]))
  .rejects.toMatchObject({code:'ACTIVITY_CONTRACT_SNAPSHOT_CHANGED',status:409});
 expect(client.query).toHaveBeenCalledWith('ROLLBACK');expect(client.release).toHaveBeenCalled();
});
